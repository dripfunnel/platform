import { describe, expect, it } from 'vitest'
import { portalHostKey, throughPortalHostCache, type PortalHostCache } from './portalHost'

const partnerA = '0b6f3c1e-5a2d-4f7e-9c1b-2d3e4f5a6b7c'

// A data centre's cache: keeps an entry for its max-age, read against a clock the test moves.
const dataCentre = () => {
  let now = 0
  const kept = new Map<string, { body: string; until: number }>()
  const cache: PortalHostCache = {
    match: async (key) => {
      const entry = kept.get(key.url)
      return entry && entry.until > now ? new Response(entry.body) : undefined
    },
    put: async (key, response) => {
      const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 0)
      kept.set(key.url, { body: await response.text(), until: now + maxAge * 1000 })
    },
  }
  return { cache, kept, advance: (ms: number) => (now += ms) }
}

const counted = (answer: () => string | null) => {
  const lookup = async () => {
    lookup.calls += 1
    return answer()
  }
  lookup.calls = 0
  return lookup
}

describe('the portal host cache', () => {
  it('answers a second lookup within 60 s from the cache, and asks the database again after', async () => {
    const { cache, advance } = dataCentre()
    const waits: Promise<void>[] = []
    const caching = { cache, keep: (w: Promise<void>) => void waits.push(w) }
    const lookup = counted(() => partnerA)
    expect(await throughPortalHostCache(caching, 'store.partner-a.example', lookup)).toBe(partnerA)
    await Promise.all(waits)
    advance(59_000)
    expect(await throughPortalHostCache(caching, 'store.partner-a.example', lookup)).toBe(partnerA)
    expect(lookup.calls).toBe(1)
    advance(1_000)
    expect(await throughPortalHostCache(caching, 'store.partner-a.example', lookup)).toBe(partnerA)
    expect(lookup.calls).toBe(2)
  })

  it('never keeps a host no partner holds, so it resolves as soon as its domain is live', async () => {
    const { cache, kept } = dataCentre()
    const waits: Promise<void>[] = []
    const caching = { cache, keep: (w: Promise<void>) => void waits.push(w) }
    let live = false
    const lookup = counted(() => (live ? partnerA : null))
    expect(await throughPortalHostCache(caching, 'store.new.example', lookup)).toBeNull()
    expect([waits.length, kept.size]).toEqual([0, 0])
    live = true
    expect(await throughPortalHostCache(caching, 'store.new.example', lookup)).toBe(partnerA)
    expect(lookup.calls).toBe(2)
  })

  it('shares one entry between hosts that differ only in case, under a key no Shop cache key matches', async () => {
    const { cache, kept } = dataCentre()
    const waits: Promise<void>[] = []
    const caching = { cache, keep: (w: Promise<void>) => void waits.push(w) }
    const lookup = counted(() => partnerA)
    await throughPortalHostCache(caching, 'Store.Partner-A.example', lookup)
    await Promise.all(waits)
    expect(await throughPortalHostCache(caching, 'store.partner-a.EXAMPLE', lookup)).toBe(partnerA)
    expect([lookup.calls, kept.size]).toEqual([1, 1])
    expect(portalHostKey('Store.Partner-A.example').url).toBe('https://portal-host.invalid/store.partner-a.example')
  })

  it('reads the database when an entry is not a partner id', async () => {
    const lookup = counted(() => partnerA)
    const cache: PortalHostCache = { match: async () => new Response('not-an-id'), put: async () => undefined }
    expect(await throughPortalHostCache({ cache, keep: () => undefined }, 'store.partner-a.example', lookup)).toBe(partnerA)
    expect(lookup.calls).toBe(1)
  })

  it('reads the database on every lookup without a cache', async () => {
    const lookup = counted(() => partnerA)
    await throughPortalHostCache(null, 'store.partner-a.example', lookup)
    await throughPortalHostCache({ cache: null, keep: () => undefined }, 'store.partner-a.example', lookup)
    expect(lookup.calls).toBe(2)
  })
})
