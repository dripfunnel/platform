import { contentAddresses, routeAddresses, type ThemeRoutes } from '../../contracts/routes.js'
import { coreRoutes, requiredParts, type ThemeRoute } from '../../contracts/theme.js'
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

export type PageRoute = ThemeRoute | 'custom'

/** A built page without JavaScript: its file, its headings, the words of its main landmark, its links, and what went wrong. */
export type PageRead = { path: string; route: PageRoute; html: string; h1s: string[]; mainText: string; text: string; links: string[]; errors: string[] }

/** A built page in the browser with JavaScript on, at one width. */
export type PageVisit = {
  path: string
  route: PageRoute
  width: number
  /** What went wrong while it loaded and settled; only counted here, never copied into the report's words. */
  errors: string[]
  /** What core's `visibilityProblems` found (./testing). */
  sealed: string[]
  /** The ids of the axe rules it breaks. */
  axe: string[]
  /** Its main heading, inside the main landmark, is on screen and is what a tap at its centre reaches. */
  mainSeen: boolean
  /** It is wider than the screen. */
  overflow: boolean
  /** The share of its pixels unlike the live site's same page at this width; null when the live site has none. */
  diff: number | null
}

/** A page's first-load weight and timings at phone width, three times each: `jsGzip` the theme's own, `runtimeJsGzip` core's (ARCHITECTURE §9). `cpuSlowdown` is the throttle the timings were taken at. */
export type PageWeight = { path: string; route: PageRoute; jsGzip: number; runtimeJsGzip: number; cssGzip: number; bytes: number; lcpMs: number[]; cls: number[]; tbtMs: number[]; cpuSlowdown: number }

export type GateInput = {
  validator: readonly Problem[]
  routes: ThemeRoutes
  pages: readonly PageRead[]
  visits: readonly PageVisit[]
  weights: readonly PageWeight[]
  /** `prefixes`: the store's other languages' address prefixes, such as `/hi` (ARCHITECTURE §8 locale routing). */
  site: { origin: string; sitemap: string | null; robots: string | null; files: readonly string[]; prefixes: readonly string[] }
  /** Words from the store's own data, which the content scan doesn't hold against the theme. */
  data: readonly string[]
  poweredBy: boolean
  /**
   * The routes whose pages core gave a price to show (a product, cart lines), which must place the sealed price
   * (DESIGN §3). Left out, product, cart and checkout all must.
   */
  priced?: ReadonlySet<PageRoute>
  /** The store's markets require legal and compliance notices, which product, checkout and policy pages then place. */
  legal: boolean
  /** A publish that mustn't change the look (a core patch or minor, ARCHITECTURE §7): any page that looks different fails. */
  strictLook: boolean
  /** The theme rendered against the edge-case catalogue (§10), by case, and the cases `edgeCases` gave, all of which must be. */
  edge: readonly { name: string; pages: readonly PageRead[]; visits: readonly PageVisit[] }[]
  edgeNames: readonly string[]
}

/** The pages search engines are told about (ARCHITECTURE §8): content a shopper lands on, never a cart or an account. */
export const indexable = (route: PageRoute): boolean => route === 'home' || route === 'custom' || route === 'product' || route === 'collection' || route === 'policy' || route === 'contentPage' || route === 'blog' || route === 'blogPost'

/** Where a route's client-rendered page is kept, for addresses that have no file of their own (LIVE-SHOP §5 step 6). */
export const fallbackPath = (route: ThemeRoute) => `/_fallback/${route}/`

const routeNames: Partial<Record<PageRoute, string>> = { orderConfirmation: 'order confirmation', signIn: 'sign-in', forgotPassword: 'forgot password', resetPassword: 'reset password', accountAddresses: 'addresses', accountOrders: 'orders', accountOrder: 'order', notFound: 'not found', contentPage: 'content page', blogPost: 'blog post' }
/** How the gate names a page in its words. */
export const pageName = (p: { path: string; route: PageRoute }) => (p.route === 'custom' ? `page ${p.path}` : `${routeNames[p.route] ?? p.route} page`)
const at = (v: PageVisit) => `${pageName(v)} at ${v.width} px`
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const pricedRoutes: ReadonlySet<PageRoute> = new Set<PageRoute>(['product', 'cart', 'checkout'])

type Shape = { poweredBy: boolean; legal: boolean; priced: ReadonlySet<PageRoute> }
const shapeOf = (input: Pick<GateInput, 'poweredBy' | 'priced' | 'legal'>): Shape => ({ poweredBy: input.poweredBy, legal: input.legal, priced: input.priced ?? pricedRoutes })

const partsFor = (route: PageRoute, shape: Shape) =>
  requiredParts(route === 'custom' ? 'home' : route, { preview: false, poweredBy: shape.poweredBy, legal: shape.legal, priced: shape.priced.has(route) })

/** ARCHITECTURE §9 budgets these page types. */
export const budgetedRoutes: ReadonlySet<PageRoute> = new Set<PageRoute>(['home', 'collection', 'product', 'custom', 'cart'])

type Coverage = Pick<GateInput, 'pages' | 'visits' | 'site'>
/** The main language's pages, which the check step visits at every width (other languages are read without JavaScript). */
const mainPages = (input: Pick<GateInput, 'pages' | 'site'>) => input.pages.filter((p) => !input.site.prefixes.some((x) => p.path.startsWith(`${x}/`)))
/** A page or width the check step skipped fails the check that needed it, so a step that stopped part-way never passes. */
const unvisited = (input: Coverage): string[] =>
  mainPages(input).flatMap((p) => gateWidths.filter((w) => !input.visits.some((v) => v.path === p.path && v.width === w)).map((w) => `The ${pageName(p)} wasn't visited at ${w} px.`))

export const checkValidator = (problems: readonly Problem[]): GateCheck =>
  gateCheck('validator', problems.map((p) => `${p.file ?? 'The theme'}${p.line ? `:${p.line}` : ''}: ${p.message}`))

/** ARCHITECTURE §3.1–§3.2: every route has its page, each page has its required parts, one h1 and a main, and none crashes. */
export const checkContracts = (input: Pick<GateInput, 'routes' | 'pages' | 'visits' | 'poweredBy' | 'priced' | 'legal'>): GateCheck => {
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
  for (const route of ['blog', 'blogPost'] as const) {
    if (!input.routes.routes[route]) continue
    const address = contentAddresses[route]
    const path = 'page' in address ? address.page : fallbackPath(route)
    if (!built.has(path)) problems.push(`The build has no ${pageName({ path, route })}.`)
  }
  for (const path of Object.keys(input.routes.custom ?? {})) if (!built.has(`${path}/`)) problems.push(`The build has no page ${path}/.`)
  for (const page of input.pages) problems.push(...pageShape(page, shapeOf(input)))
  for (const v of input.visits) if (v.errors.length > 0) problems.push(`The ${at(v)} failed while loading.`)
  return gateCheck('contracts', problems)
}

const pageShape = (page: PageRead, shape: Shape): string[] => [
  ...(page.errors.length > 0 ? [`The ${pageName(page)} failed to load without JavaScript.`] : []),
  ...partsFor(page.route, shape)
    .filter((part) => !page.html.includes(`data-df-sealed="${part}"`))
    .map((part) => `The ${pageName(page)} doesn't place the required "${part}" component.`),
  ...(page.h1s.length === 1 ? [] : [`The ${pageName(page)} has ${page.h1s.length} main headings (h1); it needs exactly one.`]),
  ...(/<main[\s>]/.test(page.html) ? [] : [`The ${pageName(page)} has no main landmark.`]),
  ...(/<html[^>]*\slang="[^"]+"/.test(page.html) ? [] : [`The ${pageName(page)} doesn't name its language.`]),
]

/** A check with nothing to judge fails: a check step that stopped part-way never reads as a pass. */
const sawNothing = (what: string) => [`This check saw no ${what}.`]

export const checkSealed = (input: Coverage): GateCheck =>
  gateCheck('sealed', input.visits.length === 0 ? sawNothing('pages') : [...unvisited(input), ...input.visits.flatMap((v) => v.sealed.map((p) => `At ${v.width} px: ${p}`))])

/** The checkout smoke test against the offline Shop API fixture: the cart and checkout open, are seen and work at every width. */
export const checkCheckout = (visits: readonly PageVisit[]): GateCheck => {
  const problems: string[] = []
  for (const route of ['checkout', 'cart'] as const) {
    for (const width of gateWidths) {
      const v = visits.find((x) => x.route === route && x.width === width)
      if (!v) problems.push(`The ${route} page wasn't opened at ${width} px.`)
      else if (v.errors.length > 0) problems.push(`The ${at(v)} stopped with an error.`)
      else if (!v.mainSeen) problems.push(`The ${at(v)} can't be used: its main content is hidden, off screen or covered.`)
      else if (v.sealed.length > 0) problems.push(`The ${at(v)} hides a required part: ${v.sealed[0] ?? ''}`)
    }
  }
  return gateCheck('checkout', problems)
}

export const checkAxe = (input: Coverage): GateCheck =>
  gateCheck('axe', input.visits.length === 0 ? sawNothing('pages') : [...unvisited(input), ...input.visits.filter((v) => v.axe.length > 0).map((v) => `The ${at(v)} breaks accessibility rules: ${[...new Set(v.axe)].join(', ')}.`)])

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length === 0 ? Number.POSITIVE_INFINITY : (sorted[Math.floor((sorted.length - 1) / 2)] ?? Number.POSITIVE_INFINITY)
}
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`

/** ARCHITECTURE §9: checkout is outside the JavaScript budget ("checkout excluded"), and inside every other one. */
export const checkBudgets = (input: Pick<GateInput, 'pages' | 'weights' | 'site'>): GateCheck => {
  const b = pageBudgets
  const weights = input.weights
  const unweighed = mainPages(input).filter((p) => budgetedRoutes.has(p.route) && !weights.some((w) => w.path === p.path)).map((p) => `The ${pageName(p)} wasn't weighed.`)
  const problems = weights.length === 0 ? sawNothing('pages weighed') : [...unweighed, ...weights.flatMap((w) => {
    const name = upper(pageName(w))
    const found: string[] = []
    if (w.route !== 'checkout' && w.jsGzip > b.jsGzip) found.push(`${name} loads ${kb(w.jsGzip)} of JavaScript gzipped, over the ${kb(b.jsGzip)} budget.`)
    if (w.cssGzip > b.cssGzip) found.push(`${name} loads ${kb(w.cssGzip)} of CSS gzipped, over the ${kb(b.cssGzip)} budget.`)
    if (w.bytes > b.pageBytes) found.push(`${name} weighs ${kb(w.bytes)} on a phone, over the ${kb(b.pageBytes)} budget.`)
    if (median(w.lcpMs) > b.lcpMs) found.push(`${name} shows its largest content after ${Math.round(median(w.lcpMs))} ms, over ${b.lcpMs} ms.`)
    if (median(w.cls) > b.cls) found.push(`${name} shifts its layout by ${median(w.cls).toFixed(3)}, over ${b.cls}.`)
    if (median(w.tbtMs) > b.tbtMs) found.push(`${name} blocks for ${Math.round(median(w.tbtMs))} ms while loading, over ${b.tbtMs} ms (runs ${w.tbtMs.map(Math.round).join(', ')} ms; CPU slowed ${w.cpuSlowdown.toFixed(1)}×).`)
    return found
  })]
  const runtime = Math.max(0, ...weights.map((w) => w.runtimeJsGzip))
  return gateCheck('budgets', problems, runtime > 0 ? `Core's runtime adds ${kb(runtime)} of JavaScript gzipped to a page, outside the theme's budget.` : undefined)
}

/** ARCHITECTURE §8: without JavaScript every page still shows its heading and its main words. */
const withoutJs = (p: PageRead): string[] => [
  ...((p.h1s[0] ?? '').trim() === '' ? [`The ${pageName(p)}'s main heading is empty without JavaScript.`] : []),
  ...(p.mainText.trim() === '' ? [`The ${pageName(p)} shows no main text without JavaScript.`] : []),
]

export const checkNoJs = (pages: readonly PageRead[]): GateCheck => gateCheck('no-js', pages.length === 0 ? sawNothing('pages') : pages.flatMap(withoutJs))

const internal = (href: string) => href.startsWith('/') && !href.startsWith('//')
/** Plain names only: no `..`, encoded character, backslash, empty segment, query or fragment can pass for an address. */
const plainPath = (path: string) => /^\/(?:[A-Za-z0-9_-]+(?:\.[A-Za-z0-9]+)?\/?)*$/.test(path) && !path.includes('//')

const sitemapLocs = (xml: string) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1] ?? '')

/** Every link leads somewhere, and the sitemap and robots.txt name exactly the pages search engines should see. */
export const checkCrawl = (input: Pick<GateInput, 'pages' | 'site'>): GateCheck => {
  const pages = new Set(input.pages.map((p) => p.path))
  const files = new Set(input.site.files.map((f) => `/${f}`))
  const prefixes = [...coreRoutes.map((r) => routeAddresses[r]), ...Object.values(contentAddresses)].flatMap((a) => ('prefix' in a ? [a.prefix] : []))
  // An item address in another language keeps its route's prefix after the language's code (`/hi/products/…`).
  const unprefixed = (path: string) => [path, ...input.site.prefixes.filter((p) => path.startsWith(`${p}/`)).map((p) => path.slice(p.length))]
  const leads = (href: string) => {
    const path = href.split(/[?#]/)[0] ?? ''
    return pages.has(path) || files.has(path) || (plainPath(path) && unprefixed(path).some((u) => prefixes.some((p) => u.startsWith(p) && u.length > p.length)))
  }
  const problems = input.pages.flatMap((p) => p.links.filter((href) => internal(href) && !leads(href)).map((href) => `The link ${href} on the ${pageName(p)} leads nowhere.`))
  const sitemap = `${input.site.origin}/sitemap.xml`
  if (input.site.sitemap === null) problems.push('The build has no sitemap.xml.')
  else {
    const listed = new Set(sitemapLocs(input.site.sitemap))
    const wanted = input.pages.filter((p) => indexable(p.route) && !p.path.includes('/_fallback/')).map((p) => `${input.site.origin}${p.path}`)
    for (const url of wanted) if (!listed.has(url)) problems.push(`The sitemap leaves out ${url}.`)
    // An item of an indexable route (a product, a collection, a policy) may be listed, in any of the store's languages.
    const itemPrefixes = [...coreRoutes.map((r) => [r, routeAddresses[r]] as const), ...(['blogPost'] as const).map((r) => [r, contentAddresses[r]] as const)].flatMap(([r, a]) => (indexable(r) && 'prefix' in a ? [a.prefix] : []))
    const item = (url: string) => {
      const path = url.startsWith(`${input.site.origin}/`) ? url.slice(input.site.origin.length) : ''
      return plainPath(path) && unprefixed(path).some((u) => itemPrefixes.some((p) => u.startsWith(p) && u.length > p.length))
    }
    for (const url of listed) if (!wanted.includes(url) && !item(url)) problems.push(`The sitemap lists ${url}, which isn't a page search engines should see.`)
  }
  if (!input.site.robots?.split('\n').includes(`Sitemap: ${sitemap}`)) problems.push('robots.txt doesn’t name the sitemap.')
  return gateCheck('crawl', problems)
}

/** ARCHITECTURE §3.3 "Invented data": the words a shopper reads, outside core's sealed parts and the store's own data. */
export const checkClaims = (pages: readonly PageRead[], data: readonly string[]): GateCheck => {
  const strip = (text: string) => data.filter((d) => d.trim() !== '').reduce((t, d) => t.split(d).join(' '), text)
  return gateCheck('content', pages.flatMap((p) => claimsIn(strip(p.text)).map((c) => `The ${pageName(p)} reads as ${c.what}. Such facts come only from the store's data through core.`)))
}

const pagesWord = (n: number) => `${n} ${new Intl.PluralRules('en').select(n) === 'one' ? 'page looks' : 'pages look'}`

export const checkVisualDiff = (visits: readonly PageVisit[], strict: boolean): GateCheck => {
  const compared = visits.filter((v) => v.diff !== null)
  const changed = compared.filter((v) => (v.diff ?? 0) > lookTolerance)
  const words = changed.map((v) => `The ${at(v)} looks different from the live site (${((v.diff ?? 0) * 100).toFixed(1)}% of it changed).`)
  // A publish that must keep the look can't pass on nothing compared, as when the live pages never loaded.
  if (strict) return gateCheck('visual-diff', compared.length === 0 ? sawNothing('live pages to compare with') : words)
  const pages = new Set(changed.map((v) => v.path)).size
  return gateCheck('visual-diff', [], compared.length === 0 ? 'There is no live site to compare with.' : pages === 0 ? 'Every page looks as it does on the live site.' : `${pagesWord(pages)} different from the live site.`)
}

/** ARCHITECTURE §10: the theme against the edge-case catalogue renders whole, fits the screen and keeps its required parts. */
export const checkEdgeCases = (input: Pick<GateInput, 'edge' | 'edgeNames' | 'poweredBy' | 'priced' | 'legal' | 'pages' | 'site'>): GateCheck => {
  const { edge } = input
  const expected = mainPages(input)
  // Every case renders every page of the main build, each read and seen at phone width.
  const missing = input.edgeNames.flatMap((n) => {
    const c = edge.find((x) => x.name === n)
    if (!c) return [`The edge case "${n}" wasn't rendered and seen.`]
    return expected.flatMap((p) => [
      ...(c.pages.some((r) => r.path === p.path) ? [] : [`With ${n}: the ${pageName(p)} wasn't rendered.`]),
      ...(c.visits.some((v) => v.path === p.path && v.width === gateWidths[0]) ? [] : [`With ${n}: the ${pageName(p)} wasn't seen at ${gateWidths[0]} px.`]),
    ])
  })
  return gateCheck(
    'edge-cases',
    edge.length === 0 ? sawNothing('edge-case renders') : [...missing, ...edge.flatMap(({ name, pages, visits }) => [
      ...pages.flatMap((p) => [...pageShape(p, shapeOf(input)), ...withoutJs(p)].map((d) => `With ${name}: ${d}`)),
      ...visits.flatMap((v) => [
        ...(v.errors.length > 0 ? [`With ${name}: the ${at(v)} failed while loading.`] : []),
        ...v.sealed.map((s) => `With ${name}, at ${v.width} px: ${s}`),
        ...(v.overflow ? [`With ${name}: the ${at(v)} is wider than the screen.`] : []),
      ]),
    ])],
  )
}

export const runGate = (input: GateInput): GateReport =>
  gateReport([
    checkValidator(input.validator),
    checkContracts(input),
    checkSealed(input),
    checkCheckout(input.visits),
    checkAxe(input),
    checkBudgets(input),
    checkNoJs(input.pages),
    checkCrawl(input),
    checkClaims(input.pages, input.data),
    checkVisualDiff(input.visits, input.strictLook),
    checkEdgeCases(input),
  ])
