import { afterEach, describe, expect, it, vi } from 'vitest'

const answering = (body: unknown, init?: ResponseInit) => {
  const calls: { url: string; body: unknown }[] = []
  vi.stubGlobal('fetch', async (url: string, request: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(request.body)) })
    return new Response(JSON.stringify(body), init)
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('the auth routes', () => {
  it('posts JSON to /api/auth and reads the next step', async () => {
    const calls = answering({ ok: true, step: 'second-factor', method: 'sms' })
    const { signIn } = await import('./auth')
    expect(await signIn('ada@example.com', 'pw', true)).toEqual({ ok: true, step: 'second-factor', method: 'sms' })
    expect(calls).toEqual([{ url: '/api/auth/sign-in', body: { email: 'ada@example.com', password: 'pw', remember: true } }])
  })

  it('keeps a refusal’s code and the facts it carries', async () => {
    answering({ ok: false, code: 'WRONG_CODE', triesLeft: 2 }, { status: 401 })
    const { verifyCode } = await import('./auth')
    expect(await verifyCode('123456')).toMatchObject({ ok: false, code: 'WRONG_CODE', triesLeft: 2 })
  })

  it('reads a code it was never promised, a malformed answer and a dropped network as not connected', async () => {
    const { signIn } = await import('./auth')
    answering({ ok: false, code: 'SOMETHING_NEW' })
    expect(await signIn('a@b.co', 'pw', false)).toEqual({ ok: false, code: 'NOT_CONNECTED' })
    answering({ ok: true, step: 'elsewhere' })
    expect(await signIn('a@b.co', 'pw', false)).toEqual({ ok: false, code: 'NOT_CONNECTED' })
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
    expect(await signIn('a@b.co', 'pw', false)).toEqual({ ok: false, code: 'NOT_CONNECTED' })
  })

  it('tells the other tabs only after a route that changes who this browser is', async () => {
    const posted: unknown[] = []
    vi.stubGlobal('BroadcastChannel', class {
      postMessage(message: unknown) {
        posted.push(message)
      }
      close() {}
    })
    const auth = await import('./auth')
    answering({ ok: true })
    await auth.requestPasswordReset('a@b.co')
    expect(posted).toHaveLength(0)
    answering({ ok: true, step: 'done' })
    await auth.signIn('a@b.co', 'pw', false)
    expect(posted).toHaveLength(1)
    answering({ ok: false, code: 'INVALID_CREDENTIALS' })
    await auth.signIn('a@b.co', 'pw', false)
    expect(posted).toHaveLength(1)
  })

  it('reads the countries a sign-up may choose', async () => {
    answering({ ok: true, step: 'store', countries: [{ code: 'IN', name: 'India', currency: 'INR' }] })
    const { verifySignupEmail } = await import('./auth')
    expect(await verifySignupEmail('123456')).toEqual({ ok: true, step: 'store', countries: [{ code: 'IN', name: 'India', currency: 'INR' }] })
  })
})

describe('subdomainFrom', () => {
  it('suggests lower-case words joined by hyphens', async () => {
    const { subdomainFrom } = await import('./auth')
    expect(subdomainFrom('Ada’s Café & Bakery')).toBe('ada-s-cafe-bakery')
    expect(subdomainFrom('  --Northstar--  ')).toBe('northstar')
    expect(subdomainFrom('日本')).toBe('')
    expect(subdomainFrom('a'.repeat(39) + ' b')).toBe('a'.repeat(39))
  })
})

describe('backupCodeFrom', () => {
  it('reads a code with or without its hyphen, in any case, and refuses anything else', async () => {
    const { backupCodeFrom } = await import('./auth')
    expect(backupCodeFrom('ABCD-EFGH')).toBe('abcd-efgh')
    expect(backupCodeFrom(' abcd efgh ')).toBe('abcd-efgh')
    expect(backupCodeFrom('abcdefgh')).toBe('abcd-efgh')
    expect(backupCodeFrom('abc-defgh')).toBeNull()
    expect(backupCodeFrom('123456')).toBeNull()
  })
})
