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

export type ThemeManifest = {
  name: string
  version: string
  /** The page component's name for each route; checked by the contract tests before a build. */
  routes?: Partial<Record<CoreRoute, string>>
}

export const defineTheme = (manifest: ThemeManifest): ThemeManifest => manifest

/** The routes a manifest doesn't map yet. */
export const missingRoutes = (manifest: ThemeManifest): CoreRoute[] => coreRoutes.filter((r) => !manifest.routes?.[r])

export type RequiredPart = 'price' | 'consent' | 'preview' | 'legal' | 'powered'

/** The sealed components each route must render (DESIGN §3), by their data-df-sealed mark. */
export const requiredParts = (route: CoreRoute, page: { preview: boolean; poweredBy: boolean; legal: boolean }): RequiredPart[] => {
  const parts: RequiredPart[] = ['consent']
  if (page.preview) parts.push('preview')
  if (page.poweredBy) parts.push('powered')
  if (page.legal && (route === 'product' || route === 'checkout' || route === 'policy')) parts.push('legal')
  if (route === 'product' || route === 'cart' || route === 'checkout') parts.push('price')
  return parts
}
