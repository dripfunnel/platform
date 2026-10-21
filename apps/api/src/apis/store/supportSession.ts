import type postgres from 'postgres'
import { z } from 'zod'
import { factsOf, type ActivityLog } from '#auth/activity'
import { readCookie } from '#auth/cookie'
import { setSupportCookie, supportCookieName } from '#auth/storeSupport'
import { json, readBody } from '#core/http'
import { currentSupportSession, endSupportSessionFromPortal, exchangeSupportHandoff } from '#saas/storeSupport/index'

// The agent's side of a support session on the portal host (ACCESS.md §8.3, as #243 built it for
// staff on the partner console): the handoff exchange, the session the cookie holds, and End now.

export const supportSessionPaths = {
  handoff: '/api/auth/support-handoff',
  current: '/api/auth/support-session',
  end: '/api/auth/end-support-session',
} as const

export const isSupportSessionPath = (pathname: string): boolean => (Object.values(supportSessionPaths) as string[]).includes(pathname)

export interface SupportSessionDeps {
  sql: postgres.Sql
  partnerId: string
  activity: ActivityLog
  now: () => Date
  /** The sign-in limiter: a handoff token is a credential to guess. */
  allowExchange: (key: string) => Promise<boolean>
  /** The session-read limiter, sized for every tab's 15-second poll. */
  allowRead: (key: string) => Promise<boolean>
}

const handoffInput = z.strictObject({ token: z.string().min(1).max(256) })
const endInput = z.strictObject({ id: z.guid() })
const rateLimited = () => json(429, { ok: false, code: 'RATE_LIMITED' })

export const handleSupportSession = async (request: Request, url: URL, deps: SupportSessionDeps): Promise<Response> => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const facts = factsOf(request)
  const portal = { sql: deps.sql, partnerId: deps.partnerId, activity: deps.activity, facts, now: deps.now }
  const key = `store:${url.host}:support:ip:${facts.ip ?? 'unknown'}`

  // The token arrives in the body, never in a URL a log could keep (ACCESS.md §8.3).
  if (url.pathname === supportSessionPaths.handoff) {
    if (facts.ip === null || !(await deps.allowExchange(key))) return rateLimited()
    const input = await readBody(request, handoffInput)
    const opened = input ? await exchangeSupportHandoff(portal, input.token) : null
    if (!opened) return json(400, { ok: false, code: 'HANDOFF_INVALID' })
    return json(200, { ok: true, session: opened.session }, setSupportCookie(opened.cookie))
  }

  const cookie = readCookie(request.headers.get('cookie'), supportCookieName)
  if (url.pathname === supportSessionPaths.current) {
    if (!cookie) return json(200, { ok: true, session: null })
    if (facts.ip === null || !(await deps.allowRead(key))) return rateLimited()
    return json(200, { ok: true, session: await currentSupportSession(portal, cookie) })
  }

  const input = await readBody(request, endInput)
  if (!cookie || !input) return json(400, { ok: false, code: 'SESSION_NOT_ENDED' })
  if (facts.ip === null || !(await deps.allowRead(key))) return rateLimited()
  // The cookie stays: it acts as nobody now, and lets the bar say how the session ended.
  return (await endSupportSessionFromPortal(portal, cookie, input.id)) ? json(200, { ok: true }) : json(400, { ok: false, code: 'SESSION_NOT_ENDED' })
}
