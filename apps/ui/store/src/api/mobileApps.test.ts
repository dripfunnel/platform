import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadAppFile } from './mobileApps'

// The upload route's answers, as the portal reads them (SH 15).

const answer = (body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body))))

afterEach(() => vi.unstubAllGlobals())

describe('uploading an app image', () => {
  it('answers the key the server stored it under', async () => {
    answer({ ok: true, key: 'stores/s1/app/appIcon-1.png' })
    expect(await uploadAppFile('appIcon', new Blob(['x']))).toEqual({ ok: true, key: 'stores/s1/app/appIcon-1.png' })
  })

  it('keeps the rule the server says was broken, and says a server fault is the server’s, not the connection’s', async () => {
    for (const code of ['WRONG_DIMENSIONS', 'HAS_TRANSPARENCY', 'PLAN_LIMIT', 'UNAVAILABLE', 'INVALID_KIND'] as const) {
      answer({ ok: false, code })
      expect(await uploadAppFile('appIcon', new Blob(['x']))).toEqual({ ok: false, code })
    }
  })

  it('reads a code it was never promised, a malformed answer and a dropped network as not connected', async () => {
    answer({ ok: false, code: 'SOMETHING_NEW' })
    expect(await uploadAppFile('appIcon', new Blob(['x']))).toEqual({ ok: false, code: 'NOT_CONNECTED' })
    answer({ nonsense: true })
    expect(await uploadAppFile('appIcon', new Blob(['x']))).toEqual({ ok: false, code: 'NOT_CONNECTED' })
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    expect(await uploadAppFile('appIcon', new Blob(['x']))).toEqual({ ok: false, code: 'NOT_CONNECTED' })
  })
})
