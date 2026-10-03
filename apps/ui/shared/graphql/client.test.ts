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

  // A stopped Worker behind the dev proxy answers 502 with an empty body; a dropped network throws.
  it('reads no answer, or an answer that is not the API’s JSON, as NOT_CONNECTED', async () => {
    answering(Promise.resolve(new Response('', { status: 502 })))
    await expect(createApiClient().request('{ health }')).rejects.toEqual(new ApiError('NOT_CONNECTED', 'The API did not answer.'))
    answering(Promise.reject(new TypeError('Failed to fetch')))
    await expect(createApiClient().request('{ health }')).rejects.toMatchObject({ code: 'NOT_CONNECTED' })
  })
})
