import { z } from 'zod'
import { contentRoutes, coreRoutes, type ContentRoute, type CoreRoute } from './theme.js'

/** A page under src/theme/pages without its .tsx, such as "HomePage" or "account/OrdersPage". */
const themePage = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}){0,4}$/, 'Name a page under src/theme/pages without .tsx, such as "HomePage".')

/** A custom page's path: lower-case words joined by hyphens, at most three levels, such as "/our-story". */
export const customPathPattern = /^\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){0,2}$/

export const maxCustomPages = 50

/** The first path segments core's routes and files use, which no custom page may start with (storefront ARCHITECTURE §3.1). */
export const reservedPathSegments: readonly string[] = [
  'account', 'api', 'assets', 'blog', 'cart', 'checkout', 'collections', 'core', 'forgot-password', 'media', 'order',
  'orders', 'pages', 'policies', 'products', 'register', 'reset-password', 'search', 'shop-api', 'sign-in', 'sitemap', 'verify',
]

/** routes.json: the theme page that skins each core route, and the theme's own pages by path (ARCHITECTURE §2.2, §3.1). */
export const themeRoutesSchema = z.strictObject({
  routes: z.partialRecord(z.enum([...coreRoutes, ...contentRoutes]), themePage),
  custom: z
    .record(z.string().regex(customPathPattern, 'Use lower-case words joined by hyphens, such as "/our-story", at most three levels deep.'), themePage)
    .refine((pages) => Object.keys(pages).length <= maxCustomPages, `A theme may have at most ${maxCustomPages} custom pages.`)
    .optional(),
})

export type ThemeRoutes = z.infer<typeof themeRoutesSchema>

/**
 * Where each core route lives on a live site (ARCHITECTURE §3.1): a page the build writes, or a prefix whose addresses get
 * that route's client-rendered page until it has a file of its own (LIVE-SHOP §5 step 6).
 */
export const routeAddresses: Readonly<Record<CoreRoute, { page: string } | { prefix: string }>> = {
  home: { page: '/' },
  collection: { prefix: '/collections/' },
  product: { prefix: '/products/' },
  search: { page: '/search/' },
  cart: { page: '/cart/' },
  checkout: { page: '/checkout/' },
  orderConfirmation: { prefix: '/order/' },
  signIn: { page: '/sign-in/' },
  register: { page: '/register/' },
  verify: { page: '/verify/' },
  forgotPassword: { page: '/forgot-password/' },
  resetPassword: { page: '/reset-password/' },
  account: { page: '/account/' },
  accountAddresses: { page: '/account/addresses/' },
  accountOrders: { page: '/account/orders/' },
  accountOrder: { prefix: '/account/orders/' },
  policy: { prefix: '/policies/' },
  notFound: { page: '/404/' },
  degraded: { page: '/degraded/' },
}

/**
 * Where the content routes live (SAPI 24 as built on #338): the blog at `/blog/`, a post under it; a content page at the one
 * segment its slug names, which the build learns from the store's content paths (the validator's `usedPaths`).
 */
export const contentAddresses: Readonly<Record<Exclude<ContentRoute, 'contentPage'>, { page: string } | { prefix: string }>> = {
  blog: { page: '/blog/' },
  blogPost: { prefix: '/blog/' },
}
