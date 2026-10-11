import type { Deps } from './deps'
import { remember } from './deps'
import { parseLiveHost, parseRedirect, type LiveHost } from './edge'
import { fileHeaders, relativeKey } from './files'
import { page } from './pages'

// A storefront host (storefront LIVE-SHOP.md §5): the store only from the hostname, its live build's files from the edge
// cache or R2, `/shop-api/*` to the API. HTML passes through untouched, with the headers the build recorded.

/** LIVE-SHOP §5 step 1: a switch reaches every data centre within this. */
export const lookupSeconds = 60
const immutable = 'public, max-age=31536000, immutable'

// Must match apps/api/src/saas/storefronts/edge.ts, which the purge names.
export const lookupTags = (host: string, found: LiveHost): string[] =>
  found.kind === 'store' ? [`df-store-${found.storeId}`, `df-host-${host}`, `df-partner-${found.partnerId}`] : [`df-host-${host}`]

/** Cached per data centre for at most a minute, never in KV; a miss asks the API (LIVE-SHOP §5 step 1). */
export const lookupHost = async (host: string, deps: Deps): Promise<LiveHost> => {
  const key = `https://${host}/__df/lookup`
  const hit = await deps.cache.match(key)
  if (hit) return parseLiveHost(await hit.json())
  const found = parseLiveHost(await deps.edge.liveHost(host))
  remember(deps, key, new Response(JSON.stringify(found), { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${lookupSeconds}`, 'cache-tag': lookupTags(host, found).join(',') } }))
  return found
}

type Store = Extract<LiveHost, { kind: 'store' }>

const folderOf = (store: Store & { buildId: string }) => `stores/${store.storeId}/builds/${store.buildId}/`

/**
 * One object of the live build, through the cache. The cache key holds the host, the store, the build and the path, so
 * no store's cached file answers for another's, and a switch simply stops matching the old build's entries.
 */
const buildObject = async (host: string, store: Store & { buildId: string }, rel: string, deps: Deps): Promise<Response | null> => {
  const key = `https://${host}/__df/sites/${store.storeId}/${store.buildId}/${rel}`
  const hit = await deps.cache.match(key)
  if (hit) return restoreSent(hit)
  const object = await deps.sites.get(`${folderOf(store)}${rel}`)
  if (!object) return null
  const headers = fileHeaders(object)
  // The post-deploy checks wait until the edge serves the build they check (LIVE-SHOP §4 step 10).
  headers.set('x-df-build', store.buildId)
  const sent = new Response(object.body, { headers })
  // A build folder never changes, so the stored copy lives long; the build's own cache rules go to the browser.
  const stored = new Headers(headers)
  stored.set('x-df-cache-control', headers.get('cache-control') ?? '')
  stored.set('cache-control', immutable)
  remember(deps, key, new Response(sent.clone().body, { headers: stored }))
  return sent
}

const restoreSent = (hit: Response): Response => {
  const headers = new Headers(hit.headers)
  const original = headers.get('x-df-cache-control')
  headers.delete('x-df-cache-control')
  if (original) headers.set('cache-control', original)
  else headers.delete('cache-control')
  return new Response(hit.body, { status: hit.status, headers })
}

interface EdgeRules {
  redirects: { from: string; to: string }[]
  fallbacks: { prefix: string; page: string }[]
  notFound: string | null
}

// A path on the store's own host, plain names only: `//host` or `/\host` would send shoppers elsewhere (LIVE-SHOP §9).
const isPath = (value: unknown): value is string => typeof value === 'string' && value.startsWith('/') && value.length <= 2048 && relativeKey(value) !== null

/** The build's `_edge.json` (LIVE-SHOP §5 steps 5–6): the 301s it recorded, client-rendered fallbacks and its 404 page. */
const edgeRules = async (host: string, store: Store & { buildId: string }, deps: Deps): Promise<EdgeRules> => {
  const none: EdgeRules = { redirects: [], fallbacks: [], notFound: null }
  const file = await buildObject(host, store, '_edge.json', deps)
  if (!file) return none
  let raw: unknown
  try {
    raw = await file.json()
  } catch {
    return none
  }
  const v = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const list = (value: unknown) => (Array.isArray(value) ? (value as unknown[]).map((e) => (typeof e === 'object' && e !== null ? (e as Record<string, unknown>) : {})) : [])
  return {
    redirects: list(v['redirects']).flatMap((r) => (isPath(r['from']) && isPath(r['to']) ? [{ from: r['from'], to: r['to'] }] : [])),
    fallbacks: list(v['fallbacks']).flatMap((f) => (isPath(f['prefix']) && isPath(f['page']) ? [{ prefix: f['prefix'], page: f['page'] }] : [])),
    notFound: isPath(v['notFound']) ? v['notFound'] : null,
  }
}

/**
 * A renamed address the store recorded (`storefront_redirect`, ARCHITECTURE §8), asked of the API and cached like the
 * lookup: per data centre, at most a minute, under the store's tag, so a rename's 301 needs no rebuild.
 */
const storedRedirect = async (url: URL, store: Store, deps: Deps): Promise<string | null> => {
  // Recorded without a trailing slash, as a page answers either way.
  const path = url.pathname.replace(/(.)\/+$/, '$1')
  const key = `https://${url.hostname}/__df/redirect/${store.storeId}${path}`
  const hit = await deps.cache.match(key)
  if (hit) return parseRedirect(await hit.json())
  const to = parseRedirect(await deps.edge.redirect(store.storeId, path))
  remember(deps, key, new Response(JSON.stringify({ to }), { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${lookupSeconds}`, 'cache-tag': `df-store-${store.storeId}` } }))
  return to
}

/** A path the build has no file for: a recorded redirect, a fallback page the browser fills in, or the build's 404. */
const missing = async (url: URL, store: Store & { buildId: string }, deps: Deps): Promise<Response> => {
  const rules = await edgeRules(url.hostname, store, deps)
  const redirect = rules.redirects.find((r) => r.from === url.pathname)?.to ?? (await storedRedirect(url, store, deps))
  if (redirect) return new Response(null, { status: 301, headers: { location: redirect } })
  const fallback = rules.fallbacks.find((f) => url.pathname.startsWith(f.prefix))
  const fallbackKey = fallback ? relativeKey(fallback.page) : null
  if (fallbackKey) {
    const found = await buildObject(url.hostname, store, fallbackKey, deps)
    if (found) return found
  }
  const notFoundKey = rules.notFound ? relativeKey(rules.notFound) : null
  const notFound = notFoundKey ? await buildObject(url.hostname, store, notFoundKey, deps) : null
  if (notFound) return new Response(notFound.body, { status: 404, headers: notFound.headers })
  return page('missing', 404, { language: store.language })
}

export const serveLive = async (request: Request, url: URL, store: Store, deps: Deps): Promise<Response> => {
  if (store.state === 'offline') return page('missing', 404, { language: store.language })
  if (url.pathname === '/shop-api' || url.pathname.startsWith('/shop-api/')) return deps.edge.fetch(request)
  // SAAS §4.2: a suspended store's page tells shoppers to contact the shop, with no DripFunnel route.
  if (store.state === 'suspended') return page('degraded', 503, { language: store.language, heading: store.name, headers: { 'retry-after': '3600' } })
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  // IndexNow's proof that the key is this host's (ARCHITECTURE §8); the key is public by design.
  if (url.pathname === `/${store.indexNowKey}.txt`) return new Response(store.indexNowKey, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'max-age=3600' } })
  if (store.buildId === null) return page('missing', 404, { language: store.language })
  const live = { ...store, buildId: store.buildId }
  const rel = relativeKey(url.pathname)
  if (rel === null) return page('missing', 404, { language: store.language })
  return (await buildObject(url.hostname, live, rel, deps)) ?? missing(url, live, deps)
}
