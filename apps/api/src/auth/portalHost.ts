import { isUuid } from '#core/ids'

/** The data centre's own cache (`caches.default`); absent off Cloudflare, where every lookup reads the database. */
export interface PortalHostCache {
  match: (key: Request) => Promise<Response | undefined>
  put: (key: Request, response: Response) => Promise<void>
}

export interface PortalHostCaching {
  cache: PortalHostCache | null
  /** `ctx.waitUntil`, so the write never delays the response. */
  keep: (work: Promise<void>) => void
}

// The edge lookup's limit (SAAS.md §8): a removed domain or closed partner resolves for up to this long.
const portalHostSeconds = 60

/** An `.invalid` address of its own, so no real request or Shop cache key (`shop-cache.invalid`) can match it. */
export const portalHostKey = (host: string): Request => new Request(`https://portal-host.invalid/${encodeURIComponent(host.toLowerCase())}`)

/** The host's partner from the cache, or else from `lookup`; only a found partner is kept (ARCHITECTURE.md §2). */
export const throughPortalHostCache = async (caching: PortalHostCaching | null, host: string, lookup: () => Promise<string | null>): Promise<string | null> => {
  const cache = caching?.cache
  if (!caching || !cache) return lookup()
  const key = portalHostKey(host)
  const hit = await cache.match(key)
  if (hit) {
    const partnerId = await hit.text()
    if (isUuid(partnerId)) return partnerId
  }
  const partnerId = await lookup()
  if (partnerId) caching.keep(cache.put(key, new Response(partnerId, { headers: { 'content-type': 'text/plain', 'cache-control': `public, max-age=${portalHostSeconds}` } })))
  return partnerId
}
