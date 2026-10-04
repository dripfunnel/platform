import { identityChanged } from '@dripfunnel/shared/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptInvitation, enrolSecondFactor, groupedKey, invitation, requestPasswordReset, safeNext, signIn, signOut, skipSecondFactor, startEnrolment, verifySecondFactor } from './auth'

vi.mock('@dripfunnel/shared/ui', async (importOriginal) => ({ ...(await importOriginal<typeof import('@dripfunnel/shared/ui')>()), identityChanged: vi.fn() }))

// The network is the edge being tested: each call's request, and how every answer is read.
const answer = vi.fn<(route: string, init: RequestInit) => Promise<Response>>()
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))

beforeEach(() => {
  answer.mockReset()
  vi.mocked(identityChanged).mockClear()
  vi.stubGlobal('fetch', (route: string, init: RequestInit) => answer(route, init))
})
afterEach(() => vi.unstubAllGlobals())

const sent = () => {
  const [route, init] = answer.mock.calls[0] ?? []
  return { route, method: init?.method, credentials: init?.credentials, body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined }
}

describe('signIn', () => {
  it('posts the email, password and same-origin next, with the cookie', async () => {
    answer.mockReturnValue(json({ ok: true, step: 'second-factor', next: '/stores' }))
    expect(await signIn('maya@northstar.com', 'pw', '/stores')).toEqual({ ok: true, step: 'second-factor' })
    expect(sent()).toEqual({ route: '/api/auth/sign-in', method: 'POST', credentials: 'same-origin', body: { email: 'maya@northstar.com', password: 'pw', next: '/stores' } })
  })

  it.each(['done', 'second-factor', 'enrol'] as const)('reads the %s step', async (step) => {
    answer.mockReturnValue(json({ ok: true, step, next: '/dashboard' }))
    expect(await signIn('a@b.co', 'pw', '/dashboard')).toEqual({ ok: true, step })
  })

  // ACCESS §2: one code for an unknown email and a wrong password, decided by the API.
  it('passes the refusal through by its code, with the lock’s minutes and the tries left', async () => {
    answer.mockReturnValueOnce(json({ ok: false, code: 'INVALID_CREDENTIALS' }, 401))
    expect(await signIn('a@b.co', 'pw', '/dashboard')).toMatchObject({ ok: false, code: 'INVALID_CREDENTIALS' })
    answer.mockReturnValueOnce(json({ ok: false, code: 'LOCKED', minutes: 12 }, 401))
    expect(await verifySecondFactor('123456')).toMatchObject({ ok: false, code: 'LOCKED', minutes: 12 })
    answer.mockReturnValueOnce(json({ ok: false, code: 'WRONG_CODE', triesLeft: 3 }, 401))
    expect(await verifySecondFactor('123456')).toMatchObject({ ok: false, code: 'WRONG_CODE', triesLeft: 3 })
    answer.mockReturnValueOnce(json({ ok: false, code: 'RATE_LIMITED' }, 429))
    expect(await signIn('a@b.co', 'pw', '/dashboard')).toMatchObject({ ok: false, code: 'RATE_LIMITED' })
  })

  it('reads a code it was never promised, an unexpected answer or no answer as not connected', async () => {
    answer.mockReturnValueOnce(json({ ok: false, code: 'SOMETHING_NEW' }, 401))
    expect(await signIn('a@b.co', 'pw', '/dashboard')).toEqual({ ok: false, code: 'NOT_CONNECTED' })
    answer.mockReturnValueOnce(json({ ok: true, step: 'elsewhere' }))
    expect(await signIn('a@b.co', 'pw', '/dashboard')).toEqual({ ok: false, code: 'NOT_CONNECTED' })
    answer.mockReturnValueOnce(Promise.resolve(new Response('<html>502</html>', { status: 502 })))
    expect(await signIn('a@b.co', 'pw', '/dashboard')).toEqual({ ok: false, code: 'NOT_CONNECTED' })
    answer.mockReturnValueOnce(Promise.reject(new TypeError('Failed to fetch')))
    expect(await signIn('a@b.co', 'pw', '/dashboard')).toEqual({ ok: false, code: 'NOT_CONNECTED' })
  })
})

describe('the invitation routes', () => {
  it('looks a token up and reads the invitation', async () => {
    const found = { partner: 'Kaufladen Digital', role: 'partner-admin', email: 'petra@kaufladen.de', invitedBy: 'Jonas Weber', secondFactorRequired: true }
    answer.mockReturnValue(json({ ok: true, invitation: found }))
    expect(await invitation('tok')).toEqual({ ok: true, invitation: found })
    expect(sent()).toMatchObject({ route: '/api/auth/invitation', body: { token: 'tok' } })
  })

  it('refuses a missing token as invalid without asking', async () => {
    expect(await invitation(undefined)).toEqual({ ok: false, code: 'INVITATION_INVALID' })
    expect(await acceptInvitation(undefined, 'Petra', 'long enough password')).toEqual({ ok: false, code: 'INVITATION_INVALID' })
    expect(answer).not.toHaveBeenCalled()
  })

  it.each(['INVITATION_EXPIRED', 'INVITATION_USED', 'INVITATION_REPLACED', 'NAME_REQUIRED', 'WEAK_PASSWORD'])('passes %s through from accepting', async (code) => {
    answer.mockReturnValue(json({ ok: false, code }, 400))
    expect(await acceptInvitation('tok', 'Petra', 'pw')).toMatchObject({ ok: false, code })
  })

  it('starts enrolment with no code, then sends nothing but the session to skip', async () => {
    answer.mockReturnValueOnce(json({ ok: true, secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x' }))
    expect(await startEnrolment()).toEqual({ ok: true, secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x' })
    expect(sent()).toMatchObject({ route: '/api/auth/enrol-second-factor', body: {} })
    answer.mockReset()
    answer.mockReturnValueOnce(json({ ok: false, code: 'SECOND_FACTOR_REQUIRED' }, 400))
    expect(await skipSecondFactor()).toMatchObject({ ok: false, code: 'SECOND_FACTOR_REQUIRED' })
    expect(sent()).toMatchObject({ route: '/api/auth/skip-second-factor', body: {} })
  })
})

describe('requestPasswordReset', () => {
  it('sends the email and reads the one answer the API gives either way', async () => {
    answer.mockReturnValue(json({ ok: true }))
    expect(await requestPasswordReset('maya@northstar.com')).toEqual({ ok: true })
    expect(sent()).toMatchObject({ route: '/api/auth/request-password-reset', body: { email: 'maya@northstar.com' } })
  })
})

describe('signOut', () => {
  it('posts a form to the route, so the browser follows its redirect', () => {
    const submitted: { method: string; action: string }[] = []
    const form = { method: '', action: '', submit() { submitted.push({ method: this.method, action: this.action }) } }
    vi.stubGlobal('document', { createElement: () => form, body: { append: () => undefined } })
    signOut()
    expect(submitted).toEqual([{ method: 'post', action: '/api/auth/sign-out' }])
  })
})

describe('groupedKey', () => {
  it('prints the secret in groups of four', () => {
    expect(groupedKey('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP')
    expect(groupedKey('ABCDEF')).toBe('ABCD EF')
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

// The cache every tab shares (shared/ui sharedSessionReads.ts) is cleared whenever the person changes.
describe('a change of who is signed in', () => {
  const signedIn = [
    ['sign-in', () => signIn('a@b.co', 'pw', '/dashboard'), { ok: true, step: 'done' }],
    ['second-factor', () => verifySecondFactor('123456'), { ok: true }],
    ['accept-invitation', () => acceptInvitation('tok', 'Maya', 'a-long-password'), { ok: true, secondFactorRequired: false }],
    ['enrol-second-factor', () => enrolSecondFactor('123456'), { ok: true }],
    ['skip-second-factor', () => skipSecondFactor(), { ok: true }],
  ] as const

  it.each(signedIn)('clears every tab after a successful %s', async (_route, call, body) => {
    answer.mockReturnValue(json(body))
    await call()
    expect(identityChanged).toHaveBeenCalledTimes(1)
  })

  it.each(signedIn)('leaves them alone when %s is refused or unreadable', async (_route, call) => {
    answer.mockReturnValueOnce(json({ ok: false, code: 'INVALID_CREDENTIALS' }, 401))
    await call()
    answer.mockReturnValueOnce(json({ surprise: true }))
    await call()
    expect(identityChanged).not.toHaveBeenCalled()
  })

  it('does not clear them for a request that signs no one in', async () => {
    answer.mockReturnValue(json({ ok: true }))
    await requestPasswordReset('a@b.co')
    expect(identityChanged).not.toHaveBeenCalled()
  })

  it('clears them on sign-out, before the form leaves', () => {
    const order: string[] = []
    vi.mocked(identityChanged).mockImplementation(() => void order.push('cleared'))
    const form = { method: '', action: '', submit: () => void order.push('submitted') }
    vi.stubGlobal('document', { createElement: () => form, body: { append: () => undefined } })
    signOut()
    expect(order).toEqual(['cleared', 'submitted'])
  })
})
