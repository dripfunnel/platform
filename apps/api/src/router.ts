import type { Config } from '#core/config'

export type Area = 'admin' | 'platform' | 'store' | 'shop' | 'hooks'

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)

export const resolveArea = (url: URL, config: Config): Area | undefined => {
  if (url.hostname === config.HOOKS_HOST) return 'hooks'
  if (url.hostname === config.ADMIN_HOST) return under(url.pathname, '/api') ? 'admin' : undefined
  if (url.hostname === config.PLATFORM_HOST) return under(url.pathname, '/api') ? 'platform' : undefined
  if (under(url.pathname, '/api')) return 'store'
  if (under(url.pathname, '/shop-api')) return 'shop'
  return undefined
}
