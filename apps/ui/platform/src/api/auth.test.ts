import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { safeNext, settleMs, signIn } from './auth'

describe('signIn', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // ACCESS §2: never reveal whether an email has an account.
  it('refuses an unknown email and a wrong password with the same code, after the same time', async () => {
    const unknown = signIn('nobody@example.com', 'northstar-partners')
    const wrong = signIn('maya@northstar.com', 'not-the-password')
    let settled = 0
    void unknown.then(() => settled++)
    void wrong.then(() => settled++)
    await vi.advanceTimersByTimeAsync(settleMs - 1)
    expect(settled).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(2)
    expect(await unknown).toEqual({ ok: false, code: 'INVALID_CREDENTIALS' })
    expect(await wrong).toEqual({ ok: false, code: 'INVALID_CREDENTIALS' })
  })

  it('signs a known account in and says whether a 2-factor code follows', async () => {
    const result = signIn('maya@northstar.com', 'northstar-partners')
    await vi.advanceTimersByTimeAsync(settleMs)
    expect(await result).toEqual({ ok: true, secondFactor: true })
  })
})

describe('safeNext', () => {
  const origin = 'https://platform.dripfunnel.com'

  it('keeps a same-origin path with its search and hash', () => {
    expect(safeNext('/stores?status=live#top', origin)).toBe('/stores?status=live#top')
  })

  it.each(['//evil.com/x', '/\\evil.com/x', 'https://evil.com/dashboard', 'http://platform.dripfunnel.com/x', 'javascript:alert(1)', 'dashboard', '', 42, undefined])(
    'falls back to the dashboard for %s',
    (next) => {
      expect(safeNext(next, origin)).toBe('/dashboard')
    },
  )
})
