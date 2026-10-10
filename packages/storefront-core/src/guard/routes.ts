import { reservedPathSegments, themeRoutesSchema } from '../contracts/routes'
import { coreRoutes, type CoreRoute } from '../contracts/theme'
import { routesPath } from './files'
import { readJson } from './json'
import { problem, type GuardContext, type Problem } from './rules'

// A custom page never performs commerce of its own: no cart, checkout or pricing page (ARCHITECTURE §3.1).
const commerceWords = new Set(['cart', 'checkout', 'pay', 'payment', 'payments', 'price', 'prices', 'pricing'])
const commerceRoutes: readonly CoreRoute[] = ['cart', 'checkout', 'orderConfirmation']

/** A path as the store compares paths: one leading slash, no trailing one, lower case. */
const comparable = (path: string): string => {
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    // A path that isn't valid percent-encoding is compared as written.
  }
  return `/${decoded.trim().toLowerCase().replace(/^\/+|\/+$/g, '')}`
}

/** routes.json against core's schema, and the one namespace every path of a store shares (ARCHITECTURE §3.1). */
export const checkRoutes = (files: ReadonlyMap<string, string>, context: GuardContext): Problem[] => {
  const text = files.get(routesPath)
  if (text === undefined) return [problem(routesPath, null, 'routes/missing', 'routes.json is missing; it maps every core route to a page in src/theme/pages.')]
  const json = readJson(routesPath, text)
  if (!json.ok) return [problem(routesPath, json.line, 'routes/invalid', `routes.json can't be read: ${json.message}`)]
  const parsed = themeRoutesSchema.safeParse(json.value)
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => {
      const at = issue.path.map(String)
      return problem(routesPath, json.lineOf(at), 'routes/invalid', `routes.json${at.length ? ` at ${at.join('.')}` : ''}: ${issue.message}`)
    })
  }
  const { routes, custom = {} } = parsed.data
  const problems: Problem[] = []
  const missingPage = (page: string, line: number | null) => {
    if (!files.has(`src/theme/pages/${page}.tsx`)) problems.push(problem(routesPath, line, 'routes/page-not-found', `src/theme/pages/${page}.tsx doesn't exist.`))
  }
  for (const route of coreRoutes) {
    const page = routes[route]
    if (page === undefined) problems.push(problem(routesPath, json.lineOf(['routes']), 'routes/route-not-mapped', `The "${route}" route has no page; map it to one in src/theme/pages.`))
    else missingPage(page, json.lineOf(['routes', route]))
  }
  const used = new Set(context.usedPaths.map(comparable))
  const reserved = new Set([...reservedPathSegments, ...context.locales.flatMap((l) => [l.toLowerCase(), l.split('-')[0] ?? l])])
  const commercePages = new Set(commerceRoutes.map((r) => routes[r]))
  for (const [path, page] of Object.entries(custom)) {
    const line = json.lineOf(['custom', path])
    const segments = path.slice(1).split('/')
    if (reserved.has(segments[0] ?? '')) problems.push(problem(routesPath, line, 'routes/path-reserved', `"${path}" starts with /${segments[0]}, which core uses; pick another path.`))
    else if (used.has(comparable(path))) problems.push(problem(routesPath, line, 'routes/path-in-use', `"${path}" is already a content page or blog post of this store; pick another path.`))
    if (segments.some((s) => s.split('-').some((w) => commerceWords.has(w))) || commercePages.has(page)) {
      problems.push(problem(routesPath, line, 'routes/commerce-page', `"${path}" reads as a cart, checkout or pricing page. A custom page may show products and hold core's add to cart, never be one of those.`))
    }
    missingPage(page, line)
  }
  return problems
}
