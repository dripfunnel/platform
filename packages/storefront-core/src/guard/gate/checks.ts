import { routeAddresses, type ThemeRoutes } from '../../contracts/routes.js'
import { coreRoutes, requiredParts, type CoreRoute } from '../../contracts/theme.js'
import { claimsIn } from '../claims.js'
import type { Problem } from '../rules.js'
import { gateCheck, gateReport, type GateCheck, type GateReport } from './report.js'

// The full gate's checks (storefront ARCHITECTURE §4.2 step 3, LIVE-SHOP §4 step 7) over what the check step saw of a
// build: its pages read without JavaScript, visited in a browser at three widths, and weighed at phone width.

/** Phone, tablet and desktop (ARCHITECTURE §3.3 "sealed-component visibility at 3 widths"). */
export const gateWidths = [390, 768, 1440] as const

/** ARCHITECTURE §9's budgets: bytes are exact and hard; timings are the median of three loads. */
export const pageBudgets = { jsGzip: 90 * 1024, cssGzip: 50 * 1024, pageBytes: 1024 * 1024, lcpMs: 2000, cls: 0.05, tbtMs: 150 } as const

/** A page's share of pixels that may differ from the live site's before it counts as looking different. */
export const lookTolerance = 0.005

export type PageRoute = CoreRoute | 'custom'

/** A built page without JavaScript: its file, its headings, the words of its main landmark and its links. */
export type PageRead = { path: string; route: PageRoute; html: string; h1s: string[]; mainText: string; text: string; links: string[] }

/** A built page in the browser with JavaScript on, at one width. */
export type PageVisit = {
  path: string
  route: PageRoute
  width: number
  /** Uncaught errors while it loaded and settled. */
  errors: string[]
  /** What core's `visibilityProblems` found (./testing). */
  sealed: string[]
  /** The ids of the axe rules it breaks. */
  axe: string[]
  /** Its main landmark has a size, is on screen and isn't covered at its centre. */
  mainSeen: boolean
  /** It is wider than the screen. */
  overflow: boolean
  /** The share of its pixels unlike the live site's same page at this width; null when the live site has none. */
  diff: number | null
}

/** A page's first-load weight and its timings at phone width, three times each. */
export type PageWeight = { path: string; route: PageRoute; jsGzip: number; cssGzip: number; bytes: number; lcpMs: number[]; cls: number[]; tbtMs: number[] }

export type GateInput = {
  validator: readonly Problem[]
  routes: ThemeRoutes
  pages: readonly PageRead[]
  visits: readonly PageVisit[]
  weights: readonly PageWeight[]
  site: { origin: string; sitemap: string | null; robots: string | null; files: readonly string[] }
  /** Words from the store's own data, which the content scan doesn't hold against the theme. */
  data: readonly string[]
  poweredBy: boolean
  /** A publish that mustn't change the look (a core patch or minor, ARCHITECTURE §7): any page that looks different fails. */
  strictLook: boolean
  /** The theme rendered against the edge-case catalogue (§10), by case. */
  edge: readonly { name: string; pages: readonly PageRead[]; visits: readonly PageVisit[] }[]
}

/** The pages search engines are told about (ARCHITECTURE §8): content a shopper lands on, never a cart or an account. */
export const indexable = (route: PageRoute): boolean => route === 'home' || route === 'custom' || route === 'product' || route === 'collection' || route === 'policy'

/** Where a route's client-rendered page is kept, for addresses that have no file of their own (LIVE-SHOP §5 step 6). */
export const fallbackPath = (route: CoreRoute) => `/_fallback/${route}/`

const routeNames: Partial<Record<PageRoute, string>> = { orderConfirmation: 'order confirmation', signIn: 'sign-in', forgotPassword: 'forgot password', resetPassword: 'reset password', accountAddresses: 'addresses', accountOrders: 'orders', accountOrder: 'order', notFound: 'not found' }
const pageName = (p: { path: string; route: PageRoute }) => (p.route === 'custom' ? `page ${p.path}` : `${routeNames[p.route] ?? p.route} page`)
const at = (v: PageVisit) => `${pageName(v)} at ${v.width} px`
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const partsFor = (route: PageRoute, poweredBy: boolean) => requiredParts(route === 'custom' ? 'home' : route, { preview: false, poweredBy, legal: false, priced: false })

export const checkValidator = (problems: readonly Problem[]): GateCheck =>
  gateCheck('validator', problems.map((p) => `${p.file ?? 'The theme'}${p.line ? `:${p.line}` : ''}: ${p.message}`))

/** ARCHITECTURE §3.1–§3.2: every route has its page, each page has its required parts, one h1 and a main, and none crashes. */
export const checkContracts = (input: Pick<GateInput, 'routes' | 'pages' | 'visits' | 'poweredBy'>): GateCheck => {
  const built = new Set(input.pages.map((p) => p.path))
  const problems: string[] = []
  for (const route of coreRoutes) {
    if (!input.routes.routes[route]) {
      problems.push(`routes.json maps no page to the ${pageName({ path: '', route })}.`)
      continue
    }
    const address = routeAddresses[route]
    const path = 'page' in address ? address.page : fallbackPath(route)
    if (!built.has(path)) problems.push(`The build has no ${pageName({ path, route })}.`)
  }
  for (const path of Object.keys(input.routes.custom ?? {})) if (!built.has(`${path}/`)) problems.push(`The build has no page ${path}/.`)
  for (const page of input.pages) problems.push(...pageShape(page, input.poweredBy))
  for (const v of input.visits) if (v.errors.length > 0) problems.push(`The ${at(v)} failed while loading: ${v.errors[0] ?? ''}`)
  return gateCheck('contracts', problems)
}

const pageShape = (page: PageRead, poweredBy: boolean): string[] => [
  ...partsFor(page.route, poweredBy)
    .filter((part) => !page.html.includes(`data-df-sealed="${part}"`))
    .map((part) => `The ${pageName(page)} doesn't place the required "${part}" component.`),
  ...(page.h1s.length === 1 ? [] : [`The ${pageName(page)} has ${page.h1s.length} main headings (h1); it needs exactly one.`]),
  ...(/<main[\s>]/.test(page.html) ? [] : [`The ${pageName(page)} has no main landmark.`]),
  ...(/<html[^>]*\slang="[^"]+"/.test(page.html) ? [] : [`The ${pageName(page)} doesn't name its language.`]),
]

export const checkSealed = (visits: readonly PageVisit[]): GateCheck => gateCheck('sealed', visits.flatMap((v) => v.sealed.map((p) => `At ${v.width} px: ${p}`)))

/** The checkout smoke test against the offline Shop API fixture: the cart and checkout open, are seen and work at every width. */
export const checkCheckout = (visits: readonly PageVisit[]): GateCheck => {
  const problems: string[] = []
  for (const route of ['cart', 'checkout'] as const) {
    for (const width of gateWidths) {
      const v = visits.find((x) => x.route === route && x.width === width)
      if (!v) problems.push(`The ${route} page wasn't opened at ${width} px.`)
      else if (v.errors.length > 0) problems.push(`The ${at(v)} stopped with an error: ${v.errors[0] ?? ''}`)
      else if (!v.mainSeen) problems.push(`The ${at(v)} can't be used: its main content is hidden, off screen or covered.`)
      else if (v.sealed.length > 0) problems.push(`The ${at(v)} hides a required part: ${v.sealed[0] ?? ''}`)
    }
  }
  return gateCheck('checkout', problems)
}

export const checkAxe = (visits: readonly PageVisit[]): GateCheck =>
  gateCheck('axe', visits.filter((v) => v.axe.length > 0).map((v) => `The ${at(v)} breaks accessibility rules: ${[...new Set(v.axe)].join(', ')}.`))

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length === 0 ? Number.POSITIVE_INFINITY : (sorted[Math.floor((sorted.length - 1) / 2)] ?? Number.POSITIVE_INFINITY)
}
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`

export const checkBudgets = (weights: readonly PageWeight[]): GateCheck => {
  const b = pageBudgets
  const problems = weights.flatMap((w) => {
    const name = upper(pageName(w))
    const found: string[] = []
    if (w.route !== 'checkout' && w.jsGzip > b.jsGzip) found.push(`${name} loads ${kb(w.jsGzip)} of JavaScript gzipped, over the ${kb(b.jsGzip)} budget.`)
    if (w.cssGzip > b.cssGzip) found.push(`${name} loads ${kb(w.cssGzip)} of CSS gzipped, over the ${kb(b.cssGzip)} budget.`)
    if (w.bytes > b.pageBytes) found.push(`${name} weighs ${kb(w.bytes)} on a phone, over the ${kb(b.pageBytes)} budget.`)
    if (median(w.lcpMs) > b.lcpMs) found.push(`${name} shows its largest content after ${Math.round(median(w.lcpMs))} ms, over ${b.lcpMs} ms.`)
    if (median(w.cls) > b.cls) found.push(`${name} shifts its layout by ${median(w.cls).toFixed(3)}, over ${b.cls}.`)
    if (median(w.tbtMs) > b.tbtMs) found.push(`${name} blocks for ${Math.round(median(w.tbtMs))} ms while loading, over ${b.tbtMs} ms.`)
    return found
  })
  return gateCheck('budgets', problems)
}

/** ARCHITECTURE §8: without JavaScript every page still shows its heading and its main words. */
const withoutJs = (p: PageRead): string[] => [
  ...((p.h1s[0] ?? '').trim() === '' ? [`The ${pageName(p)}'s main heading is empty without JavaScript.`] : []),
  ...(p.mainText.trim() === '' ? [`The ${pageName(p)} shows no main text without JavaScript.`] : []),
]

export const checkNoJs = (pages: readonly PageRead[]): GateCheck => gateCheck('no-js', pages.flatMap(withoutJs))

const internal = (href: string) => href.startsWith('/') && !href.startsWith('//')

const sitemapLocs = (xml: string) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1] ?? '')

/** Every link leads somewhere, and the sitemap and robots.txt name exactly the pages search engines should see. */
export const checkCrawl = (input: Pick<GateInput, 'pages' | 'site'>): GateCheck => {
  const pages = new Set(input.pages.map((p) => p.path))
  const files = new Set(input.site.files.map((f) => `/${f}`))
  const prefixes = coreRoutes.flatMap((r) => {
    const a = routeAddresses[r]
    return 'prefix' in a ? [a.prefix] : []
  })
  const leads = (href: string) => {
    const path = href.split(/[?#]/)[0] ?? ''
    return pages.has(path) || files.has(path) || prefixes.some((p) => path.startsWith(p) && path.length > p.length)
  }
  const problems = input.pages.flatMap((p) => p.links.filter((href) => internal(href) && !leads(href)).map((href) => `The link ${href} on the ${pageName(p)} leads nowhere.`))
  const sitemap = `${input.site.origin}/sitemap.xml`
  if (input.site.sitemap === null) problems.push('The build has no sitemap.xml.')
  else {
    const listed = new Set(sitemapLocs(input.site.sitemap))
    const wanted = input.pages.filter((p) => indexable(p.route) && !p.path.startsWith('/_fallback/')).map((p) => `${input.site.origin}${p.path}`)
    for (const url of wanted) if (!listed.has(url)) problems.push(`The sitemap leaves out ${url}.`)
    for (const url of listed) if (!wanted.includes(url)) problems.push(`The sitemap lists ${url}, which isn't a page search engines should see.`)
  }
  if (!input.site.robots?.split('\n').includes(`Sitemap: ${sitemap}`)) problems.push('robots.txt doesn’t name the sitemap.')
  return gateCheck('crawl', problems)
}

/** ARCHITECTURE §3.3 "Invented data": the words a shopper reads, outside core's sealed parts and the store's own data. */
export const checkClaims = (pages: readonly PageRead[], data: readonly string[]): GateCheck => {
  const strip = (text: string) => data.filter((d) => d.trim() !== '').reduce((t, d) => t.split(d).join(' '), text)
  return gateCheck('content', pages.flatMap((p) => claimsIn(strip(p.text)).map((c) => `The ${pageName(p)} reads as ${c.what}. Such facts come only from the store's data through core.`)))
}

export const checkVisualDiff = (visits: readonly PageVisit[], strict: boolean): GateCheck => {
  const compared = visits.filter((v) => v.diff !== null)
  const changed = compared.filter((v) => (v.diff ?? 0) > lookTolerance)
  const words = changed.map((v) => `The ${at(v)} looks different from the live site (${((v.diff ?? 0) * 100).toFixed(1)}% of it changed).`)
  if (strict) return gateCheck('visual-diff', words)
  const pages = new Set(changed.map((v) => v.path)).size
  return gateCheck('visual-diff', [], compared.length === 0 ? 'There is no live site to compare with.' : pages === 0 ? 'Every page looks as it does on the live site.' : `${pages} pages look different from the live site.`)
}

/** ARCHITECTURE §10: the theme against the edge-case catalogue renders whole, fits the screen and keeps its required parts. */
export const checkEdgeCases = (edge: GateInput['edge'], poweredBy: boolean): GateCheck =>
  gateCheck(
    'edge-cases',
    edge.flatMap(({ name, pages, visits }) => [
      ...pages.flatMap((p) => [...pageShape(p, poweredBy), ...withoutJs(p)].map((d) => `With ${name}: ${d}`)),
      ...visits.flatMap((v) => [
        ...v.errors.slice(0, 1).map((e) => `With ${name}: the ${at(v)} failed while loading: ${e}`),
        ...v.sealed.map((s) => `With ${name}, at ${v.width} px: ${s}`),
        ...(v.overflow ? [`With ${name}: the ${at(v)} is wider than the screen.`] : []),
      ]),
    ]),
  )

export const runGate = (input: GateInput): GateReport =>
  gateReport([
    checkValidator(input.validator),
    checkContracts(input),
    checkSealed(input.visits),
    checkCheckout(input.visits),
    checkAxe(input.visits),
    checkBudgets(input.weights),
    checkNoJs(input.pages),
    checkCrawl(input),
    checkClaims(input.pages, input.data),
    checkVisualDiff(input.visits, input.strictLook),
    checkEdgeCases(input.edge, input.poweredBy),
  ])
