import { describe, expect, it } from 'vitest'
import { routeAddresses, type ThemeRoutes } from '../../contracts/routes'
import { coreRoutes, requiredParts, type CoreRoute } from '../../contracts/theme'
import { catalogueSnapshotSchema, edgeCases, fallbackPath, gateChecks, gateReport, gateWidths, maxDetail, pageBudgets, runGate, type CatalogueSnapshot, type GateCheckName, type GateInput, type PageRead, type PageVisit, type PageWeight } from '../index'

const origin = 'https://shop.example.com'
const routes: ThemeRoutes = { routes: Object.fromEntries(coreRoutes.map((r) => [r, 'HomePage'])), custom: { '/our-story': 'AboutPage' } }

const pathOf = (route: CoreRoute) => {
  const a = routeAddresses[route]
  return 'page' in a ? a.page : fallbackPath(route)
}
const html = (route: CoreRoute | 'custom') =>
  `<!doctype html><html lang="en"><body><header></header><main><h1>Title</h1>${requiredParts(route === 'custom' ? 'home' : route, { preview: false, poweredBy: true, legal: false, priced: false })
    .map((p) => `<df-sealed data-df-sealed="${p}"></df-sealed>`)
    .join('')}</main></body></html>`
const read = (path: string, route: CoreRoute | 'custom'): PageRead => ({ path, route, html: html(route), h1s: ['Title'], mainText: 'Made slowly.', text: 'Title Made slowly.', links: ['/', '/our-story/'] })
const pages: PageRead[] = [...coreRoutes.map((r) => read(pathOf(r), r)), read('/our-story/', 'custom')]
const visit = (p: PageRead, width: number): PageVisit => ({ path: p.path, route: p.route, width, errors: [], sealed: [], axe: [], mainSeen: true, overflow: false, diff: null })
const visits = pages.flatMap((p) => gateWidths.map((w) => visit(p, w)))
const weight = (p: PageRead): PageWeight => ({ path: p.path, route: p.route, jsGzip: 40_000, runtimeJsGzip: 0, cssGzip: 4_000, bytes: 120_000, lcpMs: [900, 3000, 950], cls: [0, 0.2, 0.01], tbtMs: [20, 400, 30] })
const indexed = pages.filter((p) => ['home', 'custom', 'product', 'collection', 'policy'].includes(p.route) && !p.path.startsWith('/_fallback/'))

const good: GateInput = {
  validator: [],
  routes,
  pages,
  visits,
  weights: pages.map(weight),
  site: { origin, sitemap: `<urlset>${indexed.map((p) => `<url><loc>${origin}${p.path}</loc></url>`).join('')}</urlset>`, robots: `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`, files: ['assets/entry-a.js'] },
  data: ['Northstar Linen'],
  poweredBy: true,
  strictLook: false,
  edge: [{ name: 'a right-to-left layout', pages: [pages[0] as PageRead], visits: [visit(pages[0] as PageRead, 390)] }],
}

const failing = (input: GateInput) => runGate(input).checks.filter((c) => !c.passed).map((c) => c.name)
const detail = (input: GateInput, name: GateCheckName) => runGate(input).checks.find((c) => c.name === name)?.detail ?? ''
const onPage = <T extends { path: string }>(list: readonly T[], path: string, change: (x: T) => T) => list.map((x) => (x.path === path ? change(x) : x))

describe('the full gate', () => {
  it('passes a build that meets every check, reporting every check in order', () => {
    const report = runGate(good)
    expect(report.passed).toBe(true)
    expect(report.checks.map((c) => c.name)).toEqual([...gateChecks])
  })

  it('names the one check each failing build breaks (ARCHITECTURE §4.2 step 3)', () => {
    const cases: [GateCheckName, GateInput][] = [
      ['validator', { ...good, validator: [{ file: 'src/theme/pages/HomePage.tsx', line: 3, rule: 'code/import-not-allowed', message: 'A theme may not import that.' }] }],
      ['contracts', { ...good, pages: pages.filter((p) => p.route !== 'search') }],
      ['sealed', { ...good, visits: onPage(visits, '/', (v) => (v.width === 768 ? { ...v, sealed: ['The "powered" component on the home page isn’t seen: something covers its centre.'] } : v)) }],
      ['checkout', { ...good, visits: onPage(visits, '/checkout/', (v) => (v.width === 390 ? { ...v, mainSeen: false } : v)) }],
      ['axe', { ...good, visits: onPage(visits, '/cart/', (v) => ({ ...v, axe: ['color-contrast'] })) }],
      ['budgets', { ...good, weights: onPage(good.weights, '/', (w) => ({ ...w, jsGzip: pageBudgets.jsGzip + 1 })) }],
      ['no-js', { ...good, pages: onPage(pages, '/', (p) => ({ ...p, h1s: [''] })) }],
      ['crawl', { ...good, pages: onPage(pages, '/', (p) => ({ ...p, links: ['/products/', '/gone/'] })) }],
      ['content', { ...good, pages: onPage(pages, '/', (p) => ({ ...p, text: 'Hurry, only 2 left in stock!' })) }],
      ['visual-diff', { ...good, strictLook: true, visits: onPage(visits, '/', (v) => ({ ...v, diff: 0.2 })) }],
      ['edge-cases', { ...good, edge: [{ name: 'very long names', pages: [], visits: [{ ...visit(pages[0] as PageRead, 390), overflow: true }] }] }],
    ]
    for (const [name, input] of cases) expect([name, failing(input)]).toEqual([name, [name]])
  })

  it('refuses a hidden tax label, a checkout broken on phones, JavaScript over budget and an empty h1, each by name', () => {
    const tax = { ...good, visits: onPage(visits, '/cart/', (v) => ({ ...v, sealed: ['The "price" component on the cart page isn’t seen: it is hidden.'] })) }
    expect(failing(tax)).toEqual(['sealed', 'checkout'])
    expect(detail(tax, 'checkout')).toContain('cart page at 390 px hides a required part')
    expect(detail({ ...good, visits: onPage(visits, '/checkout/', (v) => (v.width === 390 ? { ...v, mainSeen: false } : v)) }, 'checkout')).toBe("The checkout page at 390 px can't be used: its main content is hidden, off screen or covered.")
    expect(detail({ ...good, weights: onPage(good.weights, '/our-story/', (w) => ({ ...w, jsGzip: 120 * 1024 })) }, 'budgets')).toBe('Page /our-story/ loads 120.0 KB of JavaScript gzipped, over the 90.0 KB budget.')
    expect(detail({ ...good, pages: onPage(pages, '/', (p) => ({ ...p, h1s: ['  '] })) }, 'no-js')).toBe("The home page's main heading is empty without JavaScript.")
  })

  it('leaves checkout out of the JavaScript budget, and takes the median of three timings', () => {
    expect(failing({ ...good, weights: onPage(good.weights, '/checkout/', (w) => ({ ...w, jsGzip: 200_000 })) })).toEqual([])
    expect(failing({ ...good, weights: onPage(good.weights, '/', (w) => ({ ...w, lcpMs: [2100, 2200, 100] })) })).toEqual(['budgets'])
  })

  it('names a page with a missing required part, two h1s or a crash as a contract failure', () => {
    const noConsent = onPage(pages, '/cart/', (p) => ({ ...p, html: p.html.replace('data-df-sealed="consent"', '') }))
    expect(detail({ ...good, pages: noConsent }, 'contracts')).toBe('The cart page doesn\'t place the required "consent" component.')
    expect(detail({ ...good, pages: onPage(pages, '/', (p) => ({ ...p, h1s: ['A', 'B'] })) }, 'contracts')).toBe('The home page has 2 main headings (h1); it needs exactly one.')
    expect(detail({ ...good, visits: onPage(visits, '/search/', (v) => ({ ...v, errors: ['TypeError: x is undefined'] })) }, 'contracts')).toContain('The search page at 390 px failed while loading: TypeError')
  })

  it('reports a changed look without failing unless the publish must keep the look', () => {
    const changed = { ...good, visits: onPage(visits, '/', (v) => ({ ...v, diff: 0.2 })) }
    expect(runGate(changed).checks.find((c) => c.name === 'visual-diff')).toEqual({ name: 'visual-diff', passed: true, detail: '1 pages look different from the live site.' })
    expect(runGate(good).checks.find((c) => c.name === 'visual-diff')?.detail).toBe('There is no live site to compare with.')
  })

  it('lets the store’s own words through the content scan', () => {
    expect(failing({ ...good, data: ['Only 2 Left Studio'], pages: onPage(pages, '/', (p) => ({ ...p, text: 'Welcome to Only 2 Left Studio' })) })).toEqual([])
  })

  it('keeps a sitemap to the pages search engines should see', () => {
    const withCart = { ...good, site: { ...good.site, sitemap: `${good.site.sitemap ?? ''}<url><loc>${origin}/cart/</loc></url>` } }
    expect(detail(withCart, 'crawl')).toBe(`The sitemap lists ${origin}/cart/, which isn't a page search engines should see.`)
    expect(detail({ ...good, site: { ...good.site, robots: 'User-agent: *\n' } }, 'crawl')).toBe('robots.txt doesn’t name the sitemap.')
  })

  it('fails a check that never ran, and keeps each check’s words short', () => {
    expect(gateReport([{ name: 'validator', passed: true }]).checks.find((c) => c.name === 'axe')).toEqual({ name: 'axe', passed: false, detail: 'This check did not run.' })
    const many = { ...good, visits: visits.map((v) => ({ ...v, axe: ['color-contrast', 'image-alt', 'label', 'link-name'] })) }
    expect(detail(many, 'axe').length).toBeLessThanOrEqual(maxDetail)
    expect(detail(many, 'axe')).toMatch(/And \d+ more\.$/)
  })
})

describe('the edge-case catalogue', () => {
  const snapshot: CatalogueSnapshot = catalogueSnapshotSchema.parse({
    version: 1,
    origin,
    store: { name: 'Northstar Linen', description: null, language: 'en', mainLanguage: 'en', languages: ['en', 'hi'], currency: 'INR', pricingCurrency: 'INR', currencies: [{ code: 'INR' }], pricesIncludeTax: true, timeZone: 'Asia/Kolkata', contactEmail: 'hello@northstar.example', contactPhone: null, logo: { url: '/shop-api/assets/m1' }, address: null },
    poweredBy: null,
    guard: { locales: ['en', 'hi'], usedPaths: [], mediaIds: [], brand: { name: 'Northstar Linen', tagline: null, email: null, phone: null, address: [], socialLinks: [] } },
    csp: { assetOrigin: null, mediaOrigins: [], analytics: [], payments: [] },
    assetBase: null,
  })

  it('pushes the store to its limits: long names and no details, each other language, and right to left', () => {
    const cases = edgeCases(snapshot)
    expect(cases.map((c) => [c.name, c.dir, c.snapshot.store.language])).toEqual([
      ['very long names and no logo or contact details', 'ltr', 'en'],
      ['the hi language', 'ltr', 'hi'],
      ['a right-to-left layout', 'rtl', 'en'],
    ])
    const long = cases[0]?.snapshot
    expect(long?.store.name.length).toBe(200)
    expect([long?.store.logo, long?.store.contactEmail, long?.poweredBy === null]).toEqual([null, null, false])
    for (const c of cases) expect(catalogueSnapshotSchema.safeParse(c.snapshot).success).toBe(true)
  })
})
