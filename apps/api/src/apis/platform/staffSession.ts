import { z } from 'zod'
import { factsOf, staffSessionEnded, type RequestFacts } from '#auth/activity'
import { readCookie } from '#auth/cookie'
import { readPortalSession } from '#auth/partnerCaller'
import { hashSessionId, newSessionId } from '#auth/session'
import { setStaffPortalCookie, staffPortalCookieName } from '#auth/staffPortal'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { endPortalSession, spendPortalHandoff, type PortalSessionRow } from '#db/scoped/staffPortal'
import type { PlatformAuthDeps } from './auth'
import { json, readBody, refuse } from './authHttp'

// The partner console's half of staff sessions (ACCESS.md §8.3, #243): the handoff exchange, the
// session the staff cookie belongs to, and ending it from the console.

export const staffSessionPaths = {
  handoff: '/api/auth/handoff',
  current: '/api/auth/staff-session',
  end: '/api/auth/end-staff-session',
} as const

const endedByOf = { staff: 'staff', portal: 'portal', expired: 'expiry', target_gone: 'targetGone', partner_closed: 'partnerClosed' } as const

export const portalSessionDto = (s: PortalSessionRow, host: string, now: Date) => ({
  id: s.id,
  kind: s.kind,
  state: s.ended_at === null ? (s.expires_at > now ? ('open' as const) : ('expired' as const)) : s.end_reason === 'expired' ? ('expired' as const) : ('ended' as const),
  endedBy: s.ended_at === null ? (s.expires_at > now ? null : ('expiry' as const)) : (endedByOf[s.end_reason as keyof typeof endedByOf] ?? 'staff'),
  staffName: s.staff_name,
  // The user acted as, by name and role key; the console words the role.
  actingAs: s.kind === 'impersonation' && s.target_name && s.target_role ? { name: s.target_name, role: s.target_role } : null,
  partnerName: s.partner_name,
  host,
  expiresAt: s.expires_at.toISOString(),
})

const handoffInput = z.strictObject({ token: z.string().min(1).max(256) })
const endInput = z.strictObject({ id: z.guid() })

// The token arrives in the body, never in a URL a log could keep (ACCESS.md §8.3).
export const exchangeHandoff = async (request: Request, deps: PlatformAuthDeps): Promise<Response> => {
  const input = await readBody(request, handoffInput)
  const now = deps.now()
  const cookie = newSessionId()
  const session = input
    ? await withSystemScope(deps.sql, async (tx) => {
        const spent = await spendPortalHandoff(tx, await hashSessionId(input.token), await hashSessionId(cookie), now)
        return spent ? readPortalSession(tx, cookie, { now, activity: deps.activity, facts: factsOf(request) }) : null
      })
    : null
  if (!session) return json(400, { ok: false, code: 'HANDOFF_INVALID' })
  return json(200, { ok: true, session: portalSessionDto(session, deps.platformHost, now) }, setStaffPortalCookie(cookie))
}

/** Polled every 15 seconds and on focus (ACCESS.md §8.3); answers how the session ended once it has. */
// A staff cookie's reads, per address: a session polls about four times a minute (ACCESS.md §8.3).
const staffBucketAllows = (deps: PlatformAuthDeps, facts: RequestFacts) => facts.ip !== null && deps.allowAttempt(`staff:ip:${facts.ip}`)

export const currentStaffSession = async (request: Request, deps: PlatformAuthDeps, facts: RequestFacts): Promise<Response> => {
  const cookie = readCookie(request.headers.get('cookie'), staffPortalCookieName)
  if (!cookie) return json(200, { ok: true, session: null })
  if (!(await staffBucketAllows(deps, facts))) return refuse({ code: 'RATE_LIMITED' })
  const now = deps.now()
  const session = await withSystemScope(deps.sql, (tx) => readPortalSession(tx, cookie, { now, activity: deps.activity, facts }))
  return json(200, { ok: true, session: session && portalSessionDto(session, deps.platformHost, now) })
}

/** Ends the cookie's session from the console and logs it; false when there was none open to end. */
export const endOwnPortalSession = async (tx: ScopedSql, cookie: string, id: string | null, deps: PlatformAuthDeps, facts: RequestFacts): Promise<boolean> => {
  const now = deps.now()
  const s = await readPortalSession(tx, cookie, { now, activity: deps.activity, facts })
  if (!s || (id !== null && s.id !== id) || !(await endPortalSession(tx, s.kind, s.id, 'portal', s.staff_id, now))) return false
  await deps.activity.record(tx, staffSessionEnded(s, facts, 'portal'))
  return true
}

export const endStaffSessionFromPortal = async (request: Request, deps: PlatformAuthDeps, facts: RequestFacts): Promise<Response> => {
  const input = await readBody(request, endInput)
  const cookie = readCookie(request.headers.get('cookie'), staffPortalCookieName)
  if (!cookie || !input) return json(400, { ok: false, code: 'SESSION_NOT_ENDED' })
  if (!(await staffBucketAllows(deps, facts))) return refuse({ code: 'RATE_LIMITED' })
  const ended = await withSystemScope(deps.sql, (tx) => endOwnPortalSession(tx, cookie, input.id, deps, facts))
  // The cookie stays: it no longer acts, and it lets the console say how the session ended.
  return ended ? json(200, { ok: true }) : json(400, { ok: false, code: 'SESSION_NOT_ENDED' })
}
