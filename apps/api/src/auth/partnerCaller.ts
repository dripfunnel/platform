import type postgres from 'postgres'
import type { PartnerContext } from '#core/tenancy'
import type { PartnerState } from '#db/schema/saas'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { selectPartnerCaller, selectPartnerConsole } from '#db/scoped/partnerUsers'
import { endPortalSession, selectPortalSession, type PortalSessionRow } from '#db/scoped/staffPortal'
import { factsOf, staffSessionEnded, type ActivityLog, type RequestFacts } from './activity'
import { readCookie } from './cookie'
import { isPartnerRole, type PartnerRole } from './partnerPermissions'
import { partnerCookieName, readPartnerSession } from './partnerSession'
import { hashSessionId } from './session'
import { staffPortalCookieName } from './staffPortal'

/** The console's own reading of the partner's state: a draft that was sent back says so (FIRST-RELEASE §2.3). */
export type PartnerConsoleState = Exclude<PartnerState, 'closed'> | 'sentback'

/** The staff member behind an impersonation or a setup session (ACCESS.md §8.1, §8.2). */
export interface PortalStaff {
  id: string
  name: string
  email: string
  session: { kind: 'impersonation' | 'setup'; id: string; expiresAt: Date }
}

export interface PartnerCaller {
  /** The partner role the request runs with: the user's own, or the Owner's in a setup session. */
  role: PartnerRole
  /** The partner user acted as, signed in or impersonated; null in a setup session, which acts as staff. */
  user: { id: string; name: string; email: string } | null
  staff: PortalStaff | null
  partner: { id: string; name: string; product: string; host: string | null; state: PartnerConsoleState }
}

/** The caller's context for the scoped layer (DATA-MODEL.md §5.1, §5.3). */
export const partnerContextOf = (caller: PartnerCaller): PartnerContext => {
  const partnerId = caller.partner.id
  if (caller.staff?.session.kind === 'setup') return { caller: { kind: 'staff-setup', staffId: caller.staff.id, setupSessionId: caller.staff.session.id }, partnerId }
  if (!caller.user) throw new Error('partnerContextOf: a partner caller with neither a user nor a setup session')
  if (caller.staff) return { caller: { kind: 'impersonation', partnerUserId: caller.user.id, staffId: caller.staff.id, impersonationId: caller.staff.session.id }, partnerId }
  return { caller: { kind: 'partner-user', partnerUserId: caller.user.id }, partnerId }
}

/** Who did it, as a person reads it: the partner user, or the staff member in a setup session. */
export const actingName = (caller: PartnerCaller): string => caller.user?.name ?? caller.staff?.name ?? ''

/** The id records keep for who asked: the partner user's, or the staff member's in a setup session. */
export const actingId = (caller: PartnerCaller): string => caller.user?.id ?? caller.staff?.id ?? ''

/** Who did it, for the records that name a kind and a label (a draft's author, a submission). */
export const agentOf = (caller: PartnerCaller): { kind: 'partner_user' | 'staff'; label: string } => ({ kind: caller.user ? 'partner_user' : 'staff', label: actingName(caller) })

type Partner = PartnerCaller['partner']

const partnerOf = (row: { partner_id: string; partner_name: string; product_name: string | null; portal_host: string | null; state: PartnerState; sent_back_reason: string | null }): Partner | null =>
  row.state === 'closed'
    ? null
    : {
        id: row.partner_id,
        name: row.partner_name,
        product: row.product_name ?? row.partner_name,
        host: row.portal_host,
        state: row.state === 'draft' && row.sent_back_reason !== null ? 'sentback' : row.state,
      }

// A suspended user and a closed partner read as no session at all, as an unknown one does.
const userCaller = async (tx: ScopedSql, partnerUserId: string): Promise<PartnerCaller | null> => {
  const row = await selectPartnerCaller(tx, partnerUserId)
  const partner = row && partnerOf(row)
  if (!row || !partner || !isPartnerRole(row.role_key)) return null
  return { role: row.role_key, user: { id: row.id, name: row.name, email: row.email }, staff: null, partner }
}

// ACCESS.md §8.1, §8.2: a session ends at its time, and as soon as its partner closes or the user
// it acts as is no longer active; every read of it checks.
const endIfGone = async (tx: ScopedSql, s: PortalSessionRow, ending: Ending): Promise<PortalSessionRow> => {
  if (s.ended_at !== null || s.expires_at <= ending.now) return s
  const reason = s.partner_state === 'closed' ? 'partner_closed' : s.kind === 'impersonation' && s.target_status !== 'active' ? 'target_gone' : null
  if (!reason || !(await endPortalSession(tx, s.kind, s.id, reason, null, ending.now))) return s
  await ending.activity.record(tx, staffSessionEnded(s, ending.facts, reason))
  return { ...s, ended_at: ending.now, end_reason: reason }
}

/** What reading a session needs to end and log one whose user or partner has gone. */
export interface Ending {
  now: Date
  activity: ActivityLog
  facts: RequestFacts
}

/** The session a staff cookie on this host belongs to, open or ended; null for an unknown cookie. */
export const readPortalSession = async (tx: ScopedSql, cookie: string, ending: Ending): Promise<PortalSessionRow | null> => {
  const s = await selectPortalSession(tx, await hashSessionId(cookie))
  return s && endIfGone(tx, s, ending)
}

const staffCaller = async (tx: ScopedSql, cookie: string, ending: Ending): Promise<PartnerCaller | null> => {
  const now = ending.now
  const s = await readPortalSession(tx, cookie, ending)
  if (!s || s.ended_at !== null || s.expires_at <= now) return null
  const staff: PortalStaff = { id: s.staff_id, name: s.staff_name, email: s.staff_email, session: { kind: s.kind, id: s.id, expiresAt: s.expires_at } }
  if (s.kind === 'impersonation') {
    const target = s.target_id ? await userCaller(tx, s.target_id) : null
    return target && { ...target, staff }
  }
  const row = await selectPartnerConsole(tx, s.partner_id)
  const partner = row && partnerOf(row)
  return partner && { role: 'partner-owner', user: null, staff, partner }
}

/**
 * Who is asking: a staff member's session on this host first, else the partner user's own.
 * Resolved in `system` scope because the caller is not known yet, which `partner` scope needs.
 */
export const resolvePartner = async (sql: postgres.Sql, request: Request, now: Date, activity: ActivityLog): Promise<PartnerCaller | null> => {
  const cookies = request.headers.get('cookie')
  const staffCookie = readCookie(cookies, staffPortalCookieName)
  const userCookie = readCookie(cookies, partnerCookieName)
  if (!staffCookie && !userCookie) return null
  return withSystemScope(sql, async (tx) => {
    const staff = staffCookie ? await staffCaller(tx, staffCookie, { now, activity, facts: factsOf(request) }) : null
    if (staff) return staff
    const userId = userCookie ? await readPartnerSession(tx, userCookie, now) : null
    return userId ? userCaller(tx, userId) : null
  })
}
