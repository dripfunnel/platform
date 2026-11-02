import { createSessionStore, type SessionStorage } from '../../session/sessionStore'
import { t } from '../../messages'
import { createPendingStore } from './pending'
import { confirmEnrolCode, failureOf, finishEnrol, resendCode, sendEnrolCode, signOut, startGoogleSignIn, startSignIn, submitBackupCode, submitCode } from './signInFlow'

type Call = { path: string; body: Record<string, unknown>; authorization: string | null; credentials: string | undefined }

// A fake portal host: each route answers like the Store API's (apps/api src/apis/store/auth.ts), and every call is kept.
const portal = (routes: Record<string, (body: Record<string, unknown>) => Record<string, unknown>>) => {
  const calls: Call[] = []
  const fetchImpl = ((url: string, init: { body?: string; headers?: Record<string, string>; credentials?: string }) => {
    const path = new URL(url).pathname
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    calls.push({ path, body, authorization: init.headers?.authorization ?? null, credentials: init.credentials })
    const route = routes[path]
    return route ? Promise.resolve({ json: () => Promise.resolve(route(body)) }) : Promise.reject(new TypeError('Network request failed'))
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

const refusal = (code: string, more: Record<string, unknown> = {}) => ({ ok: false, code, ...more })

const setup = (routes: Parameters<typeof portal>[0]) => {
  const kept: { token: string | null } = { token: null }
  const storage: SessionStorage = {
    read: () => Promise.resolve({ token: kept.token, last: null }),
    writeToken: (token) => Promise.resolve(void (kept.token = token)),
    writeLast: () => Promise.resolve(),
    wipe: () => Promise.resolve(void (kept.token = null)),
  }
  const { calls, fetchImpl } = portal(routes)
  const session = createSessionStore(storage)
  const pending = createPendingStore()
  return { kept, calls, session, pending, deps: { rest: { domain: 'store.example.com', fetchImpl }, session, pending } }
}

describe('signing in', () => {
  it('opens the session for a person with no second factor, and keeps its token', async () => {
    const { deps, session, pending, kept, calls } = setup({ '/api/auth/sign-in': () => ({ ok: true, step: 'done', token: 'full-token' }) })

    await expect(startSignIn(deps, ' staff@example.com ', 'a long password')).resolves.toBe('done')

    expect(session.token()).toBe('full-token')
    expect(kept.token).toBe('full-token')
    expect(pending.get()).toBeNull()
    expect(calls[0]).toMatchObject({ body: { email: 'staff@example.com', password: 'a long password' }, authorization: null })
  })

  it('never sends or keeps a cookie', async () => {
    const { deps, calls } = setup({ '/api/auth/sign-in': () => ({ ok: true, step: 'done', token: 'full-token' }) })
    await startSignIn(deps, 'a@example.com', 'a long password')
    expect(calls.every((call) => call.credentials === 'omit')).toBe(true)
  })

  it('holds a half-open session in memory only, until the second factor is given', async () => {
    const { deps, session, pending, kept } = setup({
      '/api/auth/sign-in': () => ({ ok: true, step: 'second-factor', method: 'app', token: 'pending-token' }),
    })

    await expect(startSignIn(deps, 'owner@example.com', 'a long password')).resolves.toBe('second-factor')

    expect(pending.get()).toMatchObject({ step: 'second-factor', method: 'app', token: 'pending-token' })
    expect(session.getState().status).toBe('starting')
    expect(kept.token).toBeNull()
  })
})

describe('the second factor', () => {
  const twoFactor = (method: 'app' | 'sms') => ({
    '/api/auth/sign-in': () => ({ ok: true, step: 'second-factor', method, token: 'pending-token' }),
    '/api/auth/send-code': () => ({ ok: true, hint: '•••• 0142' }),
    '/api/auth/second-factor': (body: Record<string, unknown>) => (body.code === '123456' ? { ok: true, token: 'full-token' } : refusal('WRONG_CODE', { triesLeft: 4 })),
    '/api/auth/backup-code': (body: Record<string, unknown>) => (body.code === 'K4P2-9XQM' ? { ok: true, left: 9, token: 'full-token' } : refusal('WRONG_CODE', { triesLeft: 4 })),
  })

  it('by authenticator app: asks for the code and sends none', async () => {
    const { deps, session, calls, pending } = setup(twoFactor('app'))
    await startSignIn(deps, 'owner@example.com', 'a long password')

    expect(calls.map((call) => call.path)).toEqual(['/api/auth/sign-in'])

    await submitCode(deps, '123456')

    expect(session.token()).toBe('full-token')
    expect(pending.get()).toBeNull()
    expect(calls.at(-1)).toMatchObject({ path: '/api/auth/second-factor', authorization: 'Bearer pending-token', body: { code: '123456' } })
  })

  it('by text message: texts the code as the step opens, and can ask again', async () => {
    const { deps, calls, pending } = setup(twoFactor('sms'))

    await startSignIn(deps, 'owner@example.com', 'a long password')
    expect(pending.get()).toMatchObject({ step: 'second-factor', method: 'sms', hint: '•••• 0142' })
    expect(calls.map((call) => call.path)).toEqual(['/api/auth/sign-in', '/api/auth/send-code'])

    await resendCode(deps)
    expect(calls.at(-1)).toMatchObject({ path: '/api/auth/send-code', authorization: 'Bearer pending-token' })
  })

  it('still opens the code step when the text could not be sent', async () => {
    const { deps, pending } = setup({ '/api/auth/sign-in': () => ({ ok: true, step: 'second-factor', method: 'sms', token: 'pending-token' }) })
    await startSignIn(deps, 'owner@example.com', 'a long password')
    expect(pending.get()).toMatchObject({ step: 'second-factor', method: 'sms', hint: null })
  })

  it('by backup code: opens the session', async () => {
    const { deps, session } = setup(twoFactor('sms'))
    await startSignIn(deps, 'owner@example.com', 'a long password')

    await submitBackupCode(deps, ' K4P2-9XQM ')

    expect(session.token()).toBe('full-token')
  })

  it('refuses a wrong code with the tries left, and stays on the step', async () => {
    const { deps, session, pending } = setup(twoFactor('app'))
    await startSignIn(deps, 'owner@example.com', 'a long password')

    const error = await submitCode(deps, '000000').catch((e: unknown) => e)

    expect(failureOf(error, 'code').message).toBe('That code doesn’t match. 4 tries left before sign-in is paused.')
    expect(pending.get()?.step).toBe('second-factor')
    expect(session.token()).toBeNull()
  })

  it('sends the person back to sign in when there is no first step behind it', async () => {
    const { deps } = setup(twoFactor('app'))
    const error = await submitCode(deps, '123456').catch((e: unknown) => e)
    expect(failureOf(error, 'code')).toMatchObject({ expired: true })
  })

  it('sends the person back to sign in when the API no longer knows the pending session', async () => {
    const { deps } = setup({ ...twoFactor('app'), '/api/auth/second-factor': () => refusal('INVALID_CREDENTIALS') })
    await startSignIn(deps, 'owner@example.com', 'a long password')
    const error = await submitCode(deps, '123456').catch((e: unknown) => e)
    expect(failureOf(error, 'code')).toMatchObject({ expired: true, message: 'Your sign-in timed out. Start again.' })
  })
})

describe('an Owner without two-step sign-in', () => {
  const enrolment = {
    '/api/auth/sign-in': () => ({ ok: true, step: 'enrol', token: 'enrol-token' }),
    '/api/auth/enrol-second-factor': (body: Record<string, unknown>) =>
      body.code === undefined ? { ok: true, hint: '•••• 0142' } : body.code === '654321' ? { ok: true, done: true, backupCodes: ['AAAA-1111', 'BBBB-2222'], token: 'full-token' } : refusal('WRONG_CODE'),
  }

  it('is held at set-up: the number, the code, then the backup codes shown once, and only then signed in', async () => {
    const { deps, session, pending, calls, kept } = setup(enrolment)

    await expect(startSignIn(deps, 'owner@example.com', 'a long password')).resolves.toBe('enrol')
    expect(pending.get()).toMatchObject({ step: 'enrol', phase: 'phone' })

    await sendEnrolCode(deps, ' +919845011234 ')
    expect(pending.get()).toMatchObject({ phase: 'code', hint: '•••• 0142', phone: '+919845011234' })
    expect(calls.at(-1)).toMatchObject({ authorization: 'Bearer enrol-token', body: { method: 'sms', phone: '+919845011234' } })

    await confirmEnrolCode(deps, '654321')
    expect(pending.get()).toMatchObject({ phase: 'codes', codes: ['AAAA-1111', 'BBBB-2222'], finalToken: 'full-token' })
    expect(session.token()).toBeNull()
    expect(kept.token).toBeNull()

    await finishEnrol(deps)
    expect(session.token()).toBe('full-token')
    expect(pending.get()).toBeNull()
  })

  it('keeps the person on the code step after a wrong code', async () => {
    const { deps, pending } = setup(enrolment)
    await startSignIn(deps, 'owner@example.com', 'a long password')
    await sendEnrolCode(deps, '+919845011234')

    const error = await confirmEnrolCode(deps, '000000').catch((e: unknown) => e)

    expect(failureOf(error, 'code').message).toBe('That code doesn’t match.')
    expect(pending.get()).toMatchObject({ phase: 'code' })
  })
})

describe('a refused sign-in', () => {
  it('shows one message that does not say whether the account exists', async () => {
    const wrongPassword = setup({ '/api/auth/sign-in': () => refusal('INVALID_CREDENTIALS') })
    const noAccount = setup({ '/api/auth/sign-in': () => refusal('INVALID_CREDENTIALS') })

    const forWrongPassword = await startSignIn(wrongPassword.deps, 'owner@example.com', 'wrong password').catch((e: unknown) => failureOf(e, 'signIn'))
    const forNoAccount = await startSignIn(noAccount.deps, 'nobody@example.com', 'wrong password').catch((e: unknown) => failureOf(e, 'signIn'))

    expect(forWrongPassword).toEqual(forNoAccount)
    expect(forWrongPassword).toMatchObject({ locked: null, message: 'That email and password don’t match. Check them, or reset your password.' })
    expect(JSON.stringify(forWrongPassword).toLowerCase()).not.toMatch(/exist|no account|not found|unknown email/)
  })

  it('opens the paused-sign-in screen with the minutes the API gave', async () => {
    const { deps } = setup({ '/api/auth/sign-in': () => refusal('LOCKED', { minutes: 12 }) })
    const failure = await startSignIn(deps, 'owner@example.com', 'a long password').catch((e: unknown) => failureOf(e, 'signIn'))
    expect(failure).toMatchObject({ locked: 12 })
  })

  it('says so when there is no network, without signing anyone in', async () => {
    const { deps, session } = setup({})
    const failure = await startSignIn(deps, 'owner@example.com', 'a long password').catch((e: unknown) => failureOf(e, 'signIn'))
    expect(failure).toMatchObject({ locked: null, message: 'We couldn’t reach the server. Check your connection and try again.' })
    expect(session.token()).toBeNull()
  })
})

describe('signing out', () => {
  it('tells the API, wipes the token and says the person is signed out of every store', async () => {
    const { deps, session, kept, calls } = setup({ '/api/auth/sign-out': () => ({}) })
    await session.open('full-token')

    await signOut(deps)

    expect(calls[0]).toMatchObject({ path: '/api/auth/sign-out', authorization: 'Bearer full-token' })
    expect(kept.token).toBeNull()
    expect(session.getState()).toEqual({ status: 'signedOut', notice: 'signedOut' })
  })

  it('wipes the token even when the API cannot be reached', async () => {
    const { deps, session, kept } = setup({})
    await session.open('full-token')

    await signOut(deps)

    expect(kept.token).toBeNull()
    expect(session.token()).toBeNull()
  })
})

describe('signing in with Google', () => {
  it('sends Google’s ID token and opens the session as a password would', async () => {
    const { deps, session, calls } = setup({ '/api/auth/google/token': () => ({ ok: true, step: 'done', token: 'full-token' }) })
    await expect(startGoogleSignIn(deps, 'google-id-token')).resolves.toBe('done')
    expect(session.token()).toBe('full-token')
    expect(calls[0]).toMatchObject({ path: '/api/auth/google/token', body: { idToken: 'google-id-token' }, authorization: null, credentials: 'omit' })
  })

  it('still asks for the second factor, and holds an Owner without one at set-up', async () => {
    const twoStep = setup({ '/api/auth/google/token': () => ({ ok: true, step: 'second-factor', method: 'app', token: 'pending-token' }) })
    await expect(startGoogleSignIn(twoStep.deps, 'id')).resolves.toBe('second-factor')
    expect(twoStep.session.token()).toBeNull()
    expect(twoStep.pending.get()).toMatchObject({ step: 'second-factor', token: 'pending-token', method: 'app' })
    const owner = setup({ '/api/auth/google/token': () => ({ ok: true, step: 'enrol', token: 'pending-token' }) })
    await expect(startGoogleSignIn(owner.deps, 'id')).resolves.toBe('enrol')
  })

  it('words no account, a refused token and Google turned off, and takes the lock to its screen', async () => {
    for (const [code, key] of [['NO_ACCOUNT', 'NO_ACCOUNT'], ['GOOGLE_REFUSED', 'GOOGLE_REFUSED'], ['GOOGLE_UNAVAILABLE', 'GOOGLE_UNAVAILABLE']] as const) {
      const { deps } = setup({ '/api/auth/google/token': () => refusal(code) })
      const failed = await startGoogleSignIn(deps, 'id').catch((e: unknown) => e)
      expect(failureOf(failed, 'google').message).toBe(t(`errors.google.${key}`))
    }
    const { deps } = setup({ '/api/auth/google/token': () => refusal('LOCKED', { minutes: 12 }) })
    expect(failureOf(await startGoogleSignIn(deps, 'id').catch((e: unknown) => e), 'google').locked).toBe(12)
  })
})

