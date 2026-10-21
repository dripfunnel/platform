import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createAuthClient } from './index'

const client = createAuthClient({ codes: ['WRONG_CODE', 'LOCKED'] as const, identityRoutes: new Set(['sign-in']) })
const answer = (body: unknown) => vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body)))

afterEach(() => vi.unstubAllGlobals())

describe('the auth transport', () => {
  it('keeps a promised refusal with its facts and reads any other as not connected', async () => {
    answer({ ok: false, code: 'WRONG_CODE', triesLeft: 2 })
    expect(await client.post('second-factor', {}, z.object({ ok: z.literal(true) }))).toMatchObject({ ok: false, code: 'WRONG_CODE', triesLeft: 2 })
    answer({ ok: false, code: 'SOMETHING_ELSE' })
    expect(await client.post('second-factor', {}, z.object({ ok: z.literal(true) }))).toEqual({ ok: false, code: 'NOT_CONNECTED' })
    answer({ ok: true, unexpected: 'shape' })
    expect(await client.post('second-factor', {}, z.object({ ok: z.literal(true), step: z.string() }))).toEqual({ ok: false, code: 'NOT_CONNECTED' })
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
    expect(await client.post('second-factor', {}, z.object({ ok: z.literal(true) }))).toEqual({ ok: false, code: 'NOT_CONNECTED' })
  })

  it('tells the other tabs only after a route that changes who is signed in', async () => {
    const posted: unknown[] = []
    vi.stubGlobal('BroadcastChannel', class {
      postMessage(message: unknown) {
        posted.push(message)
      }
      close() {}
    })
    answer({ ok: true })
    await client.post('request-password-reset', {}, z.object({ ok: z.literal(true) }))
    expect(posted).toHaveLength(0)
    await client.post('sign-in', {}, z.object({ ok: z.literal(true) }))
    expect(posted).toHaveLength(1)
  })
})
