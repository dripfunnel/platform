import { remember, type Deps } from './deps'
import { parseDemoSite, type DemoSite } from './edge'
import { fileHeaders, isFilePath, relativeKey } from './files'
import { page } from './pages'
import { cookieValue } from './session'

// The templates' demos, demo.<SHOP_DOMAIN>/?theme=<key or name> (storefront PREVIEW.md §9): open to anyone, noindex, guests
// only. `?theme=` sets a cookie holding the template's key; every later request is served from that template's demo store.

export const demoCookie = '__Host-df_demo'
const templateKey = /^[a-z0-9-]{1,40}$/
// A key or a name, lower-cased ("thread", "start from scratch"); the API decides which template it is.
const templateAsked = /^[\p{Ll}\p{Lo}\p{N}][\p{Ll}\p{Lo}\p{N} &'.-]{0,59}$/u
// A demo's store and folder are public and change rarely; a minute's copy saves the API a call per chunk.
const siteSeconds = 60
const headers = { 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow' }
const robots = 'User-agent: *\nDisallow: /\n'

const withHeaders = (response: Response, extra: Record<string, string> = {}): Response => {
  const out = new Response(response.body, response)
  for (const [k, v] of Object.entries({ ...headers, ...extra })) out.headers.set(k, v)
  return out
}
const noDemo = () => page('noDemo', 404, { headers })
const isShopApi = (pathname: string) => pathname === '/shop-api' || pathname.startsWith('/shop-api/')

export const isDemoHost = (host: string, domain: string | undefined): boolean => domain !== undefined && host === `demo.${domain}`

/** `?theme=` first, ignoring case, else the cookie; null when neither names a template. */
const chosenTemplate = (request: Request, url: URL): { asked: string; fromQuery: boolean } | null => {
  const asked = url.searchParams.get('theme')?.trim().toLowerCase()
  if (asked !== undefined) return templateAsked.test(asked) ? { asked, fromQuery: true } : null
  const kept = cookieValue(request, demoCookie)
  return kept !== null && templateKey.test(kept) ? { asked: kept, fromQuery: false } : null
}

const siteOf = async (url: URL, asked: string, deps: Deps): Promise<DemoSite> => {
  const cacheKey = `https://${url.hostname}/__df/demo-site/${encodeURIComponent(asked)}`
  const hit = await deps.cache.match(cacheKey)
  if (hit) return parseDemoSite(await hit.json())
  const site = parseDemoSite(await deps.edge.demoSite(asked))
  remember(deps, cacheKey, new Response(JSON.stringify(site), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${siteSeconds}` } }))
  return site
}

const fileOf = async (url: URL, site: { storeId: string; folder: string }, rel: string, deps: Deps): Promise<Response | null> => {
  const cacheKey = `https://${url.hostname}/__df/demo/${site.storeId}/${site.folder}/${rel}`
  const hit = await deps.cache.match(cacheKey)
  if (hit) return hit
  const object = await deps.sites.get(`stores/${site.storeId}/preview/${site.folder}/${rel}`)
  if (!object) return null
  const response = new Response(object.body, { headers: fileHeaders(object) })
  const stored = new Response(response.clone().body, response)
  stored.headers.set('cache-control', `public, max-age=${siteSeconds}`)
  remember(deps, cacheKey, stored)
  return response
}

export const serveDemo = async (request: Request, url: URL, deps: Deps): Promise<Response> => {
  // The Shop API finds the demo store from the same cookie itself (auth/shopCaller.ts) and refuses sign-in there.
  if (isShopApi(url.pathname)) return deps.api.fetch(request)
  if (request.method !== 'GET' && request.method !== 'HEAD') return withHeaders(new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } }))
  if (url.pathname === '/robots.txt') return withHeaders(new Response(robots, { headers: { 'content-type': 'text/plain' } }))
  if (url.pathname.startsWith('/__')) return noDemo()
  const chosen = chosenTemplate(request, url)
  const site = chosen ? await siteOf(url, chosen.asked, deps) : null
  if (!chosen || !site?.ok) return noDemo()

  const isPage = !isFilePath(url.pathname)
  // The SPA fallback: any page path that isn't a file of its own gets the folder's index.html.
  const rel = isPage && !url.pathname.endsWith('.html') ? 'index.html' : relativeKey(url.pathname)
  const found = rel ? await fileOf(url, site, rel, deps) : null
  if (!found) return isPage ? noDemo() : withHeaders(new Response(null, { status: 404 }))
  // Every theme shares this origin and its file names, so the browser asks again rather than keep another theme's copy.
  const extra: Record<string, string> = { 'cache-control': isPage ? 'no-store' : 'no-cache' }
  if (chosen.fromQuery) extra['set-cookie'] = `${demoCookie}=${site.key}; Path=/; Secure; HttpOnly; SameSite=Lax`
  return withHeaders(found, extra)
}
