import { missingRoutes, requiredParts, type CoreRoute, type PageFacts, type ThemeManifest } from '../contracts/theme'
import { sealedOnPage } from '../sealed/element'
import { minimumSize, visibilityProblem, type VisibilityProblem } from '../sealed/visibility'

// The contract checks store repos run in CI (storefront ARCHITECTURE §3.2, §10), exported as
// @dripfunnel/storefront-core/testing.

const missing = (route: CoreRoute, part: string) => `The ${route} page must render the required "${part}" component.`

/** Problems with a rendered page's HTML: required sealed components missing. Empty means it passes. */
export const pageProblems = (route: CoreRoute, html: string, page: PageFacts): string[] =>
  requiredParts(route, page)
    .filter((part) => !html.includes(`data-df-sealed="${part}"`))
    .map((part) => missing(route, part))

const why: Record<VisibilityProblem, (part: keyof typeof minimumSize) => string> = {
  hidden: () => 'it is hidden',
  transparent: () => 'it or its text is transparent',
  'too-small': (part) => `it is smaller than ${minimumSize[part].width}×${minimumSize[part].height} px`,
  'off-screen': () => 'it is off the page',
  covered: () => 'something covers its centre',
}

const isPart = (part: string): part is keyof typeof minimumSize => Object.hasOwn(minimumSize, part)
const isProblem = (problem: string | null): problem is VisibilityProblem => problem !== null && Object.hasOwn(why, problem)

/**
 * A sealed component's visibility problem in plain words, as the publish gate reports what the page's own check found.
 * The page's script sent the part and the problem, so only core's own names reach the words.
 */
export const sealedProblemWords = (page: string, part: string, problem: string | null): string => {
  if (!isPart(part)) return `A required component on the ${page} isn't seen.`
  return isProblem(problem) ? `The "${part}" component on the ${page} isn't seen: ${why[problem](part)}.` : `The "${part}" component on the ${page} isn't seen.`
}

/**
 * Problems with a page as the browser shows it: every required sealed component there, and every one
 * showing seen (ARCHITECTURE §3.2). `layout: false` skips size, position and covering where nothing is laid out, as in jsdom.
 */
export const visibilityProblems = (route: CoreRoute, doc: Document, page: PageFacts, { layout = true }: { layout?: boolean } = {}): string[] => {
  const found = sealedOnPage(doc)
  const absent = requiredParts(route, page).filter((part) => !found.some((s) => s.part === part))
  const unseen = found.flatMap(({ host, part, shown }) => {
    const problem = shown ? visibilityProblem(host, part, { layout }) : null
    return problem ? [sealedProblemWords(`${route} page`, part, problem)] : []
  })
  return [...absent.map((part) => missing(route, part)), ...unseen]
}

/** Problems with a theme manifest: routes it doesn't map. */
export const manifestProblems = (manifest: ThemeManifest): string[] => missingRoutes(manifest).map((r) => `The theme maps no page to the "${r}" route.`)
