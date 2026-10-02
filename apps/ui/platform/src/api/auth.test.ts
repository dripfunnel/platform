import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptInvitation, enrolSecondFactor, invitation, safeNext, settleMs, signIn, skipSecondFactor } from './auth'

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

// Every fixture call waits settleMs; this runs the timers so the promise settles.
const settled = async <T,>(promise: Promise<T>): Promise<T> => {
  await vi.advanceTimersByTimeAsync(settleMs)
  return promise
}

describe('the invitation fixture', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it.each([
    ['expired', 'INVITATION_EXPIRED'],
    ['used', 'INVITATION_USED'],
    ['replaced', 'INVITATION_REPLACED'],
    ['invalid', 'INVITATION_INVALID'],
  ])('refuses a %s link with %s', async (token, code) => {
    expect(await settled(invitation(token))).toEqual({ ok: false, code })
  })

  it('refuses a missing token as invalid and treats any other token as the Owner invitation', async () => {
    expect(await settled(invitation(undefined))).toEqual({ ok: false, code: 'INVITATION_INVALID' })
    const owner = await settled(invitation('anything'))
    expect(owner.ok && owner.invitation.role).toBe('partner-owner')
  })

  it('refuses an empty name or a password under 10 characters', async () => {
    expect(await settled(acceptInvitation('owner', '', 'long enough password'))).toEqual({ ok: false, code: 'WEAK_PASSWORD' })
    expect(await settled(acceptInvitation('owner', 'Jonas Weber', 'short'))).toEqual({ ok: false, code: 'WEAK_PASSWORD' })
    expect(await settled(acceptInvitation('owner', 'Jonas Weber', 'long enough password'))).toEqual({ ok: true, secondFactorRequired: false })
  })

  it('refuses the link, not the password, when it has gone bad by the time Continue is pressed', async () => {
    expect(await settled(acceptInvitation('expired', 'Jonas Weber', 'long enough password'))).toEqual({ ok: false, code: 'INVITATION_EXPIRED' })
  })

  it('refuses a code that is not six digits', async () => {
    expect(await settled(enrolSecondFactor('12345'))).toEqual({ ok: false, code: 'WRONG_CODE' })
    expect(await settled(enrolSecondFactor('123456'))).toEqual({ ok: true })
  })

  // FIRST-RELEASE §14.4: the requirement is the invitation's, from the token, never the caller's flag.
  it('lets an optional invitation skip 2-factor and refuses it where the Owner requires it', async () => {
    expect(await settled(skipSecondFactor('owner'))).toEqual({ ok: true })
    expect(await settled(skipSecondFactor('required'))).toEqual({ ok: false, code: 'SECOND_FACTOR_REQUIRED' })
    expect(await settled(skipSecondFactor('expired'))).toEqual({ ok: false, code: 'INVITATION_EXPIRED' })
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
