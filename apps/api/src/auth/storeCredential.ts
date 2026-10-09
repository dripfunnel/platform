import { originAllowed, readCookie } from './cookie'
import { storeCookieName } from './storeSession'

// The merchant mobile app carries the portal's session as a bearer token instead of the cookie
// (ACCESS.md §4, "The merchant mobile app").

const bearerOf = (request: Request): string | null => /^Bearer ([^\s,;]+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? null
const cookieOf = (request: Request): string | null => readCookie(request.headers.get('cookie'), storeCookieName)
// Present even when empty, so `__Host-portal_session=` beside a bearer token still counts as both.
const sendsCookie = (request: Request): boolean =>
  (request.headers.get('cookie') ?? '').split(';').some((part) => part.trim().split('=')[0] === storeCookieName)

/** The session the request carries; null when it carries none, or a cookie and a bearer token together. */
export const storeSessionId = (request: Request): string | null => {
  const bearer = bearerOf(request)
  if (bearer && sendsCookie(request)) return null
  return cookieOf(request) ?? bearer
}

/** Only a request with no `Origin` and no session cookie is given the session in the body: never a browser's. */
export const wantsBodySession = (request: Request): boolean => !request.headers.has('origin') && !sendsCookie(request)

/** A bearer request without a cookie skips the `Origin` check, since no browser attaches the header itself; cookie requests keep it. */
export const storeOriginAllowed = (request: Request, host: string): boolean =>
  (bearerOf(request) !== null && !sendsCookie(request)) || originAllowed(request, host)
