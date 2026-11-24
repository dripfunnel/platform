import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Locator, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { coreRoutes, routeAddresses, themeRoutesSchema } from '@dripfunnel/storefront-core'
import { catalogueSnapshotSchema, gateWidths, pageBudgets, validateTheme, type CatalogueSnapshot, type GuardContext, type ThemeFile } from '@dripfunnel/storefront-core/guard'
import { bundle, runtimeFolder } from './gate/bundle'
import { overBudget, weigh } from './gate/budgets'
import { buildSite } from './publish/build'
import { browserMetrics, checkSite, type LoadMetrics } from './publish/check'
import { fileFor, shopFixture } from './publish/serve'
import { cartApi } from './test/cart'
import { buildRuntime } from './runtime/build'

// Card #486: every starting theme in templates/storefront/themes passes the validator, builds the preview bundle a new
// store's first preview is (PREVIEW §4) within the byte budgets, renders every route from it, and passes the publish gate.
vi.setConfig({ testTimeout: 600_000, hookTimeout: 120_000 })

const themesDir = fileURLToPath(new URL('../../../templates/storefront/themes/', import.meta.url))
// The category templates are built from baseline (#1537), so they run its baseline-only checks too.
const fromBaseline = ['baseline', 'beauty', 'electronics', 'fashion', 'grocery', 'home', 'jewelry']
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
    .map((path): ThemeFile => (path.startsWith('src/theme/media/') ? { path, content: readFileSync(join(themesDir, key, path)).toString('base64'), encoding: 'base64' } : { path, content: readFileSync(join(themesDir, key, path), 'utf8') }))

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

/** A page on the preview host whose shop answers `product` and whose files are the built `out` and the runtime. */
const openProduct = async (b: Browser, out: string, product: { slug: string }, width = 1440): Promise<Page> => {
  const origin = 'https://k7f3q9f2xa.webpreview.store'
  const context = await b.newContext({ viewport: { width, height: 900 } })
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) return route.abort('blockedbyclient')
    if (url.pathname === '/shop-api') {
      const body = route.request().postData() ?? ''
      const answer = /query Product\(/.test(body) ? { data: { product, store: { marketId: 'm1', markets: [{ id: 'm1', countries: ['IN'] }] } } } : shopFixture(snapshot, [])(body)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) })
    }
    const found = url.pathname.startsWith(`/${runtimeFolder}`) ? await fileFor([runtime], url.pathname.slice(runtimeFolder.length + 1)) : await fileFor([out], url.pathname)
    const file = found ?? (/\.[a-z]+$/.test(url.pathname) ? null : await fileFor([out], '/index.html'))
    if (!file) return route.fulfill({ status: 404 })
    return route.fulfill({ status: 200, body: file.bytes, contentType: file.rel.endsWith('.css') ? 'text/css' : file.rel.endsWith('.js') ? 'text/javascript' : 'text/html' })
  })
  const page = await context.newPage()
  await page.goto(`${origin}/products/${product.slug}/`)
  return page
}

type Choice = { id: string; name: string }
/** A product with these options, one version per row of `versions` (a value id for each option, whether it is in stock, how many). */
const productWith = (options: { id: string; name: string; values: Choice[] }[], versions: { values: string[]; inStock: boolean; available: number | null }[]) => {
  const money = { amount: '129900', currency: 'INR' }
  return {
    id: 'p1', name: 'Kit', slug: 'kit', description: null, highlights: [], inStock: versions.some((v) => v.inStock), price: money, compareAt: null, maxPrice: null, badges: [], photos: [], video: null,
    options: options.map((o) => ({ id: o.id, name: o.name, values: o.values })),
    versions: versions.map((v, i) => ({ id: `v${i}`, name: v.values.join(' / '), choices: options.map((o, n) => ({ optionId: o.id, valueId: v.values[n] ?? '' })), price: money, compareAt: null, inStock: v.inStock, available: v.available })),
    specs: [], faqs: [], compliance: [], returns: null, warranty: null, seoTitle: null, seoDescription: null, related: [],
  }
}

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
  expect(keys).toEqual(['baseline', 'beauty', 'classic', 'electronics', 'fashion', 'grocery', 'home', 'jewelry', 'market'])
  for (const key of keys) expect(templateSchema.parse(JSON.parse(readFileSync(join(themesDir, key, 'template.json'), 'utf8'))).key).toBe(key)
})

describe.each(keys)('the %s theme', (key) => {
  const dir = join(themesDir, key)

  it('passes the validator for an Indian and an American store, neither of whose details it repeats', async () => {
    expect((await validateTheme(themeFiles(key), india)).problems).toEqual([])
    expect((await validateTheme(themeFiles(key), unitedStates)).problems).toEqual([])
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

  it.runIf(fromBaseline.includes(key))('opens its menu children on hover and focus, and closes them on Escape and when focus leaves', async ({ skip }) => {
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

  it('shows a product’s description formatted under “Description”, always open, with no tags as text (#1216)', async ({ skip }) => {
    if (!browser) return skip()
    const out = join(root, `${key}-description`)
    const built = await bundle(dir, out)
    if (!built.ok) throw new Error(JSON.stringify(built.problems))
    const description =
      '<ul>\n<li><b>Material &amp; Construction:</b> 100% cotton</li>\n<li><b>Care:</b> Machine wash cold</li>\n</ul><p onclick="window.__clicked = 1">Read the <a href="https://example.com/care">care guide</a> or <a href="javascript:window.__pwned = 1">this</a>.</p><script>window.__pwned = 1</script>'
    const money = { amount: '129900', currency: 'INR' }
    const product = { id: 'p1', name: 'Linen shirt', slug: 'linen-shirt', description, highlights: [], inStock: true, price: money, compareAt: null, maxPrice: null, badges: [], photos: [], video: null, options: [], versions: [{ id: 'v1', name: null, choices: [], price: money, compareAt: null, inStock: true, available: 4 }], specs: [], faqs: [], compliance: [], returns: null, warranty: null, seoTitle: null, seoDescription: null, related: [] }
    const page = await openProduct(browser, out, product)
    try {
      await page.getByRole('heading', { name: 'Description' }).waitFor()
      const seen = await page.evaluate(() => {
        const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent?.trim() === 'Description')
        const section = heading?.closest('section')
        return {
          inDetails: heading?.closest('details') !== null,
          detailsHeading: [...document.querySelectorAll('summary')].some((s) => s.textContent?.trim() === 'Details'),
          labels: [...(section?.querySelectorAll('ul > li > strong') ?? [])].map((e) => e.textContent),
          text: section?.textContent ?? '',
          links: [...(section?.querySelectorAll('a') ?? [])].map((a) => [a.getAttribute('href'), a.getAttribute('rel')]),
          unsafe: section?.querySelectorAll('script, [onclick]').length ?? -1,
          pwned: '__pwned' in window,
        }
      })
      expect(seen).toMatchObject({ inDetails: false, detailsHeading: false, labels: ['Material & Construction:', 'Care:'], links: [['https://example.com/care', 'noopener nofollow']], unsafe: 0, pwned: false })
      expect(seen.text).not.toMatch(/<\/?[a-z]/i)
      expect(seen.text).toContain('100% cotton')
    } finally {
      await page.context().close()
    }
  })

  it('shows no stock line for a version whose stock isn’t tracked, and keeps it for one that is (#1278)', async ({ skip }) => {
    if (!browser) return skip()
    const out = join(root, `${key}-stock-line`)
    const built = await bundle(dir, out)
    if (!built.ok) throw new Error(JSON.stringify(built.problems))
    const size = { id: 'o1', name: 'Size', values: [{ id: 's', name: 'Small' }, { id: 'm', name: 'Medium' }, { id: 'l', name: 'Large' }] }
    const kit = productWith([size], [
      { values: ['s'], inStock: true, available: 5 },
      { values: ['m'], inStock: false, available: 0 },
      { values: ['l'], inStock: true, available: null },
    ])
    const stockLine = (page: Page) => page.getByText(/^(In stock|Sold out|Choose a Size to see stock)$/)
    const lines = async (page: Page) => (await stockLine(page).allTextContents()).map((s) => s.trim())
    const addable = async (page: Page) => ({
      add: await page.getByRole('button', { name: 'Add to cart' }).first().isDisabled(),
      buy: await page.getByRole('button', { name: 'Buy now' }).first().isDisabled(),
    })
    const page = await openProduct(browser, out, kit)
    try {
      const at = async (version: string) => {
        await page.goto(`https://k7f3q9f2xa.webpreview.store/products/kit/${version}/`)
        await page.getByRole('button', { name: 'Add to cart' }).first().waitFor()
      }
      await page.getByRole('button', { name: 'Add to cart' }).first().waitFor()
      expect(await lines(page)).toEqual(['Choose a Size to see stock'])
      await at('v0')
      expect(await lines(page)).toEqual(['In stock'])
      expect(await addable(page)).toEqual({ add: false, buy: false })
      await at('v1')
      expect(await lines(page)).toEqual(['Sold out'])
      expect((await addable(page)).add).toBe(true)
      await at('v2')
      expect(await lines(page)).toEqual([])
      expect(await addable(page)).toEqual({ add: false, buy: false })
      await expect(page.locator('p[role="status"]').filter({ hasText: /stock|Sold out/ }).count()).resolves.toBe(0)
    } finally {
      await page.context().close()
    }
    // A product with no options is one version: untracked, it says nothing; tracked, it says so.
    const single = (available: number | null) => productWith([], [{ values: [], inStock: available !== 0, available }])
    for (const [available, expected] of [[null, []], [4, ['In stock']], [0, ['Sold out']]] as const) {
      const alone = await openProduct(browser, out, single(available))
      try {
        await alone.getByRole('button', { name: 'Add to cart' }).first().waitFor()
        expect(await lines(alone)).toEqual(expected)
      } finally {
        await alone.context().close()
      }
    }
  })

  it('disables a choice that is out of stock with the other choices made, and says so (#1360)', async ({ skip }) => {
    if (!browser || key !== 'classic') return skip()
    const out = join(root, `${key}-choices`)
    const built = await bundle(dir, out)
    if (!built.ok) throw new Error(JSON.stringify(built.problems))
    const size = { id: 'o1', name: 'Size', values: [{ id: 'l', name: 'Large' }, { id: 'm', name: 'Medium' }, { id: 's', name: 'Small' }, { id: 'x', name: 'Huge' }] }
    const sizes = productWith([size], [
      { values: ['l'], inStock: true, available: 5 },
      { values: ['m'], inStock: false, available: 0 },
      { values: ['s'], inStock: false, available: 0 },
      { values: ['x'], inStock: true, available: null },
    ])
    const group = (page: Page, name: string) => page.getByRole('group', { name })
    const chosen = (page: Page, name: string) => group(page, name).locator('[aria-pressed="true"]').allTextContents()

    const wide = await openProduct(browser, out, sizes)
    try {
      await group(wide, 'Size').getByRole('button', { name: 'Large', exact: true }).click()
      const medium = group(wide, 'Size').getByRole('button', { name: 'Medium, out of stock' })
      await expect(medium.getAttribute('aria-disabled')).resolves.toBe('true')
      await expect(group(wide, 'Size').getByRole('button', { name: 'Huge', exact: true }).getAttribute('aria-disabled')).resolves.toBeNull()
      await medium.click({ force: true })
      await medium.focus()
      await wide.keyboard.press('Enter')
      await wide.keyboard.press('Space')
      await expect(chosen(wide, 'Size')).resolves.toEqual(['Large'])
      await wide.mouse.move(0, 0)
      await wide.keyboard.press('Shift+Tab')
      await wide.keyboard.press('Tab')
      await expect(medium.getByText('Out of stock').isVisible()).resolves.toBe(true)
      await wide.mouse.move(0, 0)
      await group(wide, 'Size').getByRole('button', { name: 'Large', exact: true }).focus()
      await expect(medium.getByText('Out of stock').isVisible()).resolves.toBe(false)
      await medium.hover()
      await expect(medium.getByText('Out of stock').isVisible()).resolves.toBe(true)
      await group(wide, 'Size').getByRole('button', { name: 'Huge', exact: true }).click()
      await expect(chosen(wide, 'Size')).resolves.toEqual(['Huge'])
    } finally {
      await wide.context().close()
    }

    const phone = await openProduct(browser, out, sizes, 390)
    try {
      await group(phone, 'Size').getByRole('button', { name: 'Large', exact: true }).click()
      const small = group(phone, 'Size').getByRole('button', { name: 'Small, out of stock' })
      await expect(small.getByText('Out of stock').isVisible()).resolves.toBe(true)
      await small.click({ force: true })
      await expect(chosen(phone, 'Size')).resolves.toEqual(['Large'])
    } finally {
      await phone.context().close()
    }

    const colour = { id: 'o2', name: 'Colour', values: [{ id: 'r', name: 'Red' }, { id: 'b', name: 'Blue' }] }
    const both = productWith([{ ...size, values: size.values.slice(0, 2) }, colour], [
      { values: ['l', 'r'], inStock: true, available: 3 },
      { values: ['l', 'b'], inStock: false, available: 0 },
      { values: ['m', 'r'], inStock: false, available: 0 },
      { values: ['m', 'b'], inStock: true, available: 3 },
    ])
    const two = await openProduct(browser, out, both)
    try {
      const disabled = async (name: string) => (await group(two, 'Colour').getByRole('button', { name }).getAttribute('aria-disabled')) === 'true'
      await group(two, 'Size').getByRole('button', { name: 'Large', exact: true }).click()
      await expect(disabled('Blue, out of stock')).resolves.toBe(true)
      await expect(group(two, 'Colour').getByRole('button', { name: 'Red', exact: true }).getAttribute('aria-disabled')).resolves.toBeNull()
      await group(two, 'Size').getByRole('button', { name: 'Medium', exact: true }).click()
      await expect(disabled('Red, out of stock')).resolves.toBe(true)
      await expect(group(two, 'Colour').getByRole('button', { name: 'Blue', exact: true }).getAttribute('aria-disabled')).resolves.toBeNull()
    } finally {
      await two.context().close()
    }

    const gone = await openProduct(browser, out, productWith([{ ...size, values: size.values.slice(0, 2) }], [
      { values: ['l'], inStock: false, available: 0 },
      { values: ['m'], inStock: false, available: 0 },
    ]))
    try {
      await gone.goto(`${gone.url()}v0/`)
      await group(gone, 'Size').getByRole('button', { name: 'Large, out of stock' }).waitFor()
      await expect(group(gone, 'Size').locator('button:not([aria-disabled="true"])').count()).resolves.toBe(0)
      await expect(gone.getByText('Sold out').first().isVisible()).resolves.toBe(true)
    } finally {
      await gone.context().close()
    }
  })

  it.runIf(key === 'classic')('shows a product’s published A+ modules in a “More about this product” section in their order, between its details and “You may also like”, and no section without any (#1351)', async ({ skip }) => {
    if (!browser) return skip()
    const out = join(root, `${key}-aplus`)
    const built = await bundle(dir, out)
    if (!built.ok) throw new Error(JSON.stringify(built.problems))
    const origin = 'https://k7f3q9f2xa.webpreview.store'
    const money = { amount: '129900', currency: 'INR' }
    const picture = (name: string, alt: string) => ({ alt, image: { url: `${origin}/shop-api/assets/${name}` } })
    const module = (fields: Record<string, unknown>) => ({ title: null, body: null, side: null, photo: null, photos: null, items: null, products: null, block: null, video: null, ...fields })
    const story = [
      module({ id: 'm1', kind: 'banner', title: 'Made to be lived in', photo: picture('banner', 'A shirt on a line') }),
      module({ id: 'm2', kind: 'features', items: [{ title: 'Pre-washed', text: 'No shrinking.', photo: null }, { title: 'Organic', text: null, photo: null }] }),
      module({ id: 'm3', kind: 'imageText', title: 'The fabric', body: 'Heavyweight linen.', side: 'right', photo: picture('fabric', 'Close-up of the linen') }),
      module({ id: 'm4', kind: 'faq' }),
    ]
    const related = { id: 'p2', name: 'Linen trousers', slug: 'linen-trousers', productType: 'physical', inStock: true, price: money, compareAt: null, maxPrice: null, photo: null, badges: [] }
    const product = (slug: string, withStory: boolean) => ({ id: slug, name: `Linen ${slug}`, slug, description: null, highlights: [], inStock: true, price: money, compareAt: null, maxPrice: null, badges: [], photos: [], video: null, options: [], versions: [{ id: `${slug}-v`, name: null, choices: [], price: money, compareAt: null, inStock: true, available: 4 }], specs: [], faqs: [{ question: 'Does it crease?', answer: 'A little.' }], compliance: [], returns: null, warranty: null, seoTitle: null, seoDescription: null, related: [related], ...(withStory ? { story, storyTemplate: null } : {}) })
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== origin) return route.abort('blockedbyclient')
      if (url.pathname === '/shop-api') {
        const body = route.request().postData() ?? ''
        const slug = /"slug":"([^"]+)"/.exec(body)?.[1] ?? ''
        const answer = /query Product\(/.test(body) ? { data: { product: product(slug, slug === 'linen-shirt'), store: { marketId: 'm1', markets: [{ id: 'm1', countries: ['IN'] }] } } } : shopFixture(snapshot, [])(body)
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) })
      }
      const found = url.pathname.startsWith(`/${runtimeFolder}`) ? await fileFor([runtime], url.pathname.slice(runtimeFolder.length + 1)) : await fileFor([out], url.pathname)
      const file = found ?? (/\.[a-z]+$/.test(url.pathname) ? null : await fileFor([out], '/index.html'))
      if (!file) return route.fulfill({ status: 404 })
      return route.fulfill({ status: 200, body: file.bytes, contentType: file.rel.endsWith('.css') ? 'text/css' : file.rel.endsWith('.js') ? 'text/javascript' : 'text/html' })
    })
    try {
      const page = await context.newPage()
      await page.goto(`${origin}/products/linen-shirt/`)
      await page.getByRole('region', { name: 'More about this product' }).waitFor()
      const seen = await page.evaluate(() => {
        const section = document.querySelector('section[aria-label="More about this product"]')
        const title = document.querySelector('main h1')
        const related = [...document.querySelectorAll('h2')].find((h) => h.textContent?.trim() === 'You may also like')
        const after = (a: Node | null | undefined, b: Node | null | undefined) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
        return {
          headings: [...(section?.querySelectorAll('h2') ?? [])].map((h) => h.textContent?.trim()),
          alts: [...(section?.querySelectorAll('img') ?? [])].map((i) => i.getAttribute('alt')),
          belowDetails: after(title, section),
          aboveRelated: after(section, related),
          visible: !!section && section.getBoundingClientRect().height > 0,
        }
      })
      expect(seen).toEqual({ headings: ['Made to be lived in', 'Highlights', 'The fabric', 'Questions'], alts: ['A shirt on a line', 'Close-up of the linen'], belowDetails: true, aboveRelated: true, visible: true })
      await page.goto(`${origin}/products/linen-shirt-two/`)
      await page.locator('main h1').first().waitFor()
      await expect(page.locator('section[aria-label="More about this product"]').count()).resolves.toBe(0)
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

  let stillSite: Promise<string> | null = null
  const builtStill = () =>
    (stillSite ??= (async () => {
      const out = join(root, `${key}-still`)
      const repo = join(root, `${key}-still-repo`)
      cpSync(dir, repo, { recursive: true })
      const built = await buildSite({ repo, theme: themeFiles(key), snapshot, runtimeDir: runtime, out, work: join(root, `${key}-still-work`) })
      if (!built.ok) throw new Error(JSON.stringify(built.report))
      return join(out, 'site')
    })())

  /** How far `path` shifts at phone width; `holdScripts` paints the static page before hydration, as a slow phone does. */
  const shiftOf = async (b: Browser, path: string, holdScripts: boolean): Promise<number> => {
    const site = await builtStill()
    const origin = 'https://shop.northstar.example'
    const context = await b.newContext({ viewport: { width: gateWidths[0], height: 900 }, isMobile: true, hasTouch: true })
    await context.addInitScript(() => {
      const m = { cls: 0 }
      Object.defineProperty(window, '__dfShift', { value: m })
      new PerformanceObserver((l) => l.getEntries().forEach((e) => (m.cls += (e as PerformanceEntry & { value?: number }).value ?? 0))).observe({ type: 'layout-shift', buffered: true })
    })
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== origin) return route.abort('blockedbyclient')
      if (url.pathname === '/shop-api') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shopFixture(snapshot, [])(route.request().postData() ?? '')) })
      const file = (await fileFor([site], url.pathname)) ?? (/\.[a-z0-9]+$/.test(url.pathname) ? null : await fileFor([site], '/index.html'))
      if (!file) return route.fulfill({ status: 404 })
      const type = file.rel.endsWith('.css') ? 'text/css' : file.rel.endsWith('.js') ? 'text/javascript' : file.rel.endsWith('.html') ? 'text/html' : null
      if (holdScripts && type === 'text/javascript') await new Promise((done) => setTimeout(done, 1500))
      return route.fulfill({ status: 200, body: file.bytes, ...(type ? { contentType: type } : {}) })
    })
    try {
      const page = await context.newPage()
      await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1000)
      return (await page.evaluate('window.__dfShift.cls')) as number
    } finally {
      await context.close()
    }
  }

  // #713: unthrottled, the page paints its loading state before the offline Shop API answers, as on a fast runner.
  it('keeps the home page still when the Shop API answers nothing', async ({ skip }) => {
    if (!browser) return skip()
    expect(await shiftOf(browser, '/', false)).toBeLessThan(pageBudgets.cls)
  })

  // The static cart page is its loading state; a visitor with no cart sees it swapped for the empty cart once scripts run.
  it('keeps the cart page still for a visitor with no cart, however late its scripts arrive', async ({ skip }) => {
    if (!browser) return skip()
    expect(await shiftOf(browser, '/cart/', true)).toBeLessThan(pageBudgets.cls)
  })

  // #1680: a code held in the cart that stops applying (here, under two items) is no longer announced as applied, nor again until Apply is pressed.
  it('stops saying a code is applied once the cart no longer qualifies, also when the quantity goes back up (#1680)', async ({ skip }) => {
    const out = join(root, `${key}-code-note`)
    const built = await bundle(dir, out)
    if (!built.ok) throw new Error(JSON.stringify(built.problems))
    if (!browser) return skip()
    const origin = 'https://k7f3q9f2xa.webpreview.store'
    const api = cartApi([{ versionId: 'a', quantity: 2, problem: null, available: 5 }])
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.addInitScript(() => {
      localStorage.setItem('df-cart', 'tok')
      localStorage.setItem('df-consent-v1', JSON.stringify({ analytics: false, marketing: false, at: '2026-01-01T00:00:00.000Z' }))
    })
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== origin) return route.abort('blockedbyclient')
      if (url.pathname === '/shop-api') {
        const body = route.request().postData() ?? ''
        const asked = JSON.parse(body) as { query: string; variables?: Record<string, unknown> }
        const cart = /^query Cart|setCartQuantity|applyCode/.test(asked.query)
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cart ? api.answer({ query: asked.query, variables: asked.variables ?? {}, headers: {} }) : shopFixture(snapshot, [])(body)) })
      }
      const found = url.pathname.startsWith(`/${runtimeFolder}`) ? await fileFor([runtime], url.pathname.slice(runtimeFolder.length + 1)) : await fileFor([out], url.pathname)
      const file = found ?? (/\.[a-z]+$/.test(url.pathname) ? null : await fileFor([out], '/index.html'))
      if (!file) return route.fulfill({ status: 404 })
      return route.fulfill({ status: 200, body: file.bytes, contentType: file.rel.endsWith('.css') ? 'text/css' : file.rel.endsWith('.js') ? 'text/javascript' : 'text/html' })
    })
    try {
      const page = await context.newPage()
      await page.goto(`${origin}/cart/`)
      const quantity = () => page.getByRole('group', { name: 'Quantity of Tee a' }).textContent()
      const applied = page.getByText('Code applied.')
      await page.getByLabel('Discount code').fill('AUTUMN')
      await page.getByRole('button', { name: 'Apply' }).click()
      await applied.waitFor()
      await page.getByRole('button', { name: 'One fewer' }).click()
      await expect.poll(quantity).toContain('1')
      expect(await applied.count()).toBe(0)
      expect(await page.getByRole('button', { name: 'Remove the code AUTUMN' }).count()).toBe(1)
      await page.getByRole('button', { name: 'One more' }).click()
      await expect.poll(quantity).toContain('2')
      expect(await applied.count()).toBe(0)
    } finally {
      await context.close()
    }
  })
})

type AccountState = { phone: string | null; verified: boolean; takesMobile: boolean; refuseCode: boolean; offline: boolean; sentTo: string[] }

/** The signed-in account page (live mode, as a built page carries it in `df-page`), its shop answering from `state`. */
const openAccount = async (b: Browser, out: string, state: AccountState, width = 1440): Promise<Page> => {
  const origin = 'https://k7f3q9f2xa.webpreview.store'
  const context = await b.newContext({ viewport: { width, height: 900 } })
  await context.addInitScript(() => sessionStorage.setItem('df-session', 'sess-1'))
  const live = JSON.stringify({ route: 'account', custom: null, path: '/account/', store: snapshot.store, poweredBy: null }).replaceAll('<', '\\u003c')
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) return route.abort('blockedbyclient')
    if (url.pathname === '/shop-api') {
      if (state.offline) return route.abort('failed')
      const body = route.request().postData() ?? ''
      const asked = JSON.parse(body) as { query: string; variables?: { to?: string } }
      const answer = /query Account\b/.test(asked.query)
        ? { data: { account: { id: 'cu-1', name: 'Asha Rao', email: 'asha@example.com', phone: state.phone, emailVerified: true, phoneVerified: state.verified, addresses: [] }, store: { markets: [] }, signInOptions: { phone: state.takesMobile } } }
        : asked.query.includes('requestPhoneCode')
          ? (state.sentTo.push(asked.variables?.to ?? ''), { data: { requestPhoneCode: true } })
          : asked.query.includes('confirmPhone')
            ? state.refuseCode
              ? { errors: [{ message: 'no', extensions: { code: 'CODE_REFUSED' } }] }
              : ((state.phone = asked.variables?.to ?? null), (state.verified = true), { data: { confirmPhone: true } })
            : shopFixture(snapshot, [])(body)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) })
    }
    const found = url.pathname.startsWith(`/${runtimeFolder}`) ? await fileFor([runtime], url.pathname.slice(runtimeFolder.length + 1)) : await fileFor([out], url.pathname)
    const file = found ?? (/\.[a-z]+$/.test(url.pathname) ? null : await fileFor([out], '/index.html'))
    if (!file) return route.fulfill({ status: 404 })
    if (file.rel.endsWith('.html')) return route.fulfill({ status: 200, contentType: 'text/html', body: Buffer.from(file.bytes).toString('utf8').replace(/<body[^>]*>/, (m) => `${m}<script id="df-page" type="application/json">${live}</script>`) })
    return route.fulfill({ status: 200, body: file.bytes, contentType: file.rel.endsWith('.css') ? 'text/css' : file.rel.endsWith('.js') ? 'text/javascript' : 'text/html' })
  })
  const page = await context.newPage()
  await page.goto(`${origin}/account/`)
  await page.getByRole('heading', { name: 'Your details' }).waitFor()
  return page
}

// Card #1404: Account › Your details lets a shopper add or change their mobile number, proved by a text code.
describe.each(['classic', ...fromBaseline])('the %s theme’s account, mobile number', (key) => {
  let out = ''
  const fresh = (over: Partial<AccountState> = {}): AccountState => ({ phone: null, verified: false, takesMobile: true, refuseCode: false, offline: false, sentTo: [], ...over })
  const mobileRow = (page: Page) => page.locator('dl > div').filter({ has: page.locator('dt', { hasText: 'Mobile number' }) })

  beforeAll(async () => {
    if (!browser) return
    out = join(root, `${key}-account`)
    const built = await bundle(join(themesDir, key), out)
    if (!built.ok) throw new Error(JSON.stringify(built.problems))
  })

  it('adds a number: Add beside “Not given”, the number, the texted code, then the number with Verified', async ({ skip }) => {
    if (!browser) return skip()
    const state = fresh()
    const page = await openAccount(browser, out, state)
    try {
      const row = mobileRow(page)
      await expect(row.textContent()).resolves.toContain('Not given')
      await expect(row.getByText('Used to sign in with a text code and for delivery updates.').isVisible()).resolves.toBe(true)
      await row.getByRole('button', { name: 'Add' }).click()
      await expect(page.getByText('We\'ll text a code to the new number.').isVisible()).resolves.toBe(true)
      await page.getByLabel('Mobile number').fill('98450 22113')
      await page.getByRole('button', { name: 'Send code' }).click()
      await page.getByText(/Enter the code we sent to/).waitFor()
      expect(state.sentTo).toEqual(['+919845022113'])
      await page.getByLabel('6-digit code').fill('123456')
      await page.getByRole('button', { name: 'Save number' }).click()
      await row.getByText('Verified').waitFor()
      await expect(row.textContent()).resolves.toContain('+919845022113')
      await expect(row.getByRole('button', { name: 'Change' }).isVisible()).resolves.toBe(true)
      await expect(page.getByText('Your mobile number is saved.').count()).resolves.toBe(1)
    } finally {
      await page.context().close()
    }
  })

  it('keeps focus with the shopper at every step, by keyboard: each field as it opens, back to Add on Cancel, and to Change once the number is saved', async ({ skip }) => {
    if (!browser) return skip()
    const page = await openAccount(browser, out, fresh())
    const focused = (target: Locator) => target.evaluate((el) => el === document.activeElement)
    try {
      const row = mobileRow(page)
      const number = page.getByLabel('Mobile number')
      const code = page.getByLabel('6-digit code')
      const add = row.getByRole('button', { name: 'Add' })
      await add.focus()
      await page.keyboard.press('Enter')
      await number.waitFor()
      await expect.poll(() => focused(number)).toBe(true)
      await page.keyboard.type('9845022113')
      await page.keyboard.press('Enter')
      await code.waitFor()
      await expect.poll(() => focused(code)).toBe(true)
      await page.getByRole('button', { name: 'Use another number' }).click()
      await expect.poll(() => focused(number)).toBe(true)
      await page.getByRole('button', { name: 'Cancel' }).click()
      await expect.poll(() => focused(add)).toBe(true)
      await page.keyboard.press('Enter')
      await number.waitFor()
      await page.keyboard.type('9845022113')
      await page.keyboard.press('Enter')
      await code.waitFor()
      await page.keyboard.type('123456')
      await page.keyboard.press('Enter')
      const change = row.getByRole('button', { name: 'Change' })
      await change.waitFor()
      await expect.poll(() => focused(change)).toBe(true)
    } finally {
      await page.context().close()
    }
  })

  it('changes a number: Change, and the old number stays on screen until the new one is proved', async ({ skip }) => {
    if (!browser) return skip()
    const state = fresh({ phone: '+919811100001', verified: true })
    const page = await openAccount(browser, out, state)
    try {
      const row = mobileRow(page)
      await expect(row.getByRole('button', { name: 'Add' }).count()).resolves.toBe(0)
      await row.getByRole('button', { name: 'Change' }).click()
      await page.getByLabel('Mobile number').fill('98550 00005')
      await page.getByRole('button', { name: 'Send code' }).click()
      await page.getByLabel('6-digit code').waitFor()
      await expect(row.textContent()).resolves.toContain('+919811100001')
      await page.getByLabel('6-digit code').fill('123456')
      await page.getByRole('button', { name: 'Save number' }).click()
      await row.getByRole('button', { name: 'Change' }).waitFor()
      await expect(row.textContent()).resolves.toContain('+919855000005')
      await expect(row.textContent()).resolves.not.toContain('+919811100001')
    } finally {
      await page.context().close()
    }
  })

  it('says what went wrong and changes nothing: a number to check, a shop that can’t be reached, a refused code', async ({ skip }) => {
    if (!browser) return skip()
    const state = fresh({ refuseCode: true })
    const page = await openAccount(browser, out, state)
    try {
      const row = mobileRow(page)
      await row.getByRole('button', { name: 'Add' }).click()
      await page.getByRole('button', { name: 'Send code' }).click()
      await expect(page.getByRole('alert').first().isVisible()).resolves.toBe(true)
      expect(state.sentTo).toEqual([])
      await page.getByLabel('Mobile number').fill('98450 22113')
      state.offline = true
      await page.getByRole('button', { name: 'Send code' }).click()
      await page.getByText(/couldn.t reach the shop/).waitFor()
      state.offline = false
      await page.getByRole('button', { name: 'Send code' }).click()
      await page.getByLabel('6-digit code').fill('123456')
      await page.getByRole('button', { name: 'Save number' }).click()
      await page.getByText(/That code didn.t work/).waitFor()
      await expect(page.getByLabel('6-digit code').isVisible()).resolves.toBe(true)
      await expect(row.textContent()).resolves.toContain('Not given')
      await page.getByRole('button', { name: 'Use another number' }).click()
      await expect(page.getByLabel('Mobile number').isVisible()).resolves.toBe(true)
      await page.getByRole('button', { name: 'Cancel' }).click()
      await expect(row.getByRole('button', { name: 'Add' }).isVisible()).resolves.toBe(true)
    } finally {
      await page.context().close()
    }
  })

  it('offers no Add or Change in a shop that takes no mobile sign-in', async ({ skip }) => {
    if (!browser) return skip()
    const page = await openAccount(browser, out, fresh({ takesMobile: false }))
    try {
      const row = mobileRow(page)
      await expect(row.textContent()).resolves.toContain('Not given')
      await expect(row.getByRole('button').count()).resolves.toBe(0)
    } finally {
      await page.context().close()
    }
  })

  it.each([390, 1440])('fits the screen at %i px, with the number field and the code field open', async (width) => {
    if (!browser) return
    const page = await openAccount(browser, out, fresh(), width)
    try {
      const row = mobileRow(page)
      await row.getByRole('button', { name: 'Add' }).click()
      await page.getByLabel('Mobile number').fill('98450 22113')
      await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
      await page.getByRole('button', { name: 'Send code' }).click()
      await page.getByLabel('6-digit code').waitFor()
      await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
    } finally {
      await page.context().close()
    }
  })
})

type ListState = { asked: string[]; failNext: boolean }

/** A signed-in live page at `path` (its `route`), the shop answering the account, 45 orders (pages of 20) and 30 posts (pages of 12). */
const openScrollList = async (b: Browser, out: string, route: 'accountOrders' | 'blog', path: string, state: ListState, width = 1440, height = 600): Promise<Page> => {
  const origin = 'https://k7f3q9f2xa.webpreview.store'
  const context = await b.newContext({ viewport: { width, height } })
  await context.addInitScript(() => sessionStorage.setItem('df-session', 'sess-1'))
  const live = JSON.stringify({ route, custom: null, path, store: snapshot.store, poweredBy: null }).replaceAll('<', '\\u003c')
  const order = (n: number) => ({ id: `o-${n}`, number: `${1000 + n}`, state: 'placed', paymentState: 'paid', paymentMethod: 'stripe', placedAt: '2026-10-13T06:00:00Z', pricesIncludeTax: false, itemCount: 2, total: { amount: '5440', currency: 'USD' } })
  const post = (n: number) => ({ title: `Post ${n}`, path: `/blog/post-${n}`, slug: `post-${n}`, author: 'Maya', publishedAt: '2026-10-01T10:00:00Z', tags: [], seoTitle: null, seoDescription: null, cover: null, body: [{ kind: 'text', text: 'word '.repeat(40), alt: null, image: null, items: null, productSlugs: null }] })
  const pageOf = (total: number, size: number, after: string | null, make: (n: number) => unknown) => {
    const from = after === null ? 0 : Number(after)
    const to = Math.min(from + size, total)
    return { nodes: Array.from({ length: to - from }, (_, i) => make(from + i)), pageInfo: { hasNextPage: to < total, endCursor: String(to) } }
  }
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) return route.abort('blockedbyclient')
    if (url.pathname === '/shop-api') {
      const body = route.request().postData() ?? ''
      const asked = JSON.parse(body) as { query: string; variables?: { after?: string | null } }
      const after = asked.variables?.after ?? null
      const list = /query (OrderHistory|Blog)\b/.exec(asked.query)?.[1]
      if (list && after !== null) {
        state.asked.push(`${list}:${after}`)
        if (state.failNext) {
          state.failNext = false
          return route.abort('failed')
        }
      }
      const answer = /query Account\b/.test(asked.query)
        ? { data: { account: { id: 'cu-1', name: 'Asha Rao', email: 'asha@example.com', phone: null, emailVerified: true, phoneVerified: false, addresses: [] }, store: { markets: [] }, signInOptions: { phone: false } } }
        : list === 'OrderHistory'
          ? { data: { orderHistory: pageOf(45, 20, after, order) } }
          : list === 'Blog'
            ? { data: { blogPosts: pageOf(30, 12, after, post) } }
            : shopFixture(snapshot, [])(body)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) })
    }
    const found = url.pathname.startsWith(`/${runtimeFolder}`) ? await fileFor([runtime], url.pathname.slice(runtimeFolder.length + 1)) : await fileFor([out], url.pathname)
    const file = found ?? (/\.[a-z]+$/.test(url.pathname) ? null : await fileFor([out], '/index.html'))
    if (!file) return route.fulfill({ status: 404 })
    if (file.rel.endsWith('.html')) return route.fulfill({ status: 200, contentType: 'text/html', body: Buffer.from(file.bytes).toString('utf8').replace(/<body[^>]*>/, (m) => `${m}<script id="df-page" type="application/json">${live}</script>`) })
    return route.fulfill({ status: 200, body: file.bytes, contentType: file.rel.endsWith('.css') ? 'text/css' : file.rel.endsWith('.js') ? 'text/javascript' : 'text/html' })
  })
  const page = await context.newPage()
  await page.goto(`${origin}${path}`)
  return page
}

// Card #1570: Account › Orders and the Blog load their next page by themselves, as the product grids do, with no Load more.
describe.each(['classic', ...fromBaseline])('the %s theme’s lists on the live site', (key) => {
  let out = ''
  const lists = [
    { name: 'Account › Orders', route: 'accountOrders' as const, path: '/account/orders/', item: 'a[href^="/account/orders/o-"]', first: 20, all: 45, noun: 'orders', failed: "We couldn't load more orders. Try again." },
    { name: 'the Blog', route: 'blog' as const, path: '/blog/', item: 'a[href^="/blog/post-"]', first: 12, all: 30, noun: 'posts', failed: "We couldn't load older posts. Try again." },
  ]
  const fresh = (): ListState => ({ asked: [], failNext: false })

  beforeAll(async () => {
    if (!browser) return
    out = join(root, `${key}-lists`)
    const built = await bundle(join(themesDir, key), out)
    if (!built.ok) throw new Error(JSON.stringify(built.problems))
  })

  describe.each(lists)('$name', (list) => {
    const items = (page: Page) => page.locator(list.item)
    const noButton = (page: Page) => expect(page.getByRole('button', { name: /load more|older posts/i }).count()).resolves.toBe(0)

    it('loads the next page before the shopper reaches the end, with no Load more button, and stops at the end', async ({ skip }) => {
      if (!browser) return skip()
      const state = fresh()
      const page = await openScrollList(browser, out, list.route, list.path, state)
      try {
        await items(page).nth(list.first - 1).waitFor()
        await expect(items(page).count()).resolves.toBe(list.first)
        await noButton(page)
        expect(state.asked).toEqual([])
        // Scroll until the last row is still a hundred pixels below the screen: the end has not been reached.
        await items(page).last().evaluate((el) => window.scrollTo(0, Math.max(0, el.getBoundingClientRect().bottom + window.scrollY - window.innerHeight - 100)))
        await expect.poll(() => items(page).count()).toBeGreaterThan(list.first)
        await noButton(page)
        // Keeps scrolling while it waits, so a slow last page on CI is still asked for and awaited (#1637).
        await expect
          .poll(
            async () => {
              await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
              return items(page).count()
            },
            { timeout: 15_000, interval: 300 },
          )
          .toBe(list.all)
        const asked = state.asked.length
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await page.waitForTimeout(500)
        expect(state.asked.length).toBe(asked)
        await expect(page.getByText(/Loading more/).count()).resolves.toBe(0)
        await noButton(page)
      } finally {
        await page.context().close()
      }
    })

    it('says so when a page does not load, keeps what is shown, and Try again is the only button', async ({ skip }) => {
      if (!browser) return skip()
      const state = fresh()
      state.failNext = true
      const page = await openScrollList(browser, out, list.route, list.path, state)
      try {
        await items(page).nth(list.first - 1).waitFor()
        await items(page).last().evaluate((el) => window.scrollTo(0, Math.max(0, el.getBoundingClientRect().bottom + window.scrollY - window.innerHeight - 100)))
        await page.getByRole('alert').filter({ hasText: list.failed }).waitFor()
        await expect(items(page).count()).resolves.toBe(list.first)
        const buttons = page.getByRole('button')
        await expect(buttons.filter({ hasText: 'Try again' }).count()).resolves.toBe(1)
        await noButton(page)
        // A failed page does not retry by itself.
        const asked = state.asked.length
        await page.waitForTimeout(500)
        expect(state.asked.length).toBe(asked)
        await page.getByRole('button', { name: 'Try again' }).click()
        await expect.poll(() => items(page).count()).toBeGreaterThan(list.first)
        await expect(page.getByRole('alert').filter({ hasText: list.failed }).count()).resolves.toBe(0)
      } finally {
        await page.context().close()
      }
    })

    it('loads the next page when the keyboard reaches the last items, and announces the number shown', async ({ skip }) => {
      if (!browser) return skip()
      const state = fresh()
      const page = await openScrollList(browser, out, list.route, list.path, state)
      try {
        await items(page).nth(list.first - 1).waitFor()
        await expect(page.getByRole('status').filter({ hasText: `Showing ${list.first} ${list.noun}` }).count()).resolves.toBe(1)
        await items(page).last().focus()
        await expect.poll(() => items(page).count()).toBeGreaterThan(list.first)
        const shown = await items(page).count()
        await expect(page.getByRole('status').filter({ hasText: `Showing ${shown} ${list.noun}` }).count()).resolves.toBe(1)
        await noButton(page)
      } finally {
        await page.context().close()
      }
    })
  })
})

type Ways = { email: boolean; phone: boolean }

/** A signed-out live page at `path` (its `route`), the shop saying which sign-in ways the store has turned on and taking any code. */
const openSignIn = async (b: Browser, out: string, route: 'register' | 'signIn' | 'forgotPassword', path: string, ways: Ways): Promise<Page> => {
  const origin = 'https://k7f3q9f2xa.webpreview.store'
  const context = await b.newContext({ viewport: { width: 1440, height: 900 } })
  const live = JSON.stringify({ route, custom: null, path, store: snapshot.store, poweredBy: null }).replaceAll('<', '\u003c')
  await context.route('**/*', async (r) => {
    const url = new URL(r.request().url())
    if (url.origin !== origin) return r.abort('blockedbyclient')
    if (url.pathname === '/shop-api') {
      const body = r.request().postData() ?? ''
      const asked = JSON.parse(body) as { query: string }
      const answer = asked.query.includes('signInOptions') ? { data: { signInOptions: ways } } : asked.query.includes('requestSignInCode') ? { data: { requestSignInCode: true } } : shopFixture(snapshot, [])(body)
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) })
    }
    const found = url.pathname.startsWith(`/${runtimeFolder}`) ? await fileFor([runtime], url.pathname.slice(runtimeFolder.length + 1)) : await fileFor([out], url.pathname)
    const file = found ?? (/\.[a-z]+$/.test(url.pathname) ? null : await fileFor([out], '/index.html'))
    if (!file) return r.fulfill({ status: 404 })
    if (file.rel.endsWith('.html')) return r.fulfill({ status: 200, contentType: 'text/html', body: Buffer.from(file.bytes).toString('utf8').replace(/<body[^>]*>/, (m) => `${m}<script id="df-page" type="application/json">${live}</script>`) })
    return r.fulfill({ status: 200, body: file.bytes, contentType: file.rel.endsWith('.css') ? 'text/css' : file.rel.endsWith('.js') ? 'text/javascript' : 'text/html' })
  })
  const page = await context.newPage()
  await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' })
  return page
}

// Card #1566: the link under the code box follows the store's sign-in setting, on Create an account, Sign in and Forgot password.
// Only Classic offers a code to a number on Create an account; the other starting themes offer it on Sign in alone.
describe.each(['classic', ...fromBaseline])('the %s theme’s "use another" link on the live site', (key) => {
  let out = ''
  beforeAll(async () => {
    if (!browser) return
    out = join(root, `${key}-sign-in`)
    const built = await bundle(join(themesDir, key), out)
    if (!built.ok) throw new Error(JSON.stringify(built.problems))
  })

  const cases = [
    { name: 'Create an account, email only', route: 'register', path: '/register/', ways: { email: true, phone: false }, link: 'Use another email' },
    { name: 'Create an account, mobile only', route: 'register', path: '/register/', ways: { email: false, phone: true }, link: 'Use another number', classicOnly: true },
    { name: 'Create an account, both, by email', route: 'register', path: '/register/', ways: { email: true, phone: true }, link: 'Use another email or number' },
    { name: 'Sign in, mobile only', route: 'signIn', path: '/sign-in/', ways: { email: false, phone: true }, link: 'Use another number' },
    { name: 'Sign in, both, by number', route: 'signIn', path: '/sign-in/', ways: { email: true, phone: true }, link: 'Use another email or number', byNumber: true },
    { name: 'Forgot password, email only', route: 'forgotPassword', path: '/forgot-password/', ways: { email: true, phone: false }, link: 'Use another email' },
  ] as const

  it.each(cases)('reads "$link" on $name, and the link goes back to the form', async (c) => {
    if ('classicOnly' in c && key !== 'classic') return
    if (!browser) return
    const page = await openSignIn(browser, out, c.route, c.path, c.ways)
    try {
      if ('byNumber' in c) await page.getByRole('button', { name: 'Mobile number' }).click()
      const name = page.getByLabel('Full name')
      if (await name.count()) await name.fill('Asha Rao')
      if (c.ways.email && !('byNumber' in c)) await page.getByLabel('Email', { exact: true }).fill('asha@example.com')
      else await page.locator('input[type="tel"]').fill('9845022113')
      const password = page.getByLabel('Password', { exact: true })
      if (await password.count()) await password.fill('a long password 1')
      await page.getByRole('button', { name: /^(Email|Text) me a code$/ }).click()
      const link = page.getByRole('button', { name: c.link, exact: true })
      await link.waitFor()
      await link.click()
      await page.getByRole('button', { name: /^(Email|Text) me a code$/ }).waitFor()
    } finally {
      await page.context().close()
    }
  })
})
