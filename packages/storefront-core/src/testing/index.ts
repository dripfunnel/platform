import { missingRoutes, requiredParts, type CoreRoute, type ThemeManifest } from '../contracts/theme'

// The contract checks store repos run in CI (storefront ARCHITECTURE §3.2, §10), exported as
// @dripfunnel/storefront-core/testing.

/** Problems with a rendered page: required components missing. Empty means it passes. */
export const pageProblems = (route: CoreRoute, html: string, page: { preview: boolean; poweredBy: boolean; legal: boolean }): string[] =>
  requiredParts(route, page)
    .filter((part) => !html.includes(`data-df-required="${part}"`))
    .map((part) => `The ${route} page must render the required "${part}" component.`)

/** Problems with a theme manifest: routes it doesn't map. */
export const manifestProblems = (manifest: ThemeManifest): string[] => missingRoutes(manifest).map((r) => `The theme maps no page to the "${r}" route.`)
