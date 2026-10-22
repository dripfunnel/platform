import { createApiClient } from './client'
import { ApiError, isApiError, knownErrorCodes } from './errors'

const answer = (body: unknown): typeof fetch => (() => Promise.resolve({ json: () => Promise.resolve(body) })) as unknown as typeof fetch

const lastCall = (fetchImpl: jest.Mock) => {
  const [url, init] = fetchImpl.mock.calls.at(-1) as [string, { method: string; headers: Record<string, string>; body: string }]
  return { url, init }
}

const madeByTheApp = ['NO_RESPONSE', 'BAD_RESPONSE', 'UNKNOWN']

describe('the API client', () => {
  it('posts JSON to the partner host at /api/, with the trailing slash', async () => {
    const fetchImpl = jest.fn(answer({ data: { ok: true } }))
    const client = createApiClient({ domain: 'store.example.com', fetchImpl })

    await expect(client.request('{ ok }', { a: 1 })).resolves.toEqual({ ok: true })

    const { url, init } = lastCall(fetchImpl)
    expect(url).toBe('https://store.example.com/api/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ query: '{ ok }', variables: { a: 1 } })
  })

  it('sends a query as a GET on request, with no body', async () => {
    const fetchImpl = jest.fn(answer({ data: { ok: true } }))
    const client = createApiClient({ domain: 'store.example.com', fetchImpl })

    await expect(client.request('{ ok }', undefined, { get: true })).resolves.toEqual({ ok: true })

    const { url, init } = lastCall(fetchImpl)
    expect(url).toBe('https://store.example.com/api/?query=%7B%20ok%20%7D')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
  })

  it('sends no credentials until there are some', async () => {
    const fetchImpl = jest.fn(answer({ data: {} }))
    await createApiClient({ domain: 'store.example.com', fetchImpl }).request('{ brand }')
    expect(Object.keys(lastCall(fetchImpl).init.headers)).toEqual(['content-type'])
  })

  it('adds the bearer token, X-Store and X-Supplier, read afresh on every call', async () => {
    const fetchImpl = jest.fn(answer({ data: {} }))
    let store: string | null = 'store-1'
    const client = createApiClient({ domain: 'store.example.com', fetchImpl, token: () => 't0ken', store: () => store, supplier: () => 'supplier-1' })

    await client.request('{ a }')
    expect(lastCall(fetchImpl).init.headers).toMatchObject({ authorization: 'Bearer t0ken', 'x-store': 'store-1', 'x-supplier': 'supplier-1' })

    store = 'store-2'
    await client.request('{ a }')
    expect(lastCall(fetchImpl).init.headers['x-store']).toBe('store-2')
  })

  it.each(knownErrorCodes.filter((code) => !madeByTheApp.includes(code)))('maps the API code %s to an ApiError with that code', async (code) => {
    const client = createApiClient({ domain: 'store.example.com', fetchImpl: answer({ errors: [{ message: 'Refused.', extensions: { code, unlockedBy: 'growth' } }] }) })

    const error = await client.request('{ a }').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(isApiError(error, code)).toBe(true)
    expect((error as ApiError).details).toEqual({ unlockedBy: 'growth' })
  })

  it('gives a code it has no name for, or no code at all, the code UNKNOWN', async () => {
    const odd = createApiClient({ domain: 'store.example.com', fetchImpl: answer({ errors: [{ message: 'x', extensions: { code: 'SOMETHING_NEW' } }] }) })
    const none = createApiClient({ domain: 'store.example.com', fetchImpl: answer({ errors: [{ message: 'x' }] }) })
    await expect(odd.request('{ a }')).rejects.toMatchObject({ code: 'UNKNOWN' })
    await expect(none.request('{ a }')).rejects.toMatchObject({ code: 'UNKNOWN' })
  })

  it('answers NO_RESPONSE when the network fails or the answer is not JSON (a gateway page)', async () => {
    const down = createApiClient({ domain: 'store.example.com', fetchImpl: () => Promise.reject(new TypeError('Network request failed')) })
    const page = createApiClient({ domain: 'store.example.com', fetchImpl: (() => Promise.resolve({ json: () => Promise.reject(new SyntaxError('<html>')) })) as unknown as typeof fetch })
    await expect(down.request('{ a }')).rejects.toMatchObject({ code: 'NO_RESPONSE' })
    await expect(page.request('{ a }')).rejects.toMatchObject({ code: 'NO_RESPONSE' })
  })

  it('answers BAD_RESPONSE for an answer with no data', async () => {
    const client = createApiClient({ domain: 'store.example.com', fetchImpl: answer({}) })
    await expect(client.request('{ a }')).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })

  it('gives up on a call that does not answer within the timeout', async () => {
    jest.useFakeTimers()
    try {
      const hang = ((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch
      const pending = createApiClient({ domain: 'store.example.com', fetchImpl: hang, timeoutMs: 1000 }).request('{ a }')
      const settled = expect(pending).rejects.toMatchObject({ code: 'NO_RESPONSE' })
      await jest.advanceTimersByTimeAsync(1000)
      await settled
    } finally {
      jest.useRealTimers()
    }
  })

  it('never puts the token in an error', async () => {
    const client = createApiClient({ domain: 'store.example.com', token: () => 'secret-t0ken', fetchImpl: () => Promise.reject(new Error('secret-t0ken')) })
    const error = (await client.request('{ a }').catch((e: unknown) => e)) as ApiError
    expect(error.message).not.toContain('secret-t0ken')
    expect(JSON.stringify(error.details)).not.toContain('secret-t0ken')
  })
})
