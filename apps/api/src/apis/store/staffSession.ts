import type postgres from 'postgres'
import { z } from 'zod'
import { factsOf, type ActivityLog } from '#auth/activity'
import { readCookie } from '#auth/cookie'
import { hashSessionId, newSessionId } from '#auth/session'
import { endStoreStaffSession, readStoreStaffSession, setStaffCookie, staffCookieName } from '#auth/storeStaff'
import { json, readBody } from '#core/http'
import { withSystemScope } from '#db/scoped/index'
import { spendStoreHandoff, type StoreStaffRow } from '#db/scoped/storeStaff'

// Staff impersonating a store user, on the store's portal host (ACCESS.md §8.1, §8.3, as #243 built
// it for the partner console): the handoff exchange, the session the cookie holds, and End session.

export const staffSessionPaths = {
  handoff: '/api/auth/handoff',
  current: '/api/auth/staff-session',
  end: '/api/auth/end-staff-session',
} as const

export const isStaffSessionPath = (pathname: string): boolean => (Object.values(staffSessionPaths) as string[]).includes(pathname)

export interface StaffSessionDeps {
  sql: postgres.Sql
  partnerId: string
  activity: ActivityLog
  now: () => Date
  /** The sign-in limiter: a handoff token is a credential to guess. */
  allowExchange: (key: string) => Promise<boolean>
  /** The session-read limiter, sized for every tab's 15-second poll. */
  allowRead: (key: string) => Promise<boolean>
}

const endedByOf = { staff: 'staff', portal: 'portal', expired: 'expiry', target_gone: 'targetGone', partner_closed: 'partnerClosed' } as const

const sessionDto = (s: StoreStaffRow, host: string, now: Date) => ({
  id: s.id,
  kind: 'impersonation' as const,
  state: s.ended_at === null ? (s.expires_at > now ? ('open' as const) : ('expired' as const)) : s.end_reason === 'expired' ? ('expired' as const) : ('ended' as const),
  endedBy: s.ended_at === null ? (s.expires_at > now ? null : ('expiry' as const)) : (endedByOf[s.end_reason as keyof typeof endedByOf] ?? 'staff'),
  staffName: s.staff_name,
  // The user acted as, by name and role key, and the seat; the portal words the role.
  actingAs: { name: s.user_name, role: s.role_key, store: s.store_name, supplier: s.seller_name },
  partnerName: s.partner_name,
  host,
  expiresAt: s.expires_at.toISOString(),
})

const handoffInput = z.strictObject({ token: z.string().min(1).max(256) })
const endInput = z.strictObject({ id: z.guid() })
const rateLimited = () => json(429, { ok: false, code: 'RATE_LIMITED' })

export const handleStaffSession = async (request: Request, url: URL, deps: StaffSessionDeps): Promise<Response> => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const facts = factsOf(request)
  const key = `store:${url.host}:staff:ip:${facts.ip ?? 'unknown'}`

  // The token arrives in the body, never in a URL a log could keep (ACCESS.md §8.3).
  if (url.pathname === staffSessionPaths.handoff) {
    if (facts.ip === null || !(await deps.allowExchange(key))) return rateLimited()
    const input = await readBody(request, handoffInput)
    const cookie = newSessionId()
    const now = deps.now()
    const session = input
      ? await withSystemScope(deps.sql, async (tx) => {
          const spent = await spendStoreHandoff(tx, deps.partnerId, await hashSessionId(input.token), await hashSessionId(cookie), now)
          return spent ? readStoreStaffSession(tx, deps.partnerId, cookie, { now, activity: deps.activity, facts }) : null
        })
      : null
    if (!session || session.ended_at !== null) return json(400, { ok: false, code: 'HANDOFF_INVALID' })
    return json(200, { ok: true, session: sessionDto(session, url.host, now) }, setStaffCookie(cookie))
  }

  const cookie = readCookie(request.headers.get('cookie'), staffCookieName)
  if (url.pathname === staffSessionPaths.current) {
    if (!cookie) return json(200, { ok: true, session: null })
    if (facts.ip === null || !(await deps.allowRead(key))) return rateLimited()
    const now = deps.now()
    const session = await withSystemScope(deps.sql, (tx) => readStoreStaffSession(tx, deps.partnerId, cookie, { now, activity: deps.activity, facts }))
    return json(200, { ok: true, session: session && sessionDto(session, url.host, now) })
  }

  const input = await readBody(request, endInput)
  if (!cookie || !input) return json(400, { ok: false, code: 'SESSION_NOT_ENDED' })
  if (facts.ip === null || !(await deps.allowRead(key))) return rateLimited()
  const ended = await withSystemScope(deps.sql, (tx) => endStoreStaffSession(tx, deps.partnerId, cookie, input.id, { now: deps.now(), activity: deps.activity, facts }))
  // The cookie stays: it acts as nobody now, and lets the bar say how the session ended.
  return ended ? json(200, { ok: true }) : json(400, { ok: false, code: 'SESSION_NOT_ENDED' })
}
