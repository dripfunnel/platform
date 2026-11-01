import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from './client'

afterEach(() => vi.unstubAllGlobals())

const answering = (response: Promise<Response>) => vi.stubGlobal('fetch', () => response)

describe('createApiClient', () => {
  it('returns the data, and the API’s own code when it refuses', async () => {
    answering(Promise.resolve(new Response(JSON.stringify({ data: { health: 'ok' } }))))
    expect(await createApiClient().request('{ health }')).toEqual({ health: 'ok' })
    answering(Promise.resolve(new Response(JSON.stringify({ errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] }))))
    await expect(createApiClient().request('{ health }')).rejects.toMatchObject({ code: 'FORBIDDEN', details: {} })
  })

  it('keeps a refusal’s other facts beside its code', async () => {
    answering(Promise.resolve(new Response(JSON.stringify({ errors: [{ message: 'finish first', extensions: { code: 'STORY_INCOMPLETE', gaps: [{ moduleId: 'a', field: 'alt' }] } }] }))))
    await expect(createApiClient().request('{ health }')).rejects.toMatchObject({ code: 'STORY_INCOMPLETE', details: { gaps: [{ moduleId: 'a', field: 'alt' }] } })
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

describe('requestPartial', () => {
  it('returns the fields that answered beside each refused field, by its path', async () => {
    answering(Promise.resolve(new Response(JSON.stringify({ data: { me: { id: 'u1' }, storeState: null }, errors: [{ message: 'no', path: ['storeState'], extensions: { code: 'FORBIDDEN', store: 's1' } }] }))))
    const { data, errors } = await createApiClient().requestPartial<{ me: { id: string }; storeState: null }>('{ me { id } storeState { readOnly } }')
    expect(data).toEqual({ me: { id: 'u1' }, storeState: null })
    expect(errors).toEqual([{ path: ['storeState'], error: new ApiError('FORBIDDEN', 'no', { store: 's1' }) }])
  })

  it('returns no errors for a full answer', async () => {
    answering(Promise.resolve(new Response(JSON.stringify({ data: { health: 'ok' } }))))
    expect(await createApiClient().requestPartial('{ health }')).toEqual({ data: { health: 'ok' }, errors: [] })
  })

  it('throws as request does when the answer carries no data at all', async () => {
    answering(Promise.resolve(new Response(JSON.stringify({ data: null, errors: [{ message: 'bad query', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] }))))
    await expect(createApiClient().requestPartial('{ nope }')).rejects.toMatchObject({ code: 'GRAPHQL_VALIDATION_FAILED' })
    answering(Promise.resolve(new Response(JSON.stringify({}))))
    await expect(createApiClient().requestPartial('{ health }')).rejects.toMatchObject({ code: 'EMPTY_RESPONSE' })
    answering(Promise.reject(new TypeError('Failed to fetch')))
    await expect(createApiClient().requestPartial('{ health }')).rejects.toMatchObject({ code: 'NOT_CONNECTED' })
  })

  it('leaves request unchanged: any error in a partial answer still throws there', async () => {
    answering(Promise.resolve(new Response(JSON.stringify({ data: { me: { id: 'u1' }, storeState: null }, errors: [{ message: 'no', path: ['storeState'], extensions: { code: 'FORBIDDEN' } }] }))))
    await expect(createApiClient().request('{ me { id } storeState { readOnly } }')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
