import { describe, expect, it } from 'vitest'
import { storeOriginAllowed, storeSessionId, wantsBodySession } from './storeCredential'
import { storeCookieName } from './storeSession'

const host = 'store.partner-a.example'
const post = (headers: Record<string, string> = {}) => new Request(`https://${host}/api/`, { method: 'POST', headers })
const cookie = { cookie: `${storeCookieName}=c00kie` }
const bearer = { authorization: 'Bearer t0ken' }
const origin = { origin: `https://${host}` }

describe('the store session a request carries', () => {
  it('reads the cookie or the bearer token, and neither when both come together', () => {
    expect(storeSessionId(post(cookie))).toBe('c00kie')
    expect(storeSessionId(post(bearer))).toBe('t0ken')
    expect(storeSessionId(post({ ...cookie, ...bearer }))).toBeNull()
    expect(storeSessionId(post())).toBeNull()
  })

  it('counts an empty session cookie beside a bearer token as both', () => {
    const empty = { cookie: `${storeCookieName}=`, ...bearer }
    expect(storeSessionId(post(empty))).toBeNull()
    expect(wantsBodySession(post({ cookie: `${storeCookieName}=` }))).toBe(false)
    expect(storeOriginAllowed(post(empty), host)).toBe(false)
  })

  it('ignores an Authorization header that is not a single bearer token', () => {
    expect(storeSessionId(post({ authorization: 'Basic dXNlcjpwYXNz' }))).toBeNull()
    expect(storeSessionId(post({ authorization: 'Bearer ' }))).toBeNull()
    expect(storeSessionId(post({ authorization: 'Bearer a b' }))).toBeNull()
  })

  it('gives the session in the body only with no Origin and no session cookie', () => {
    expect(wantsBodySession(post())).toBe(true)
    expect(wantsBodySession(post(bearer))).toBe(true)
    expect(wantsBodySession(post(origin))).toBe(false)
    expect(wantsBodySession(post({ ...origin, ...bearer }))).toBe(false)
    expect(wantsBodySession(post(cookie))).toBe(false)
  })

  it('skips the Origin check for a bearer request alone; a cookie request keeps it', () => {
    expect(storeOriginAllowed(post(bearer), host)).toBe(true)
    expect(storeOriginAllowed(post(cookie), host)).toBe(false)
    expect(storeOriginAllowed(post({ ...cookie, ...bearer }), host)).toBe(false)
    expect(storeOriginAllowed(post({ ...cookie, origin: 'https://evil.example' }), host)).toBe(false)
    expect(storeOriginAllowed(post({ ...cookie, ...origin }), host)).toBe(true)
    expect(storeOriginAllowed(post(), host)).toBe(false)
  })
})
