import { remember, type Deps } from './deps'
import { parsePreviewAccess, type PreviewAccess } from './edge'
import { fileHeaders, isFilePath, relativeKey } from './files'
import { page } from './pages'
import { cookieValue, sessionCookie, sessionSeconds, setCookie, withoutCookie, type PreviewSession } from './session'

// A preview host, {key}.<PREVIEW_DOMAIN> (storefront PREVIEW.md §5): opened only through the signed link, then a 15-minute
// session cookie checked on every request. HTML and /shop-api get the API's full access re-check, which alone renews it.

// Every preview answer, the closed page included (PREVIEW §5 steps 2 and 4; LOGGING §9).
const previewHeaders = { 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow' }
const robots = 'User-agent: *\nDisallow: /\n'

const withPreviewHeaders = (response: Response, extra: Record<string, string> = {}): Response => {
  const out = new Response(response.body, response)
  for (const [k, v] of Object.entries({ ...previewHeaders, ...extra })) out.headers.set(k, v)
  return out
}

const closed = () => page('closed', 403, { headers: previewHeaders })
// The SPA shows the same closed page on this code (PREVIEW §5 step 3).
const closedApi = () =>
  new Response(JSON.stringify({ errors: [{ message: 'This preview has closed.', extensions: { code: 'PREVIEW_CLOSED' } }] }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...previewHeaders },
  })

const isShopApi = (pathname: string) => pathname === '/shop-api' || pathname.startsWith('/shop-api/')

/** `__open?t=`: the API checks the link and that its store is this host's; on a pass the cookie, then `/` without the token. */
const open = async (url: URL, key: string, deps: Deps): Promise<Response> => {
  const token = url.searchParams.get('t')
  if (!token || !deps.sessions) return closed()
  const access = parsePreviewAccess(await deps.edge.openPreview(key, token))
  return started(access, key, deps, new Response(null, { status: 302, headers: { location: '/', 'cache-control': 'no-store' } }))
}

const started = async (access: PreviewAccess, key: string, deps: Deps, response: Response): Promise<Response> => {
  if (!access.ok || access.folder === null || !deps.sessions) return closed()
  const session: PreviewSession = { k: key, s: access.storeId, u: access.userId, e: access.epoch, f: access.folder, x: Math.floor(deps.now() / 1000) + sessionSeconds }
  return withPreviewHeaders(response, { 'set-cookie': setCookie(await deps.sessions.write(session)) })
}

/** One file of a change folder; the cache key holds the host, the store, the folder and the path. */
const previewObject = async (url: URL, session: PreviewSession, folder: string, rel: string, deps: Deps, chunk: boolean): Promise<Response | null> => {
  const key = `https://${url.hostname}/__df/preview/${session.s}/${folder}/${rel}`
  if (chunk) {
    const hit = await deps.cache.match(key)
    if (hit) return withPreviewHeaders(hit, { 'cache-control': 'private, max-age=31536000, immutable' })
  }
  const object = await deps.sites.get(`stores/${session.s}/preview/${folder}/${rel}`)
  if (!object) return null
  const headers = fileHeaders(object)
  if (!chunk) {
    headers.set('cache-control', 'no-store')
    return withPreviewHeaders(new Response(object.body, { headers }))
  }
  // Stored without `private`, so keeping it never depends on how the Cache API treats that (PREVIEW §5 step 4).
  const stored = new Headers(headers)
  stored.set('cache-control', 'public, max-age=31536000, immutable')
  const sent = new Response(object.body, { headers })
  remember(deps, key, new Response(sent.clone().body, { headers: stored }))
  return withPreviewHeaders(sent, { 'cache-control': 'private, max-age=31536000, immutable' })
}

export const servePreview = async (request: Request, url: URL, key: string, deps: Deps): Promise<Response> => {
  // Pages are only read, so a write to one never reaches the re-check. Cross-site posts don't carry the SameSite=Lax cookie;
  // `/shop-api` writes (the SPA's cart) renew it as PREVIEW §5 step 2 says, and the API judges them.
  if (request.method !== 'GET' && request.method !== 'HEAD' && !isShopApi(url.pathname)) return withPreviewHeaders(new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } }))
  if (url.pathname === '/robots.txt') return withPreviewHeaders(new Response(robots, { headers: { 'content-type': 'text/plain' } }))
  if (url.pathname === '/__open') return open(url, key, deps)
  // The studio frame (AI-STUDIO §3 step 6): the API finds this host's store and its Durable Object checks the session in
  // the path before anything is read; no cookie is asked for, since the cross-site frame never has one.
  if (url.pathname.startsWith('/__studio/')) return deps.edge.fetch(request)
  const value = cookieValue(request, sessionCookie)
  const session = value && deps.sessions ? await deps.sessions.read(value) : null
  const live = session !== null && session.k === key && session.x > deps.now() / 1000
  if (!live) return isShopApi(url.pathname) ? closedApi() : closed()

  if (isFilePath(url.pathname)) {
    // Chunks: the cookie only, checked before any cache lookup (PREVIEW §5 step 4).
    const rel = relativeKey(url.pathname)
    const found = rel ? await previewObject(url, session, session.f, rel, deps, true) : null
    return found ?? withPreviewHeaders(page('missing', 404))
  }

  const access = parsePreviewAccess(await deps.edge.previewAccess({ key, storeId: session.s, userId: session.u, epoch: session.e }))
  if (!access.ok || access.storeId !== session.s || access.folder === null) return isShopApi(url.pathname) ? closedApi() : closed()
  if (isShopApi(url.pathname)) return started(access, key, deps, await deps.edge.fetch(withoutCookie(request, sessionCookie)))
  // The SPA fallback: any page path that isn't a file of its own gets the folder's index.html.
  const rel = url.pathname.endsWith('.html') ? relativeKey(url.pathname) : 'index.html'
  const found = rel ? await previewObject(url, session, access.folder, rel, deps, false) : null
  return found ? started(access, key, deps, found) : closed()
}
