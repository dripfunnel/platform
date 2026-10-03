import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { partnerScopedRoles, roleHas } from '#auth/permissions'
import { hashSessionId, newSessionId } from '#auth/session'
import type { StaffMember } from '#auth/staff'
import { withScope, type ScopedSql } from '#db/scoped/index'
import {
  endImpersonation,
  expireStaleImpersonations,
  extendImpersonation,
  insertImpersonation,
  isAssignedPartner,
  lockStaffSession,
  reissueHandoff,
  selectLivePortalHosts,
  selectMembershipTarget,
  selectOpenSessions,
  selectSessionHistory,
  selectStaffSession,
  selectTargets,
  type StaffSessionRow,
  type TargetKind,
  type TargetRow,
} from '#db/scoped/staffSessions'
import { selectPartnerNames } from '#db/scoped/stores'
import type { PageInfo } from '#saas/activity/index'
import { decodePage, pageOf, reasonText, staffEntry, type PageRequest } from '#saas/staff/index'

// Staff sessions on the Admin API (ACCESS.md §8.1–§8.3; card #40): who a staff member may act
// as, starting, returning to, extending and ending an impersonation, and one list over both
// kinds. The portal side (the exchange, the caller kinds, the blocked lists) is #243.

export const impersonationMs = 30 * 60 * 1000
export const handoffMs = 5 * 60 * 1000
export const targetPageSize = 25
export const sessionPageSize = 25

export const sessionAudit = {
  startImpersonation: 'impersonation.started',
  extendImpersonation: 'impersonation.extended',
  endImpersonation: 'impersonation.ended',
  returnToSession: 'staff_session.link_reissued',
} as const

// ACCESS.md §8.3's codes, plus the supplier user who can't be acted as until the Store strand
// adds the supplier's database role (DATA-MODEL §5.3).
export type SessionRefusal =
  | 'STAFF_ROLE_NOT_ALLOWED'
  | 'TARGET_NOT_ACTIVE'
  | 'PARTNER_CLOSED'
  | 'IMPERSONATION_ALREADY_OPEN'
  | 'IMPERSONATION_ALREADY_EXTENDED'
  | 'SETUP_SESSION_NOT_EXTENDABLE'
  | 'NOT_SESSION_OWNER'
  | 'REASON_REQUIRED'
  | 'REAUTH_REQUIRED'
  | 'SESSION_ENDED'
  | 'SESSION_EXPIRED'
  | 'NOT_FOUND'
  | 'SUPPLIER_NOT_SUPPORTED'
  | 'INVALID_INPUT'
type Permission = { allowed: true } | { allowed: false; reason: SessionRefusal }
const allowed: Permission = { allowed: true }
const refused = (reason: SessionRefusal): Permission => ({ allowed: false, reason })
const id = z.guid()

export const targetFilter = z.strictObject({
  type: z.enum(['partnerUser', 'storeUser', 'supplierUser']).optional(),
  partner: z.guid().optional(),
  store: z.guid().optional(),
  role: z.string().min(1).max(40).optional(),
  status: z.enum(['active', 'invited', 'suspended']).optional(),
})

export const sessionFilter = z.strictObject({
  kind: z.enum(['impersonation', 'setup']).optional(),
  staff: z.guid().optional(),
  partner: z.guid().optional(),
  store: z.guid().optional(),
  date: z.enum(['today', '7d', '30d']).optional(),
})

export interface StaffSessionsDeps {
  sql: postgres.Sql
  staff: StaffMember
  facts: RequestFacts
  activity: ActivityLog
  /** Whether the staff session re-authenticated in the last five minutes (#13's stamp, as #33 uses). */
  reauthFresh: boolean
  /** Where a partner user is acted as: the partner console's host. */
  platformHost: string
  now: () => Date
}

export const createStaffSessionsService = ({ sql, staff, facts, activity, reauthFresh, platformHost, now }: StaffSessionsDeps) => {
  const context = { caller: { kind: 'staff' as const, staffId: staff.id } }
  const entry = staffEntry(staff, facts)
  const mayImpersonate = roleHas(staff.role, 'impersonate')
  const mayEndAny = roleHas(staff.role, 'staffSessions.endAny')
  // ACCESS.md §8.3: a Partner manager sees setup sessions of their partners, never an impersonation.
  const assignedTo = partnerScopedRoles.includes(staff.role) ? staff.id : undefined

  // The portal's own page takes the token and drops it from the address bar (ACCESS.md §8.1, #243).
  const linkFor = (host: string, token: string) => `https://${host}/impersonate/enter?token=${encodeURIComponent(token)}`

  /** Why the caller can't act as this person in this place now; null when they can. */
  const refusalFor = (t: { active: boolean; partnerState: string; supplier: boolean }): SessionRefusal | null => {
    if (!mayImpersonate) return 'STAFF_ROLE_NOT_ALLOWED'
    if (t.partnerState === 'closed') return 'PARTNER_CLOSED'
    if (!t.active) return 'TARGET_NOT_ACTIVE'
    if (t.supplier) return 'SUPPLIER_NOT_SUPPORTED'
    return null
  }

  const targetOf = (t: TargetRow, mine: Map<string, string>) => {
    const reason = refusalFor({ active: t.status === 'active', partnerState: t.partner_state, supplier: t.kind === 'supplierUser' })
    return {
      id: t.id,
      name: t.name,
      email: t.email,
      kind: t.kind,
      memberships: t.memberships,
      lastSignInAt: t.last_sign_in_at,
      status: t.status,
      impersonate: reason ? refused(reason) : allowed,
      openSession: mine.get(t.id) ?? null,
    }
  }
  type TargetDto = ReturnType<typeof targetOf>

  const mineByTarget = async (tx: ScopedSql, at: Date) =>
    new Map((await selectOpenSessions(tx, { kind: 'impersonation', staffId: staff.id }, at)).flatMap((s) => (s.target_id ? [[s.target_id, s.id] as const] : [])))

  /** Null for a filter, search or cursor it cannot read. */
  const impersonationTargets = async (raw: unknown, search: string | null, page: PageRequest): Promise<{ items: TargetDto[]; pageInfo: PageInfo; partners: { id: string; name: string }[] } | null> => {
    const parsed = targetFilter.safeParse(raw ?? {})
    const decoded = decodePage(page, targetPageSize)
    if (!parsed.success || !decoded.ok) return null
    const term = search?.trim() ? search.trim().slice(0, 100) : undefined
    const f = parsed.data
    return withScope(sql, context, async (tx) => {
      const rows = await selectTargets(tx, { kind: f.type as TargetKind | undefined, partnerId: f.partner, storeId: f.store, role: f.role, status: f.status, search: term }, decoded, decoded.limit)
      const { rows: pageRows, pageInfo } = pageOf(rows, decoded, (r) => ({ occurredAt: r.created_at, id: r.id }))
      const mine = await mineByTarget(tx, now())
      return { items: pageRows.map((r) => targetOf(r, mine)), pageInfo, partners: await selectPartnerNames(tx) }
    })
  }

  const outcomeOf = (s: StaffSessionRow, at: Date) =>
    s.ended_at === null ? (s.expires_at > at ? 'open' : 'expired') : s.end_reason === 'portal' ? 'endedFromPortal' : s.end_reason === 'target_gone' ? 'targetGone' : s.end_reason === 'partner_closed' ? 'partnerClosed' : s.end_reason === 'expired' ? 'expired' : 'endedByStaff'

  const sessionOf = (s: StaffSessionRow, at: Date, hosts: Map<string, string>) => {
    const outcome = outcomeOf(s, at)
    const mine = s.staff_user_id === staff.id
    const closed = outcome === 'expired' ? refused('SESSION_EXPIRED') : outcome === 'open' ? null : refused('SESSION_ENDED')
    const host = s.kind === 'setup' || s.target_kind === 'partner_user' ? platformHost : (hosts.get(s.partner_id) ?? '')
    return {
      id: s.id,
      kind: s.kind,
      staff: { id: s.staff_user_id, name: s.staff_name },
      target: s.target_id && s.target_name ? { id: s.target_id, name: s.target_name } : null,
      membership: s.membership_role ? { role: s.membership_role, supplier: s.supplier } : null,
      partner: { id: s.partner_id, name: s.partner_name },
      store: s.store_id && s.store_name ? { id: s.store_id, name: s.store_name } : null,
      host,
      reason: s.reason,
      ticket: s.ticket,
      startedAt: s.started_at,
      expiresAt: s.expires_at,
      endedAt: s.ended_at ?? (outcome === 'expired' ? s.expires_at : null),
      extendedAt: s.extended_at,
      outcome,
      mine,
      // ACCESS.md §8.3: each record says what the caller may do to it.
      actions: {
        end: closed ?? (mine || mayEndAny ? allowed : refused('NOT_SESSION_OWNER')),
        extend: closed ?? (s.kind === 'setup' ? refused('SETUP_SESSION_NOT_EXTENDABLE') : !mine ? refused('NOT_SESSION_OWNER') : s.extended_at ? refused('IMPERSONATION_ALREADY_EXTENDED') : allowed),
        return: closed ?? (mine ? allowed : refused('NOT_SESSION_OWNER')),
      },
    }
  }
  type SessionDto = ReturnType<typeof sessionOf>

  /** What a list of sessions shows, by the caller's role: impersonations only to those who may impersonate. */
  const visibleFilter = (f: z.infer<typeof sessionFilter>, at: Date) => ({
    kind: mayImpersonate ? f.kind : ('setup' as const),
    staffId: f.staff,
    partnerId: f.partner,
    storeId: f.store,
    since: f.date ? new Date(f.date === 'today' ? Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) : at.getTime() - (f.date === '7d' ? 7 : 30) * 86_400_000) : undefined,
    assignedTo,
  })

  const staffSessions = async (raw: unknown, page: PageRequest) => {
    const parsed = sessionFilter.safeParse(raw ?? {})
    const decoded = decodePage(page, sessionPageSize)
    if (!parsed.success || !decoded.ok) return null
    return withScope(sql, context, async (tx) => {
      const at = now()
      const filter = visibleFilter(parsed.data, at)
      const open = await selectOpenSessions(tx, filter, at)
      const history = await selectSessionHistory(tx, filter, decoded, decoded.limit, at)
      const { rows: pageRows, pageInfo } = pageOf(history, decoded, (r) => ({ occurredAt: r.started_at, id: r.id }))
      const hosts = await selectLivePortalHosts(tx, [...new Set([...open, ...pageRows].map((s) => s.partner_id))])
      return { open: open.map((s) => sessionOf(s, at, hosts)), history: { items: pageRows.map((s) => sessionOf(s, at, hosts)), pageInfo }, partners: await selectPartnerNames(tx, assignedTo) }
    })
  }

  /** One session, or why not: a role that can't see it is told so, not shown a missing page (decided on #46). */
  const staffSession = async (sessionId: string): Promise<{ kind: 'found'; session: SessionDto } | { kind: 'denied' } | { kind: 'notFound' }> => {
    if (!id.safeParse(sessionId).success) return { kind: 'notFound' }
    return withScope(sql, context, async (tx) => {
      const s = await selectStaffSession(tx, sessionId)
      if (!s) return { kind: 'notFound' }
      if (s.kind === 'impersonation' && !mayImpersonate) return { kind: 'denied' }
      if (assignedTo !== undefined && !(await isAssignedPartner(tx, assignedTo, s.partner_id))) return { kind: 'notFound' }
      const at = now()
      return { kind: 'found', session: sessionOf(s, at, await selectLivePortalHosts(tx, [s.partner_id])) }
    })
  }

  /** The strip (ACCESS.md §8.3): the caller's own open sessions, both kinds. */
  const myStaffSessions = () =>
    withScope(sql, context, async (tx) => {
      const at = now()
      const open = await selectOpenSessions(tx, { staffId: staff.id }, at)
      const hosts = await selectLivePortalHosts(tx, [...new Set(open.map((s) => s.partner_id))])
      return open.map((s) => sessionOf(s, at, hosts))
    })

  type Started = { ok: true; session: SessionDto; handoff: string } | { ok: false; reason: SessionRefusal; sessionId?: string | undefined }

  /** ACCESS.md §8.1: the role, re-authentication, a reason, an active target in an open partner, one at a time. */
  const startImpersonation = async (targetId: string, membershipId: string, reason: string | null, ticket: string | null): Promise<Started> => {
    if (!mayImpersonate) return { ok: false, reason: 'STAFF_ROLE_NOT_ALLOWED' }
    if (!id.safeParse(targetId).success || !id.safeParse(membershipId).success) return { ok: false, reason: 'NOT_FOUND' }
    const why = reasonText.safeParse(reason ?? '')
    if (!why.success) return { ok: false, reason: 'REASON_REQUIRED' }
    const ticketText = z.string().trim().max(500).nullable().safeParse(ticket)
    if (!ticketText.success) return { ok: false, reason: 'INVALID_INPUT' }
    if (!reauthFresh) return { ok: false, reason: 'REAUTH_REQUIRED' }
    return withScope(sql, context, async (tx): Promise<Started> => {
      const t = await selectMembershipTarget(tx, membershipId)
      if (!t || t.target_id !== targetId) return { ok: false, reason: 'NOT_FOUND' }
      const refusal = refusalFor({ active: t.active, partnerState: t.partner_state, supplier: t.seller_id !== null })
      if (refusal) return { ok: false, reason: refusal }
      const at = now()
      await expireStaleImpersonations(tx, staff.id, at)
      const host = t.target_kind === 'partner_user' ? platformHost : (await selectLivePortalHosts(tx, [t.partner_id])).get(t.partner_id)
      if (!host) return { ok: false, reason: 'TARGET_NOT_ACTIVE' }
      const token = newSessionId()
      const sessionId = await insertImpersonation(tx, {
        staffUserId: staff.id,
        targetKind: t.target_kind,
        targetId: t.target_id,
        membershipId: t.membership_id,
        partnerId: t.partner_id,
        storeId: t.store_id,
        reason: why.data,
        ticket: ticketText.data || null,
        startedAt: at,
        expiresAt: new Date(at.getTime() + impersonationMs),
        handoffHash: await hashSessionId(token),
        handoffExpiresAt: new Date(at.getTime() + handoffMs),
      })
      // One open per staff member: the partial unique index decides, also between two starts at once.
      if (!sessionId) return { ok: false, reason: 'IMPERSONATION_ALREADY_OPEN', sessionId: (await selectOpenSessions(tx, { kind: 'impersonation', staffId: staff.id }, at))[0]?.id }
      await activity.record(
        tx,
        entry({
          category: 'support',
          action: sessionAudit.startImpersonation,
          reason: why.data,
          partnerId: t.partner_id,
          storeId: t.store_id,
          access: { kind: 'impersonation', id: sessionId },
          target: { type: t.target_kind, id: t.target_id, label: `${t.name} <${t.email}>` },
          // The partner or the store sees that DripFunnel acted in its account (LOGGING §6).
          visibility: t.store_id ? 'store' : 'partner',
          changes: ticketText.data ? [{ field: 'ticket', before: null, after: ticketText.data }] : [],
        }),
      )
      const s = await selectStaffSession(tx, sessionId)
      if (!s) throw new Error('impersonation: inserted row not found')
      return { ok: true, session: sessionOf(s, at, new Map([[t.partner_id, host]])), handoff: linkFor(host, token) }
    })
  }

  /** One change to one session, on the row locked and read again. */
  const onSession = <T>(sessionId: string, work: (tx: ScopedSql, s: StaffSessionRow, dto: SessionDto, at: Date) => Promise<T | { ok: false; reason: SessionRefusal }>) => {
    if (!id.safeParse(sessionId).success) return Promise.resolve({ ok: false as const, reason: 'NOT_FOUND' as const })
    return withScope(sql, context, async (tx) => {
      await lockStaffSession(tx, sessionId)
      const s = await selectStaffSession(tx, sessionId)
      if (!s || (s.kind === 'impersonation' && !mayImpersonate)) return { ok: false as const, reason: 'NOT_FOUND' as const }
      if (assignedTo !== undefined && !(await isAssignedPartner(tx, assignedTo, s.partner_id))) return { ok: false as const, reason: 'NOT_FOUND' as const }
      const at = now()
      return work(tx, s, sessionOf(s, at, await selectLivePortalHosts(tx, [s.partner_id])), at)
    })
  }

  const impersonationEntry = (action: string, s: StaffSessionRow, extra: { changes?: { field: string; before: string | null; after: string | null }[] } = {}) =>
    entry({
      category: 'support',
      action,
      reason: null,
      partnerId: s.partner_id,
      storeId: s.store_id,
      access: { kind: 'impersonation', id: s.id },
      target: s.target_id && s.target_kind ? { type: s.target_kind, id: s.target_id, label: s.target_name ?? '' } : null,
      visibility: s.store_id ? 'store' : 'partner',
      ...extra,
    })

  /** Once, by 30 minutes, by the staff member who started it; `extended_at` is what refuses a second (DATA-MODEL §3.5). */
  const extendSession = (sessionId: string) =>
    onSession(sessionId, async (tx, s, dto, at): Promise<{ ok: true; expiresAt: Date } | { ok: false; reason: SessionRefusal }> => {
      if (!dto.actions.extend.allowed) return { ok: false, reason: dto.actions.extend.reason }
      if (!(await extendImpersonation(tx, s.id, impersonationMs, at))) return { ok: false, reason: 'IMPERSONATION_ALREADY_EXTENDED' }
      const expiresAt = new Date(s.expires_at.getTime() + impersonationMs)
      await activity.record(tx, impersonationEntry(sessionAudit.extendImpersonation, s, { changes: [{ field: 'expires_at', before: s.expires_at.toISOString(), after: expiresAt.toISOString() }] }))
      return { ok: true, expiresAt }
    })

  /** A fresh link to the caller's own open session, either kind (ACCESS.md §8.3). */
  const returnToSession = (sessionId: string) =>
    onSession(sessionId, async (tx, s, dto, at): Promise<{ ok: true; session: SessionDto; handoff: string } | { ok: false; reason: SessionRefusal }> => {
      if (!dto.actions.return.allowed) return { ok: false, reason: dto.actions.return.reason }
      if (!dto.host) return { ok: false, reason: 'TARGET_NOT_ACTIVE' }
      const token = newSessionId()
      if (!(await reissueHandoff(tx, s.kind, s.id, await hashSessionId(token), new Date(at.getTime() + handoffMs), at))) return { ok: false, reason: 'SESSION_ENDED' }
      await activity.record(tx, s.kind === 'impersonation' ? impersonationEntry(sessionAudit.returnToSession, s) : entry({ category: 'support', action: sessionAudit.returnToSession, reason: null, partnerId: s.partner_id, access: { kind: 'setup_session', id: s.id }, target: { type: 'partner', id: s.partner_id, label: s.partner_name }, visibility: 'partner' }))
      return { ok: true, session: dto, handoff: linkFor(dto.host, token) }
    })

  /** Ends an impersonation; null when the id isn't one, so the setup-session path (#33) can answer. */
  const endImpersonationSession = async (sessionId: string): Promise<{ ok: true } | { ok: false; reason: SessionRefusal } | null> => {
    if (!id.safeParse(sessionId).success) return null
    const kind = await withScope(sql, context, async (tx) => (await selectStaffSession(tx, sessionId))?.kind ?? null)
    if (kind !== 'impersonation') return null
    return onSession(sessionId, async (tx, s, dto, at) => {
      if (!dto.actions.end.allowed) return { ok: false, reason: dto.actions.end.reason }
      await endImpersonation(tx, s.id, staff.id, at)
      await activity.record(tx, impersonationEntry(sessionAudit.endImpersonation, s))
      return { ok: true as const }
    })
  }

  return { impersonationTargets, staffSessions, staffSession, myStaffSessions, startImpersonation, extendSession, returnToSession, endImpersonationSession }
}

export type StaffSessionsService = ReturnType<typeof createStaffSessionsService>
export type ImpersonationTargetDto = NonNullable<Awaited<ReturnType<StaffSessionsService['impersonationTargets']>>>['items'][number]
export type StaffSessionDto = Awaited<ReturnType<StaffSessionsService['myStaffSessions']>>[number]
