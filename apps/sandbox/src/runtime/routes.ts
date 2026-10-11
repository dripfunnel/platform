import { coreRoutes, routeAddresses, type CoreRoute } from '@dripfunnel/storefront-core'

// The preview is one page for every address (PREVIEW §5 step 4), so the runtime picks the route the address names:
// a core route's page, then the longest item prefix, then the theme's own path (ARCHITECTURE §3.1).
const pages = coreRoutes.flatMap((route) => {
  const address = routeAddresses[route]
  return 'page' in address ? [{ route, page: address.page }] : []
})
const prefixes = coreRoutes
  .flatMap((route) => {
    const address = routeAddresses[route]
    return 'prefix' in address ? [{ route, prefix: address.prefix }] : []
  })
  .sort((a, b) => b.prefix.length - a.prefix.length)

export type Found = { route: CoreRoute } | { custom: string }

/** The route or custom page at `path`, which the caller renders, or the 404 page when nothing is there. */
export const routeAt = (path: string, custom: readonly string[]): Found => {
  const slashed = path.endsWith('/') ? path : `${path}/`
  const page = pages.find((p) => p.page === slashed)
  if (page) return { route: page.route }
  const item = prefixes.find((p) => slashed.startsWith(p.prefix) && slashed.length > p.prefix.length)
  if (item) return { route: item.route }
  const own = slashed.slice(0, -1)
  return custom.includes(own) ? { custom: own } : { route: 'notFound' }
}
