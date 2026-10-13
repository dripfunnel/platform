/** The routes every storefront has (storefront ARCHITECTURE §3.1); the theme maps each to a page. */
export const coreRoutes = [
  'home',
  'collection',
  'product',
  'search',
  'cart',
  'checkout',
  'orderConfirmation',
  'signIn',
  'register',
  'verify',
  'forgotPassword',
  'resetPassword',
  'account',
  'accountAddresses',
  'accountOrders',
  'accountOrder',
  'policy',
  'notFound',
  'degraded',
] as const

export type CoreRoute = (typeof coreRoutes)[number]

/**
 * The routes a theme may map, and need not (ARCHITECTURE §3.1, #324): the store's content pages and its blog. The baseline
 * maps them; the other starting themes gain them in ST 0, and until then those addresses get the theme's 404.
 */
export const contentRoutes = ['contentPage', 'blog', 'blogPost'] as const

export type ContentRoute = (typeof contentRoutes)[number]
export type ThemeRoute = CoreRoute | ContentRoute

export type ThemeManifest = {
  name: string
  version: string
  /** The page component's name for each route; checked by the contract tests before a build. */
  routes?: Partial<Record<CoreRoute, string>>
}

export const defineTheme = (manifest: ThemeManifest): ThemeManifest => manifest

/** The routes a manifest doesn't map yet. */
export const missingRoutes = (manifest: ThemeManifest): CoreRoute[] => coreRoutes.filter((r) => !manifest.routes?.[r])

export type RequiredPart = 'price' | 'consent' | 'preview' | 'legal' | 'powered' | 'payment' | 'summary'

/** `priced: false` is a page core gave no price to show, such as one built before the store's products reach the theme. */
export type PageFacts = { preview: boolean; poweredBy: boolean; legal: boolean; priced?: boolean }

/** The sealed components each route must render (DESIGN §3), by their data-df-sealed mark. */
export const requiredParts = (route: ThemeRoute, page: PageFacts): RequiredPart[] => {
  const parts: RequiredPart[] = ['consent']
  if (page.preview) parts.push('preview')
  if (page.poweredBy) parts.push('powered')
  if (page.legal && (route === 'product' || route === 'checkout' || route === 'policy')) parts.push('legal')
  if (page.priced !== false && (route === 'product' || route === 'cart' || route === 'checkout')) parts.push('price')
  if (page.priced !== false && route === 'checkout') parts.push('payment', 'summary')
  return parts
}
