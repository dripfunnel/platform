import type { Config } from '#core/config'

export type Area = 'admin' | 'platform' | 'store' | 'shop' | 'hooks'

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)

export const resolveArea = (url: URL, config: Pick<Config, 'ADMIN_HOST' | 'PLATFORM_HOST' | 'HOOKS_HOST'>): Area | undefined => {
  if (url.hostname === config.HOOKS_HOST) return 'hooks'
  if (url.hostname === config.ADMIN_HOST) return under(url.pathname, '/api') ? 'admin' : undefined
  if (url.hostname === config.PLATFORM_HOST) return under(url.pathname, '/api') ? 'platform' : undefined
  // Any other host is routed here only because Cloudflare already mapped it to a registered
  // portal or storefront hostname (docs/ARCHITECTURE.md §2); until the tenant host allowlist
  // lands, this Worker cannot itself tell a registered host from an unregistered one.
  if (under(url.pathname, '/api')) return 'store'
  if (under(url.pathname, '/shop-api')) return 'shop'
  return undefined
}
