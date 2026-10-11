import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { Browser, BrowserContext, Page, Route } from 'playwright-core'
import { pageHeaders, storeCsp, themeRoutesSchema, type ThemeRoutes } from '@dripfunnel/storefront-core'
import { sealedProblemWords } from '@dripfunnel/storefront-core/testing'
import { edgeCases, gateWidths, pageName, runGate, validateChange, type CatalogueSnapshot, type GateReport, type PageRead, type PageVisit, type PageWeight, type ThemeFile } from '@dripfunnel/storefront-core/guard'
import { runtimeFolder } from '../gate/bundle'
import { edgeFolder } from './build'
import { fileOf, plan, type PlannedPage } from './pages'
import { fileFor, serveFolders, shopFixture, type Served, type ShopReport } from './serve'

// Step `check` (storefront LIVE-SHOP §4 step 7): a fresh process serves the built files to its own headless browser and
// runs ARCHITECTURE §4.2 step 3's gate over what it sees. The theme runs only inside the browser.

export type CheckInput = {
  /** The built site, exactly the files the runner hands over and later uploads. */
  site: string
  /** The build step's output folder, for the edge-case renders beside the site. */
  out: string
  /** The live build's files, for the visual diff; null before the first publish. */
  live: string | null
  snapshot: CatalogueSnapshot
  theme: readonly ThemeFile[]
  strictLook: boolean
  browser: Browser
}

export type CheckOutcome = { report: GateReport; headers: Record<string, { 'content-security-policy': string }> }

const consentKey = 'df-consent-v1'
const settle = 1100
const height = 900
const parallel = 6

const require = createRequire(import.meta.url)
const axeSource = () => readFile(require.resolve('axe-core/axe.min.js'), 'utf8')
const axeTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const pool = async <T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(parallel, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await work(items[i] as T)
      }
    }),
  )
  return results
}

const htmlFiles = async (root: string, prefix = ''): Promise<string[]> =>
  (
    await Promise.all(
      (await readdir(join(root, prefix), { withFileTypes: true })).map((e) => {
        const rel = prefix ? `${prefix}/${e.name}` : e.name
        return e.isDirectory() ? htmlFiles(root, rel) : Promise.resolve(rel.endsWith('.html') ? [rel] : [])
      }),
    )
  ).flat()

const allFiles = async (root: string, prefix = ''): Promise<string[]> =>
  (await Promise.all((await readdir(join(root, prefix), { withFileTypes: true })).map((e) => (e.isDirectory() ? allFiles(root, prefix ? `${prefix}/${e.name}` : e.name) : Promise.resolve([prefix ? `${prefix}/${e.name}` : e.name]))))).flat()

/** Each HTML file's CSP header (ARCHITECTURE §3.5), from the store's sources and the file's own inline hashes. */
const headersOf = async (root: string, snapshot: CatalogueSnapshot) => {
  const pages = await Promise.all((await htmlFiles(root)).sort().map(async (path) => ({ path, html: await readFile(join(root, path), 'utf8') })))
  return pageHeaders(pages, (hashes) => storeCsp(snapshot.csp, hashes))
}

type Network = { errors: string[]; reports: ShopReport[]; js: { url: string; gzip: number }[]; css: number; bytes: number }

/** Requests stay on this machine: the page's own server, the build's assets and the offline Shop API; anything else fails. */
const wire = async (page: Page, served: Served, s: CatalogueSnapshot, roots: { assets: string }, net: Network) => {
  const fixture = shopFixture(s, net.reports)
  await page.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin === served.origin && url.pathname === '/shop-api') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture(route.request().postData() ?? '')) })
    if (url.origin === served.origin) return route.fallback()
    const base = s.assetBase ? new URL(s.assetBase) : null
    if (base && url.origin === base.origin && url.pathname.startsWith(base.pathname)) {
      const found = await fileFor([roots.assets], url.pathname.slice(base.pathname.length))
      return found ? route.fulfill({ status: 200, body: found.bytes, contentType: found.rel.endsWith('.css') ? 'text/css' : 'text/javascript' }) : route.fulfill({ status: 404 })
    }
    net.errors.push(`It tried to reach ${url.origin}, outside the store.`)
    return route.abort('blockedbyclient')
  })
  page.on('pageerror', (e) => net.errors.push(e.message.split('\n')[0] ?? 'An error.'))
  // A request the CSP refused never leaves, so the route above never sees it; it still fails the page.
  await page.addInitScript(() => {
    const refused: string[] = []
    Object.defineProperty(window, '__dfRefused', { value: refused })
    document.addEventListener('securitypolicyviolation', (e) => {
      if (/^(?:https?|wss?):/.test(e.blockedURI)) refused.push(new URL(e.blockedURI).origin)
    })
  })
  page.on('response', (response) => {
    void response.body().then(
      (body) => {
        const type = response.request().resourceType()
        net.bytes += body.byteLength
        if (type === 'script') net.js.push({ url: response.url(), gzip: gzipSync(body).byteLength })
        if (type === 'stylesheet') net.css += gzipSync(body).byteLength
      },
      () => undefined,
    )
  })
}

const settled = async (page: Page, net: Network) => {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(settle)
  await page.evaluate(() => window.scrollTo(0, 0))
  for (const origin of new Set((await page.evaluate('window.__dfRefused ?? []')) as string[])) net.errors.push(`It tried to reach ${origin}, which its content security policy refused.`)
}

/** The page's main heading is shown inside its main landmark, on screen, and is what a tap at its centre reaches. */
const mainSeen = (page: Page) =>
  page.evaluate(() => {
    const heading = document.querySelector('main h1')
    if (!heading?.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false
    heading.scrollIntoView({ block: 'center', inline: 'center' })
    const r = heading.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const hit = r.width >= 1 && r.height >= 1 && x >= 0 && x < innerWidth && y >= 0 && y < innerHeight ? document.elementFromPoint(x, y) : null
    window.scrollTo(0, 0)
    return hit !== null && heading.contains(hit)
  })

const overflows = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)

const sealedWords = (reports: readonly ShopReport[], p: { path: string; route: PlannedPage['route'] }, only?: string) =>
  reports
    .filter((r) => r.kind === 'SEALED' && (only === undefined || r.subject === only))
    .map((r) => (r.detail && ['hidden', 'transparent', 'too-small', 'off-screen', 'covered'].includes(r.detail) ? sealedProblemWords(pageName(p), r.subject as 'price', r.detail as 'hidden') : `The "${r.subject}" component on the ${pageName(p)} isn't seen.`))

type Contexts = { returning: BrowserContext; first: BrowserContext }

const contextsFor = async (browser: Browser, width: number): Promise<Contexts> => {
  const returning = await browser.newContext({ viewport: { width, height } })
  // A returning shopper who has answered, so the open banner doesn't cover the page; `first` checks the banner itself.
  await returning.addInitScript(([key]) => localStorage.setItem(key ?? '', JSON.stringify({ analytics: false, marketing: false, at: '2026-01-01T00:00:00.000Z' })), [consentKey])
  return { returning, first: await browser.newContext({ viewport: { width, height } }) }
}

const visit = async (c: Contexts, served: Served, s: CatalogueSnapshot, assets: string, p: PlannedPage, width: number, axe: string | null): Promise<{ visit: PageVisit; shot: Buffer }> => {
  const net: Network = { errors: [], reports: [], js: [], css: 0, bytes: 0 }
  const page = await c.returning.newPage()
  try {
    await wire(page, served, s, { assets }, net)
    await page.goto(`${served.origin}${p.path}`, { waitUntil: 'load' })
    await settled(page, net)
    const seen = await mainSeen(page)
    const wide = await overflows(page)
    const broken = axe ? ((await page.evaluate(`${axe};axe.run(document,{runOnly:{type:'tag',values:${JSON.stringify(axeTags)}},resultTypes:['violations']}).then(r=>r.violations.map(v=>v.id))`)) as string[]) : []
    const shot = await page.screenshot()
    const sealed = sealedWords(net.reports, p)
    if (p.route === 'home' || p.route === 'checkout') sealed.push(...(await firstVisit(c, served, s, assets, p)))
    return { visit: { path: p.path, route: p.route, width, errors: net.errors, sealed, axe: broken, mainSeen: seen, overflow: wide, diff: null }, shot }
  } finally {
    await page.close()
  }
}

/** A shopper's first visit, where the consent banner itself must be seen. */
const firstVisit = async (c: Contexts, served: Served, s: CatalogueSnapshot, assets: string, p: PlannedPage) => {
  const net: Network = { errors: [], reports: [], js: [], css: 0, bytes: 0 }
  const page = await c.first.newPage()
  try {
    await wire(page, served, s, { assets }, net)
    await page.goto(`${served.origin}${p.path}`, { waitUntil: 'load' })
    await page.waitForTimeout(settle)
    return sealedWords(net.reports, p, 'consent')
  } finally {
    await page.close()
  }
}

// A fixed loop takes about this long on the mid-range phone ARCHITECTURE §9 means; the CPU is slowed to match, so a
// busy or fast runner measures the same phone (as Lighthouse calibrates its throttling).
const phoneLoopMs = 360
const loop = `(() => { const t = performance.now(); let x = 0; for (let i = 0; i < 2e7; i += 1) x = (x * 31 + i) % 1000003; return x < 0 ? 0 : performance.now() - t })()`

const phoneRate = async (browser: Browser): Promise<number> => {
  const page = await browser.newPage()
  try {
    const times: number[] = []
    for (let i = 0; i < 3; i += 1) times.push((await page.evaluate(loop)) as number)
    const host = times.sort((a, b) => a - b)[1] ?? phoneLoopMs
    return Math.min(6, Math.max(1, phoneLoopMs / Math.max(host, 1)))
  } finally {
    await page.close()
  }
}

/** ARCHITECTURE §9 budgets these page types. */
const weighed: ReadonlySet<PlannedPage['route']> = new Set(['home', 'collection', 'product', 'custom', 'cart'])

/** ARCHITECTURE §9 on a mid-range phone: the first load's bytes, and its timings three times. */
const weigh = async (browser: Browser, served: Served, s: CatalogueSnapshot, assets: string, p: PlannedPage, rate: number): Promise<PageWeight> => {
  const w: PageWeight = { path: p.path, route: p.route, jsGzip: 0, runtimeJsGzip: 0, cssGzip: 0, bytes: 0, lcpMs: [], cls: [], tbtMs: [] }
  for (let run = 0; run < 3; run += 1) {
    const context = await browser.newContext({ viewport: { width: gateWidths[0], height }, isMobile: true, hasTouch: true })
    await context.addInitScript(() => {
      const m = { lcp: 0, cls: 0, tbt: 0 }
      Object.defineProperty(window, '__dfMetrics', { value: m })
      new PerformanceObserver((l) => l.getEntries().forEach((e) => (m.lcp = e.startTime))).observe({ type: 'largest-contentful-paint', buffered: true })
      new PerformanceObserver((l) => l.getEntries().forEach((e) => (m.cls += (e as PerformanceEntry & { hadRecentInput?: boolean; value?: number }).hadRecentInput ? 0 : ((e as PerformanceEntry & { value?: number }).value ?? 0)))).observe({ type: 'layout-shift', buffered: true })
      new PerformanceObserver((l) => l.getEntries().forEach((e) => (m.tbt += Math.max(0, e.duration - 50)))).observe({ type: 'longtask', buffered: true })
    })
    const page = await context.newPage()
    const net: Network = { errors: [], reports: [], js: [], css: 0, bytes: 0 }
    try {
      const cdp = await context.newCDPSession(page)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate })
      await wire(page, served, s, { assets }, net)
      await page.goto(`${served.origin}${p.path}`, { waitUntil: 'load' })
      await page.waitForTimeout(800)
      const m = (await page.evaluate('window.__dfMetrics')) as { lcp: number; cls: number; tbt: number }
      w.lcpMs.push(m.lcp)
      w.cls.push(m.cls)
      w.tbtMs.push(m.tbt)
      if (run === 0) {
        // The theme's own chunks; core's runtime under assets/core/ is reported beside them (ARCHITECTURE §9).
        const runtime = (j: { url: string }) => new URL(j.url).pathname.includes(`/${runtimeFolder}`)
        w.jsGzip = net.js.filter((j) => !runtime(j)).reduce((n, j) => n + j.gzip, 0)
        w.runtimeJsGzip = net.js.filter(runtime).reduce((n, j) => n + j.gzip, 0)
        w.cssGzip = net.css
        w.bytes = net.bytes
      }
    } finally {
      await context.close()
    }
  }
  return w
}

// Browser-side code as text: a bundler's helpers would otherwise travel into the page with a function's source.
const readFacts = `(() => {
  const words = (el) => {
    if (!el) return ''
    const copy = el.cloneNode(true)
    copy.querySelectorAll('df-sealed, script').forEach((x) => x.remove())
    return (copy.textContent || '').replace(/\\s+/g, ' ').trim()
  }
  return {
    h1s: [...document.querySelectorAll('h1')].map((h) => (h.textContent || '').trim()),
    mainText: words(document.querySelector('main')),
    text: words(document.body),
    links: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || ''),
  }
})()`

/** A page without JavaScript, as a crawler and a shopper with scripts off see it (ARCHITECTURE §8). */
const readPage = async (context: BrowserContext, served: Served, root: string, p: PlannedPage, prefix = ''): Promise<PageRead | null> => {
  const found = await fileFor([root], `${prefix}${p.path}`)
  if (!found) return null
  const page = await context.newPage()
  try {
    await page.goto(`${served.origin}${prefix}${p.path}`, { waitUntil: 'load' })
    const facts = (await page.evaluate(readFacts)) as Pick<PageRead, 'h1s' | 'mainText' | 'text' | 'links'>
    return { path: p.path, route: p.route, html: found.bytes.toString('utf8'), ...facts }
  } finally {
    await page.close()
  }
}

/** The share of pixels that differ between two screenshots, compared in a blank page of the browser. */
const difference = async (page: Page, a: Buffer, b: Buffer): Promise<number> =>
  (await page.evaluate(`(async () => {
    const load = async (b64) => createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob())
    const [one, two] = await Promise.all([load('${a.toString('base64')}'), load('${b.toString('base64')}')])
    if (one.width !== two.width || one.height !== two.height) return 1
    const pixels = (img) => {
      const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d')
      ctx.drawImage(img, 0, 0)
      return ctx.getImageData(0, 0, img.width, img.height).data
    }
    const p = pixels(one)
    const q = pixels(two)
    let changed = 0
    for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 24) changed += 1
    return changed / (p.length / 4 || 1)
  })()`)) as number

/** The live site's page at the same width, its JS and CSS served from the live build's own files. */
const liveShot = async (browser: Browser, served: Served, live: string, s: CatalogueSnapshot, path: string, width: number): Promise<Buffer | null> => {
  if (!(await fileFor([live], path))) return null
  const context = await browser.newContext({ viewport: { width, height } })
  await context.addInitScript(([key]) => localStorage.setItem(key ?? '', JSON.stringify({ analytics: false, marketing: false, at: '2026-01-01T00:00:00.000Z' })), [consentKey])
  const page = await context.newPage()
  try {
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === served.origin) return route.fallback()
      // A live page names its own build's asset folder; the runner fetched those files into `live` by their paths.
      const asset = /\/assets\/(.*)$/.exec(url.pathname)?.[0]
      const found = asset ? await fileFor([live], asset) : null
      return found ? route.fulfill({ status: 200, body: found.bytes }) : route.abort('blockedbyclient')
    })
    await page.goto(`${served.origin}${path}`, { waitUntil: 'load' })
    await settled(page, { errors: [], reports: [], js: [], css: 0, bytes: 0 })
    return await page.screenshot()
  } finally {
    await context.close()
  }
}

const routesOf = (theme: readonly ThemeFile[]): ThemeRoutes => themeRoutesSchema.parse(JSON.parse(theme.find((f) => f.path === 'routes.json')?.content ?? '{}'))

export const checkSite = async (input: CheckInput): Promise<CheckOutcome> => {
  const { snapshot: s, browser, site } = input
  const validator = validateChange(input.theme, s.guard).problems
  const routes = routesOf(input.theme)
  const pages = plan(routes, s.store)
  const main = pages.filter((p) => p.language === s.store.mainLanguage)
  const headers = await headersOf(site, s)
  const served = await serveFolders([site], (rel) => headers[rel]?.['content-security-policy'] ?? null)
  const cases = edgeCases(s)
  const edgeRoots = cases.map((_, n) => join(input.out, edgeFolder(n)))
  const edgeHeaders = await Promise.all(edgeRoots.map((root, n) => headersOf(root, cases[n]?.snapshot ?? s)))
  const edgeServed = await Promise.all(edgeRoots.map((root, n) => serveFolders([root, site], (rel) => edgeHeaders[n]?.[rel]?.['content-security-policy'] ?? null)))
  const liveServed = input.live ? await serveFolders([input.live], () => null) : null
  const scripts = await browser.newContext({ javaScriptEnabled: false })
  const blank = await (await browser.newContext()).newPage()
  try {
    const reads = (await pool(pages, (p) => readPage(scripts, served, site, p))).filter((r): r is PageRead => r !== null)
    const axe = await axeSource()
    const visits: PageVisit[] = []
    for (const width of gateWidths) {
      const c = await contextsFor(browser, width)
      try {
        const done = await pool(main, (p) => (fileOf(p.path) in headers ? visit(c, served, s, site, p, width, axe) : Promise.resolve(null)))
        for (const result of done) {
          if (!result) continue
          const before = input.live && liveServed ? await liveShot(browser, liveServed, input.live, s, result.visit.path, width) : null
          visits.push({ ...result.visit, diff: before ? await difference(blank, result.shot, before) : null })
        }
      } finally {
        await c.returning.close()
        await c.first.close()
      }
    }
    // One page at a time: timings taken side by side would slow each other down.
    const weights: PageWeight[] = []
    const rate = await phoneRate(browser)
    for (const p of main.filter((x) => weighed.has(x.route) && fileOf(x.path) in headers)) weights.push(await weigh(browser, served, s, site, p, rate))
    const edge = await Promise.all(
      cases.map(async (edgeCase, n) => {
        const servedEdge = edgeServed[n]
        const root = edgeRoots[n]
        if (!servedEdge || !root) return { name: edgeCase.name, pages: [], visits: [] }
        const c = await contextsFor(browser, gateWidths[0])
        try {
          const casePages = main.map((p) => ({ ...p, language: edgeCase.snapshot.store.language }))
          const edgeReads = (await pool(casePages, (p) => readPage(scripts, servedEdge, root, p))).filter((r): r is PageRead => r !== null)
          const edgeVisits = (await pool(casePages, (p) => visit(c, servedEdge, edgeCase.snapshot, site, p, gateWidths[0], null))).map((v) => v.visit)
          return { name: edgeCase.name, pages: edgeReads, visits: edgeVisits }
        } finally {
          await c.returning.close()
          await c.first.close()
        }
      }),
    )
    const files = await allFiles(site)
    const text = async (name: string) => ((await fileFor([site], `/${name}`))?.bytes.toString('utf8') ?? null)
    const report = runGate({
      validator,
      routes,
      pages: reads,
      visits,
      weights,
      site: { origin: s.origin, sitemap: await text('sitemap.xml'), robots: await text('robots.txt'), files },
      data: [s.store.name, s.store.description ?? '', s.poweredBy ?? '', s.store.contactEmail ?? '', s.store.contactPhone ?? ''],
      poweredBy: s.poweredBy !== null,
      strictLook: input.strictLook,
      edge,
    })
    return { report, headers }
  } finally {
    await scripts.close()
    await blank.context().close()
    await Promise.all([served, ...edgeServed, ...(liveServed ? [liveServed] : [])].map((x) => x.close()))
  }
}
