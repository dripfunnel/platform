import { describe, expect, it } from 'vitest'
import { clearCookie, originAllowed, readCookie, setCookie } from './cookie'
import { cookieName } from './session'

const post = (headers: Record<string, string> = {}) =>
  new Request('https://admin.dripfunnel.com/api', { method: 'POST', headers })

describe('the session cookie', () => {
  it('is __Host-, httpOnly, Secure and SameSite, with no Domain', () => {
    const cookie = setCookie('abc')
    expect(cookie).toContain(`${cookieName}=abc`)
    for (const part of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax']) expect(cookie).toContain(part)
    expect(cookie).not.toContain('Domain')
    expect(cookieName.startsWith('__Host-')).toBe(true)
  })

  it('clears with an immediate expiry', () => {
    expect(clearCookie()).toContain('Max-Age=0')
  })

  it('reads its own value out of a header with others in it', () => {
    expect(readCookie(`other=1; ${cookieName}=xyz; another=2`)).toBe('xyz')
    expect(readCookie('other=1')).toBeNull()
    expect(readCookie(null)).toBeNull()
  })

  it('is not confused by a cookie whose name contains ours', () => {
    expect(readCookie(`not-${cookieName}=evil`)).toBeNull()
  })
})

describe('the Origin check', () => {
  it('allows a mutation from the admin host', () => {
    expect(originAllowed(post({ origin: 'https://admin.dripfunnel.com' }), 'admin.dripfunnel.com')).toBe(true)
  })

  it('refuses one from anywhere else, and one with no Origin at all', () => {
    expect(originAllowed(post({ origin: 'https://evil.example' }), 'admin.dripfunnel.com')).toBe(false)
    expect(originAllowed(post(), 'admin.dripfunnel.com')).toBe(false)
  })

  it('refuses a host that merely ends with the admin host', () => {
    expect(originAllowed(post({ origin: 'https://evil-admin.dripfunnel.com' }), 'admin.dripfunnel.com')).toBe(false)
    expect(originAllowed(post({ origin: 'https://admin.dripfunnel.com.evil.test' }), 'admin.dripfunnel.com')).toBe(false)
  })

  it('does not require an Origin on a read', () => {
    expect(originAllowed(new Request('https://admin.dripfunnel.com/api'), 'admin.dripfunnel.com')).toBe(true)
  })
})
