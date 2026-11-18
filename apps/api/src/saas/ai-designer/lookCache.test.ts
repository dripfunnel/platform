import { describe, expect, it, vi } from 'vitest'
import { lookKey, throughLookCache, type LookCache, type SiteLook } from './lookCache'

const memory = (): LookCache & { size: () => number } => {
  const kept = new Map<string, string>()
  return {
    match: async (key) => (kept.has(key.url) ? new Response(kept.get(key.url)) : undefined),
    put: async (key, response) => void kept.set(key.url, await response.text()),
    size: () => kept.size,
  }
}

const look: SiteLook = { shots: [{ mediaType: 'image/jpeg', base64: 'AAAA' }], measured: null }

describe('a sample site’s look kept for the session', () => {
  it('is taken once, then read from the cache on a later turn', async () => {
    const cache = memory()
    const take = vi.fn(async () => look)
    const key = lookKey('store-a', 'desktop', 'https://example.com/')
    expect(await throughLookCache(cache, key, take)).toEqual(look)
    expect(await throughLookCache(cache, key, take)).toEqual(look)
    expect(take).toHaveBeenCalledTimes(1)
  })

  it('keeps nothing that failed or has no screenshots, so the next turn tries again', async () => {
    const cache = memory()
    const key = lookKey('store-a', 'desktop', 'https://example.com/')
    await throughLookCache(cache, key, async () => null)
    await throughLookCache(cache, key, async () => ({ shots: [], measured: null }))
    expect(cache.size()).toBe(0)
  })

  it('is keyed by store and device, so one store never reads another’s', () => {
    const site = 'https://example.com/'
    expect(lookKey('store-a', 'desktop', site).url).not.toBe(lookKey('store-b', 'desktop', site).url)
    expect(lookKey('store-a', 'desktop', site).url).not.toBe(lookKey('store-a', 'phone', site).url)
  })

  it('takes the look again when what the cache holds isn’t a look', async () => {
    const cache = memory()
    const key = lookKey('store-a', 'desktop', 'https://example.com/')
    await cache.put(key, new Response('{"shots":"nope"}'))
    const take = vi.fn(async () => look)
    expect(await throughLookCache(cache, key, take)).toEqual(look)
    expect(take).toHaveBeenCalledTimes(1)
  })

  it('takes the look every time off Cloudflare', async () => {
    const take = vi.fn(async () => look)
    await throughLookCache(null, lookKey('store-a', 'desktop', 'https://example.com/'), take)
    await throughLookCache(null, lookKey('store-a', 'desktop', 'https://example.com/'), take)
    expect(take).toHaveBeenCalledTimes(2)
  })
})
