import { remember, type Deps } from './deps'
import type { EdgeApi } from './edge'
import { lookupHost, lookupSeconds, serveLive } from './live'
import { page } from './pages'
import { servePreview } from './preview'
import { sessionSeal, type SessionSeal } from './session'

export interface Env {
  API: Fetcher & { portalHost: (host: string) => Promise<boolean> }
  EDGE?: EdgeApi | undefined
  SITES?: R2Bucket | undefined
  OWN_ZONE: string
  PAGES_HOST: string
  SHOP_DOMAIN?: string | undefined
  PREVIEW_SESSION_KEY?: string | undefined
}

const isOwnHost = (host: string, zone: string) => host === zone || host.endsWith(`.${zone}`)
const isApi = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/')
const domainPattern = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

/** A partner's portal host keeps its routing (SAAS §8): `/api/*` to the API's `PortalProxy`, the rest to Pages. */
const portal = (request: Request, url: URL, env: Env): Promise<Response> => {
  if (isApi(url.pathname)) return env.API.fetch(request)
  // Pages answers only the host it knows, so the request goes to its own name; the partner host is not needed there.
  url.hostname = env.PAGES_HOST
  url.port = ''
  return fetch(new Request(url, request))
}

/** `{slug}-preview.<SHOP_DOMAIN>`, one label deep; anything else under the domain is no preview. */
export const previewKeyOf = (host: string, domain: string | undefined): string | null => {
  if (!domain || !host.endsWith(`.${domain}`)) return null
  const label = host.slice(0, -domain.length - 1)
  if (!label.endsWith('-preview')) return null
  const slug = label.slice(0, -'-preview'.length)
  return slugPattern.test(slug) ? slug : null
}

// LOGGING §9: a preview token or a studio session never reaches a log line, and no query string does.
export const loggedPath = (pathname: string): string => {
  if (pathname === '/__open') return '/__open?t=:token'
  if (pathname.startsWith('/__studio/')) return '/__studio/:session/…'
  return pathname
}

const serveStorefront = async (request: Request, url: URL, env: Env, deps: Deps): Promise<Response> => {
  const key = previewKeyOf(url.hostname, env.SHOP_DOMAIN)
  if (key !== null) return servePreview(request, url, key, deps)
  const found = await lookupHost(url.hostname, deps)
  // Any other name under the shop domain is no store: the closed 404, never a partner's portal.
  if (found.kind === 'none') {
    if (env.SHOP_DOMAIN && url.hostname.endsWith(`.${env.SHOP_DOMAIN}`)) return page('missing', 404, { headers: { 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow' } })
    return portal(request, url, env)
  }
  return serveLive(request, url, found, deps)
}

/** Whether the API holds this own-zone host as a live partner portal host; kept a minute either way, so our own hosts cost no call per request (SAAS §8, #899). */
const isOwnZonePortal = async (host: string, env: Env, deps: Deps): Promise<boolean> => {
  const key = `https://${host}/__df/portal-host`
  const hit = await deps.cache.match(key)
  if (hit) return (await hit.text()) === '1'
  const found = await env.API.portalHost(host)
  remember(deps, key, new Response(found ? '1' : '0', { headers: { 'cache-control': `max-age=${lookupSeconds}` } }))
  return found
}

export const route = async (request: Request, env: Env, deps: Deps | null): Promise<Response> => {
  const url = new URL(request.url)
  const own = isOwnHost(url.hostname, env.OWN_ZONE)
  if (own && !deps) return fetch(request)
  if (!deps) return portal(request, url, env)
  try {
    // A lookup that fails passes the host through as before, so our consoles never depend on the database (#899).
    if (own) return (await isOwnZonePortal(url.hostname, env, deps).catch(() => false)) ? await portal(request, url, env) : await fetch(request)
    return await serveStorefront(request, url, env, deps)
  } catch {
    // The API or R2 couldn't answer: nothing is cached from it, and the next request tries again.
    return new Response(null, { status: 503, headers: { 'retry-after': '5', 'cache-control': 'no-store' } })
  }
}

let sealed: { key: string; seal: Promise<SessionSeal> } | undefined
const sessionsFor = (env: Env): Promise<SessionSeal> | null => {
  const key = env.PREVIEW_SESSION_KEY
  if (!key || !env.SHOP_DOMAIN) return null
  if (sealed?.key !== key) sealed = { key, seal: sessionSeal(key) }
  return sealed.seal
}

/** Configuration checked on every request, so a bad value answers 500 rather than serving half-configured (AGENTS.md "Security"). */
export const configProblem = (env: Env): string | null => {
  if (!domainPattern.test(env.OWN_ZONE)) return 'OWN_ZONE'
  if (env.SHOP_DOMAIN !== undefined && (!domainPattern.test(env.SHOP_DOMAIN) || isOwnHost(env.SHOP_DOMAIN, env.OWN_ZONE))) return 'SHOP_DOMAIN'
  if (env.PREVIEW_SESSION_KEY !== undefined && !/^[A-Za-z0-9+/]{43}=$/.test(env.PREVIEW_SESSION_KEY)) return 'PREVIEW_SESSION_KEY'
  if ((env.EDGE === undefined) !== (env.SITES === undefined)) return 'EDGE'
  return null
}

export default {
  async fetch(request, env, ctx) {
    const started = Date.now()
    const problem = configProblem(env)
    let response: Response
    if (problem) {
      console.error(JSON.stringify({ event: 'config_invalid', code: problem }))
      response = new Response(null, { status: 500 })
    } else {
      const deps: Deps | null =
        env.EDGE && env.SITES ? { edge: env.EDGE, sites: env.SITES, cache: caches.default, waitUntil: (work) => ctx.waitUntil(work), now: () => Date.now(), sessions: await (sessionsFor(env) ?? null) } : null
      response = await route(request, env, deps)
    }
    const url = new URL(request.url)
    console.log(JSON.stringify({ event: 'request', host: url.hostname, path: loggedPath(url.pathname), status: response.status, durationMs: Date.now() - started }))
    return response
  },
} satisfies ExportedHandler<Env>
