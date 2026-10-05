import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from './client'

afterEach(() => vi.unstubAllGlobals())

const answering = (response: Promise<Response>) => vi.stubGlobal('fetch', () => response)

describe('createApiClient', () => {
  it('returns the data, and the API’s own code when it refuses', async () => {
    answering(Promise.resolve(new Response(JSON.stringify({ data: { health: 'ok' } }))))
    expect(await createApiClient().request('{ health }')).toEqual({ health: 'ok' })
    answering(Promise.resolve(new Response(JSON.stringify({ errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] }))))
    await expect(createApiClient().request('{ health }')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('sends the headers its caller names, read afresh on every call', async () => {
    const seen: Headers[] = []
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers))
      return Promise.resolve(new Response(JSON.stringify({ data: { health: 'ok' } })))
    })
    let store = 's1'
    const client = createApiClient({ headers: () => ({ 'x-store': store }) })
    await client.request('{ health }')
    store = 's2'
    await client.request('{ health }')
    expect(seen.map((h) => h.get('x-store'))).toEqual(['s1', 's2'])
    expect(seen[0]?.get('content-type')).toBe('application/json')
  })

  // A stopped Worker behind the dev proxy answers 502 with an empty body; a dropped network throws.
  it('reads no answer, or an answer that is not the API’s JSON, as NOT_CONNECTED', async () => {
    answering(Promise.resolve(new Response('', { status: 502 })))
    await expect(createApiClient().request('{ health }')).rejects.toEqual(new ApiError('NOT_CONNECTED', 'The API did not answer.'))
    answering(Promise.reject(new TypeError('Failed to fetch')))
    await expect(createApiClient().request('{ health }')).rejects.toMatchObject({ code: 'NOT_CONNECTED' })
  })
})
