import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { coreRoutes, routeAddresses, themeRoutesSchema } from '@dripfunnel/storefront-core'
import { catalogueSnapshotSchema, validateChange, type CatalogueSnapshot, type GuardContext, type ThemeFile } from '@dripfunnel/storefront-core/guard'
import { bundle, runtimeFolder } from './gate/bundle'
import { overBudget, weigh } from './gate/budgets'
import { buildSite } from './publish/build'
import { browserMetrics, checkSite, type LoadMetrics } from './publish/check'
import { fileFor, shopFixture } from './publish/serve'
import { buildRuntime } from './runtime/build'

// Card #486: every starting theme in templates/storefront/themes passes the validator, builds the preview bundle a new
// store's first preview is (PREVIEW §4) within the byte budgets, renders every route from it, and passes the publish gate.
vi.setConfig({ testTimeout: 600_000, hookTimeout: 120_000 })

const themesDir = fileURLToPath(new URL('../../../templates/storefront/themes/', import.meta.url))
const keys = readdirSync(themesDir).filter((k) => statSync(join(themesDir, k)).isDirectory()).sort()
const chrome = [process.env['CHROME_PATH'], '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p): p is string => p !== undefined && existsSync(p))

if (!chrome && process.env['CI']) throw new Error('The starting themes’ tests need Chromium in CI; set CHROME_PATH.')
if (!chrome) console.warn('Skipping the starting themes’ browser tests: no Chromium here (set CHROME_PATH).')

/** template.json, which the storefront_template rows mirror (DATA-MODEL §7.8). */
const templateSchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(40),
  tag: z.string().min(1).max(40),
  description: z.string().min(1).max(200),
  demoStore: z.null(),
  coreMinVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
})

const walk = (dir: string, rel = ''): string[] =>
  readdirSync(join(dir, rel)).flatMap((name) => {
    const path = rel ? `${rel}/${name}` : name
    return statSync(join(dir, path)).isDirectory() ? walk(dir, path) : [path]
  })

const themeFiles = (key: string): ThemeFile[] =>
  walk(join(themesDir, key))
    .filter((path) => path !== 'template.json')
    .map((path) => ({ path, content: readFileSync(join(themesDir, key, path), 'utf8') }))

const brand = { name: 'Northstar Linen', tagline: 'Linen clothes, made slowly', email: 'hello@northstar.example', phone: '+91 98450 22113', address: ['12 Residency Road', 'Bengaluru'], socialLinks: [] }
// The seed stores offer English only (en-IN and en-US), so the themes are written in English (card #486).
const india: GuardContext = { locales: ['en'], usedPaths: ['/faq', '/blog/why-linen'], mediaIds: [], brand }
const unitedStates: GuardContext = { locales: ['en'], usedPaths: [], mediaIds: [], brand: { ...brand, name: 'Juniper & Co.', address: ['Oak Street', 'Columbus'] } }

const snapshot: CatalogueSnapshot = catalogueSnapshotSchema.parse({
  version: 1,
  origin: 'https://shop.northstar.example',
  store: { name: 'Northstar Linen', description: 'Linen clothes, made slowly.', language: 'en', mainLanguage: 'en', languages: ['en'], currency: 'INR', pricingCurrency: 'INR', currencies: [{ code: 'INR' }], pricesIncludeTax: true, timeZone: 'Asia/Kolkata', contactEmail: 'hello@northstar.example', contactPhone: '+91 98450 22113', logo: null, address: { street: '12 Residency Road', city: 'Bengaluru', region: 'Karnataka', postal: '560025', country: 'IN' } },
  poweredBy: 'Acme Commerce',
  guard: india,
  csp: { assetOrigin: null, mediaOrigins: [], analytics: [], payments: [] },
  // A published post, so a theme that maps the blog builds its page and the gate checks it (#324).
  posts: [{ path: '/blog/why-linen', title: 'Why we work in linen', seoTitle: null, seoDescription: null, author: null, publishedAt: '2026-10-01T10:00:00.000Z', image: null }],
  assetBase: null,
})

/** One address for each route and custom page, as a shopper would open it on the preview host. */
const addresses = (routesJson: string) => {
  const routes = themeRoutesSchema.parse(JSON.parse(routesJson))
  return [
    ...coreRoutes.map((route) => {
      const address = routeAddresses[route]
      return { name: route, path: 'page' in address ? address.page : `${address.prefix}sample-1/` }
    }),
    ...Object.keys(routes.custom ?? {}).map((path) => ({ name: path, path: `${path}/` })),
  ]
}

let root: string
let runtime: string
let browser: Browser | null = null

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'themes-test-'))
  runtime = join(root, 'runtime')
  await buildRuntime(runtime)
  if (chrome) browser = await chromium.launch({ executablePath: chrome, headless: true })
})

afterAll(async () => {
  await browser?.close()
  rmSync(root, { recursive: true, force: true })
})

it('has the starting themes the gallery offers, each in its own folder', () => {
  expect(keys).toEqual(['atelier', 'baseline', 'bloom', 'circuit', 'concrete', 'linen', 'market'])
  for (const key of keys) expect(templateSchema.parse(JSON.parse(readFileSync(join(themesDir, key, 'template.json'), 'utf8'))).key).toBe(key)
})

describe.each(keys)('the %s theme', (key) => {
  const dir = join(themesDir, key)

  it('passes the validator for an Indian and an American store, neither of whose details it repeats', () => {
    expect(validateChange(themeFiles(key), india).problems).toEqual([])
    expect(validateChange(themeFiles(key), unitedStates).problems).toEqual([])
  })

  it('writes only theme files, and no quote attributed to a person (DESIGN §9)', () => {
    expect(themeFiles(key).every((f) => /^(?:src\/theme\/|content\/|routes\.json$)/.test(f.path))).toBe(true)
    for (const f of themeFiles(key)) {
      expect(f.content).not.toMatch(/<blockquote|<cite|<q\b/)
      if (f.path.startsWith('content/')) expect(f.content).not.toMatch(/[“”«»]/)
    }
  })

  it('builds a preview bundle within the byte budgets that renders every route in preview mode', async ({ skip }) => {
    const out = join(root, `${key}-preview`)
    const built = await bundle(dir, out)
    if (!built.ok) throw new Error(JSON.stringify(built.problems))
    expect(overBudget(await weigh(out, built.bundle))).toEqual([])
    expect(built.bundle.files.some((f) => f.path.startsWith(runtimeFolder))).toBe(false)
    if (!browser) return skip()

    const origin = 'https://k7f3q9f2xa.webpreview.store'
    const context = await browser.newContext()
    const errors: string[] = []
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== origin) return route.abort('blockedbyclient')
      if (url.pathname === '/shop-api') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shopFixture(snapshot, [])(route.request().postData() ?? '')) })
      const found = url.pathname.startsWith(`/${runtimeFolder}`) ? await fileFor([runtime], url.pathname.slice(runtimeFolder.length + 1)) : await fileFor([out], url.pathname)
      // The preview host serves index.html for any page that isn't a file (PREVIEW §5 step 4).
      const file = found ?? (/\.[a-z]+$/.test(url.pathname) ? null : await fileFor([out], '/index.html'))
      if (!file) return route.fulfill({ status: 404 })
      return route.fulfill({ status: 200, body: file.bytes, contentType: file.rel.endsWith('.css') ? 'text/css' : file.rel.endsWith('.js') ? 'text/javascript' : 'text/html' })
    })
    const open = async (path: string) => {
      const page: Page = await context.newPage()
      page.on('pageerror', (e) => errors.push(`${path}: ${e.message}`))
      await page.goto(`${origin}${path}`)
      await page.locator('main h1').first().waitFor()
      const seen = await page.evaluate(() => ({
        h1: [...document.querySelectorAll('h1')].map((h) => h.textContent?.trim() ?? ''),
        main: document.querySelectorAll('main').length,
        preview: document.querySelectorAll('[data-df-sealed="preview"]').length,
        consent: document.querySelectorAll('[data-df-sealed="consent"]').length,
        powered: document.querySelectorAll('[data-df-sealed="powered"]').length,
      }))
      await page.close()
      return seen
    }
    try {
      const missing = await open('/nowhere-at-all/')
      for (const { name, path } of addresses(readFileSync(join(dir, 'routes.json'), 'utf8'))) {
        const seen = await open(path)
        expect({ name, ...seen, h1: seen.h1.length }).toEqual({ name, h1: 1, main: 1, preview: 1, consent: 1, powered: 0 })
        if (name !== 'notFound') expect(seen.h1[0], `${name} renders its own page, not the 404`).not.toBe(missing.h1[0])
        expect(seen.h1[0]).not.toBe('')
      }
      expect(errors).toEqual([])
    } finally {
      await context.close()
    }
  })

  it.runIf(key === 'baseline')('opens its menu children on hover and focus, and closes them on Escape and when focus leaves', async ({ skip }) => {
    if (!browser) return skip()
    const out = join(root, `${key}-menu`)
    const built = await bundle(dir, out)
    if (!built.ok) throw new Error(JSON.stringify(built.problems))
    const origin = 'https://k7f3q9f2xa.webpreview.store'
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== origin) return route.abort('blockedbyclient')
      if (url.pathname === '/shop-api') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shopFixture(snapshot, [])(route.request().postData() ?? '')) })
      const found = url.pathname.startsWith(`/${runtimeFolder}`) ? await fileFor([runtime], url.pathname.slice(runtimeFolder.length + 1)) : await fileFor([out], url.pathname)
      const file = found ?? (/\.[a-z]+$/.test(url.pathname) ? null : await fileFor([out], '/index.html'))
      if (!file) return route.fulfill({ status: 404 })
      return route.fulfill({ status: 200, body: file.bytes, contentType: file.rel.endsWith('.css') ? 'text/css' : file.rel.endsWith('.js') ? 'text/javascript' : 'text/html' })
    })
    try {
      const page = await context.newPage()
      await page.goto(`${origin}/`)
      const toggle = page.getByRole('button', { name: /Women/ })
      const child = page.getByRole('link', { name: 'Dresses' })
      await toggle.waitFor()
      await expect(child.isVisible()).resolves.toBe(false)
      await page.getByRole('link', { name: 'Women' }).focus()
      await expect(child.isVisible()).resolves.toBe(true)
      await toggle.focus()
      await expect(child.isVisible()).resolves.toBe(true)
      await expect(toggle.getAttribute('aria-expanded')).resolves.toBe('true')
      await page.keyboard.press('Escape')
      await expect(child.isVisible()).resolves.toBe(false)
      await expect(toggle.getAttribute('aria-expanded')).resolves.toBe('false')
      await expect(toggle.evaluate((el) => el === document.activeElement)).resolves.toBe(true)
      await page.getByRole('link', { name: 'Women' }).focus()
      await page.getByRole('link', { name: 'Search' }).focus()
      await page.waitForTimeout(50)
      await expect(child.isVisible()).resolves.toBe(false)
      await page.mouse.move(0, 0)
      await page.getByRole('link', { name: 'Women' }).hover()
      await expect(child.isVisible()).resolves.toBe(true)
      await page.mouse.move(0, 0)
      await expect(child.isVisible()).resolves.toBe(false)
    } finally {
      await context.close()
    }
  })

  it('passes every check of the publish gate against the edge-case catalogue', async ({ skip }) => {
    if (!browser) return skip()
    const out = join(root, `${key}-site`)
    const theme = themeFiles(key)
    const repo = join(root, `${key}-repo`)
    cpSync(dir, repo, { recursive: true })
    const built = await buildSite({ repo, theme, snapshot, runtimeDir: runtime, out, work: join(root, `${key}-work`) })
    if (!built.ok) throw new Error(JSON.stringify(built.report))
    // A shared runner's clock can't gate a page, so the timings are fixed as publish.test.ts fixes them.
    const metrics = async (page: Page): Promise<LoadMetrics> => ({ ...(await browserMetrics(page)), lcp: 500, tbt: 20 })
    const { report } = await checkSite({ site: join(out, 'site'), out, live: null, snapshot, theme, strictLook: false, browser, metrics })
    expect(report.checks.filter((c) => !c.passed)).toEqual([])
    expect(report.passed).toBe(true)
  })
})
