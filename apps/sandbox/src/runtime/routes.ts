import { contentAddresses, coreRoutes, reservedPathSegments, routeAddresses, type ThemeRoute } from '@dripfunnel/storefront-core'

// The preview is one page for every address (PREVIEW §5 step 4), so the runtime picks the route the address names:
// a core route's page, then the longest item prefix, then the theme's own path (ARCHITECTURE §3.1).
const addresses = [...coreRoutes.map((route) => [route, routeAddresses[route]] as const), ...(['blog', 'blogPost'] as const).map((route) => [route, contentAddresses[route]] as const)]
const pages = addresses.flatMap(([route, address]) => ('page' in address ? [{ route, page: address.page }] : []))
const prefixes = addresses
  .flatMap(([route, address]) => ('prefix' in address ? [{ route, prefix: address.prefix }] : []))
  .sort((a, b) => b.prefix.length - a.prefix.length)

export type Found = { route: ThemeRoute } | { custom: string }

/** The route or custom page at `path`, which the caller renders, or the 404 page when nothing is there. */
export const routeAt = (path: string, custom: readonly string[]): Found => {
  const slashed = path.endsWith('/') ? path : `${path}/`
  const page = pages.find((p) => p.page === slashed)
  if (page) return { route: page.route }
  const item = prefixes.find((p) => slashed.startsWith(p.prefix) && slashed.length > p.prefix.length)
  if (item) return { route: item.route }
  const own = slashed.slice(0, -1)
  if (custom.includes(own)) return { custom: own }
  // One lower-case segment may be a content page (SAPI 24); the page itself says so when the store has none there.
  return /^\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(own) && !reservedPathSegments.includes(own.slice(1)) ? { route: 'contentPage' } : { route: 'notFound' }
}
