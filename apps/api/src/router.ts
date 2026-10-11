import type { Config } from '#core/config'

export type Area = 'admin' | 'platform' | 'store' | 'shop' | 'hooks'

/** How the request reached the Worker: its own routes, or store-proxy's `PortalProxy` binding (SAAS.md §8). */
export type Entry = 'public' | 'portal'

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)

// The zone the Worker's own routes sit on: dripfunnel.com, dripfunnel.ai, or localhost locally.
const ownZoneOf = (adminHost: string) => adminHost.slice(adminHost.indexOf('.') + 1)

export const resolveArea = (url: URL, config: Pick<Config, 'ADMIN_HOST' | 'PLATFORM_HOST' | 'HOOKS_HOST'>, entry: Entry): Area | undefined => {
  const ownHost = url.hostname === config.HOOKS_HOST || url.hostname === config.ADMIN_HOST || url.hostname === config.PLATFORM_HOST
  if (entry === 'portal') return !ownHost && under(url.pathname, '/api') ? 'store' : undefined
  if (url.hostname === config.HOOKS_HOST) return 'hooks'
  if (url.hostname === config.ADMIN_HOST) return under(url.pathname, '/api') ? 'admin' : undefined
  if (url.hostname === config.PLATFORM_HOST) return under(url.pathname, '/api') ? 'platform' : undefined
  // A partner's own portal host reaches the Store API only through PortalProxy (ARCHITECTURE.md §2).
  if (under(url.pathname, '/api')) return url.hostname.endsWith(`.${ownZoneOf(config.ADMIN_HOST)}`) ? 'store' : undefined
  if (under(url.pathname, '/shop-api')) return 'shop'
  return undefined
}
