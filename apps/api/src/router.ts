import type { Config } from '#core/config'
import { deliveryApkPath } from '#apis/delivery/apk'
import { liveSlugOf } from '#db/scoped/shopCaller'

export type Area = 'admin' | 'platform' | 'store' | 'shop' | 'delivery' | 'hooks' | 'studio'

/** How the request reached the Worker: its own routes, store-proxy's portal binding, or its `StorefrontEdge` binding (SAAS.md §8). */
export type Entry = 'public' | 'portal' | 'edge'

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)

// The zone the Worker's own routes sit on: dripfunnel.ai, actuateminds.com, or localhost locally.
const ownZoneOf = (adminHost: string) => adminHost.slice(adminHost.indexOf('.') + 1)

/** A partner's host on `/api` reaches the default fetch only over store-proxy's binding, since the Worker's own routes
 *  deliver only its own zone; that binding uses the default fetch so placement applies (ARCHITECTURE.md §6). */
export const entryOf = (url: URL, config: Pick<Config, 'ADMIN_HOST'>, entry: Entry): Entry => {
  if (entry !== 'public' || !under(url.pathname, '/api')) return entry
  const zone = ownZoneOf(config.ADMIN_HOST)
  return url.hostname === zone || url.hostname.endsWith(`.${zone}`) ? entry : 'portal'
}

export const resolveArea = (url: URL, config: Pick<Config, 'ADMIN_HOST' | 'PLATFORM_HOST' | 'HOOKS_HOST' | 'SHOP_DOMAIN'>, entry: Entry): Area | undefined => {
  const ownHost = url.hostname === config.HOOKS_HOST || url.hostname === config.ADMIN_HOST || url.hostname === config.PLATFORM_HOST
  if (entry === 'portal') return !ownHost && under(url.pathname, '/api') ? 'store' : undefined
  if (entry === 'edge') {
    if (ownHost) return undefined
    // A storefront or preview host's Shop API, after the edge Worker's own checks (storefront LIVE-SHOP §5 step 3, PREVIEW §5 step 5).
    if (under(url.pathname, '/shop-api')) return 'shop'
    // The Delivery API: a store's free address only, never its preview or own domain (DELIVERY §4).
    if (under(url.pathname, '/delivery-api') || url.pathname === deliveryApkPath) return liveSlugOf(url.hostname, config.SHOP_DOMAIN ?? null) !== null ? 'delivery' : undefined
    // The studio frame (storefront AI-STUDIO §3 step 6) exists only here: never on a portal host or the public entry.
    return under(url.pathname, '/__studio') ? 'studio' : undefined
  }
  if (url.hostname === config.HOOKS_HOST) return 'hooks'
  if (url.hostname === config.ADMIN_HOST) return under(url.pathname, '/api') ? 'admin' : undefined
  if (url.hostname === config.PLATFORM_HOST) return under(url.pathname, '/api') ? 'platform' : undefined
  // A partner's own portal host reaches the Store API only as a portal entry (entryOf, ARCHITECTURE.md §2).
  if (under(url.pathname, '/api')) return url.hostname.endsWith(`.${ownZoneOf(config.ADMIN_HOST)}`) ? 'store' : undefined
  if (under(url.pathname, '/shop-api')) return 'shop'
  return undefined
}
