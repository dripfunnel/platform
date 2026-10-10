import { z } from 'zod'
import { coreRoutes } from './theme'

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
  routes: z.partialRecord(z.enum(coreRoutes), themePage),
  custom: z
    .record(z.string().regex(customPathPattern, 'Use lower-case words joined by hyphens, such as "/our-story", at most three levels deep.'), themePage)
    .refine((pages) => Object.keys(pages).length <= maxCustomPages, `A theme may have at most ${maxCustomPages} custom pages.`)
    .optional(),
})

export type ThemeRoutes = z.infer<typeof themeRoutesSchema>
