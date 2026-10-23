import { isApiError } from './errors'
import { postJson, postSignOut } from './rest'

const answer = (body: unknown) => jest.fn((() => Promise.resolve({ json: () => Promise.resolve(body) })) as unknown as typeof fetch)

describe('postJson', () => {
  it('posts JSON to the partner host with no cookies, and a bearer token when it has one', async () => {
    const fetchImpl = answer({ ok: true, token: 'full-token' })

    const result = await postJson({ domain: 'store.example.com', fetchImpl }, '/api/auth/second-factor', { code: '123456' }, 'pending-token')

    expect(result).toEqual({ ok: true, token: 'full-token' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string; credentials: string }]
    expect(url).toBe('https://store.example.com/api/auth/second-factor')
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', headers: { authorization: 'Bearer pending-token' } })
    expect(JSON.parse(init.body)).toEqual({ code: '123456' })
  })

  it('sends no Authorization header without a token', async () => {
    const fetchImpl = answer({ ok: true })
    await postJson({ domain: 'store.example.com', fetchImpl }, '/api/auth/sign-in', {})
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
    expect(Object.keys(init.headers)).toEqual(['content-type'])
  })

  it('turns a refusal into an ApiError with its code and the facts it carries', async () => {
    const error = await postJson({ domain: 'store.example.com', fetchImpl: answer({ ok: false, code: 'LOCKED', minutes: 15 }) }, '/api/auth/sign-in', {}).catch((e: unknown) => e)

    expect(isApiError(error, 'LOCKED')).toBe(true)
    expect((error as { details: unknown }).details).toEqual({ minutes: 15 })
  })

  it('answers NO_RESPONSE for a network failure, and for a page that is not the API’s JSON', async () => {
    const down = postJson({ domain: 'store.example.com', fetchImpl: () => Promise.reject(new TypeError('Network request failed')) }, '/api/auth/sign-in', {})
    const page = postJson({ domain: 'store.example.com', fetchImpl: (() => Promise.resolve({ json: () => Promise.reject(new SyntaxError('<html>')) })) as unknown as typeof fetch }, '/api/auth/sign-in', {})
    await expect(down).rejects.toMatchObject({ code: 'NO_RESPONSE' })
    await expect(page).rejects.toMatchObject({ code: 'NO_RESPONSE' })
  })

  it('gives up on a call that does not answer within the timeout', async () => {
    jest.useFakeTimers()
    try {
      const hang = ((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch
      const pending = postJson({ domain: 'store.example.com', fetchImpl: hang, timeoutMs: 500 }, '/api/auth/sign-in', {})
      const settled = expect(pending).rejects.toMatchObject({ code: 'NO_RESPONSE' })
      await jest.advanceTimersByTimeAsync(500)
      await settled
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('postSignOut', () => {
  it('ends the session with the bearer token and does not follow the redirect', async () => {
    const fetchImpl = answer({})
    await postSignOut({ domain: 'store.example.com', fetchImpl }, '/api/auth/sign-out', 'full-token')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string>; redirect: string; credentials: string }]
    expect(url).toBe('https://store.example.com/api/auth/sign-out')
    expect(init).toMatchObject({ headers: { authorization: 'Bearer full-token' }, redirect: 'manual', credentials: 'omit' })
  })

  it('does not fail when the API cannot be reached', async () => {
    await expect(postSignOut({ domain: 'store.example.com', fetchImpl: () => Promise.reject(new Error('offline')) }, '/api/auth/sign-out', 'full-token')).resolves.toBeUndefined()
  })
})
