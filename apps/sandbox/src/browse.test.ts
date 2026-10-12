import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { bundle, runtimeFolder } from './gate/bundle'
import { fileFor } from './publish/serve'
import { buildRuntime } from './runtime/build'

// Card #307: a seeded store browses the baseline theme's pages in preview mode, each from a deep link, with core's
// browse hooks against a Shop API that answers as the real one does (apps/api/schema/shop.graphql).
vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 })

const baseline = fileURLToPath(new URL('../../../templates/storefront/themes/baseline/', import.meta.url))
const chrome = [process.env['CHROME_PATH'], '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p): p is string => p !== undefined && existsSync(p))
if (!chrome && process.env['CI']) throw new Error('The browse tests need Chromium in CI; set CHROME_PATH.')

const origin = 'https://k7f3q9f2xa.webpreview.store'
const usd = (cents: number) => ({ amount: String(cents), currency: 'USD' })
const photo = (name: string) => ({ alt: name, versionId: null, image: { url: `${origin}/media/${name.toLowerCase().replace(/\W+/g, '-')}.svg` } })

const store = { name: 'Juniper & Co.', description: 'Everyday clothes and home goods, made to last.', language: 'en', mainLanguage: 'en', languages: ['en'], currency: 'USD', pricingCurrency: 'USD', currencies: [{ code: 'USD' }], pricesIncludeTax: false, timeZone: 'America/New_York', contactEmail: 'hello@juniper.example', contactPhone: '+1 614 555 0142', logo: null, address: { street: 'Oak Street', city: 'Columbus', region: 'OH', postal: '43215', country: 'US' } }
const summaries = ['Organic Cotton Tee', 'Mara Linen Shirt', 'Block-print Kurta', 'Silk Scarf', 'Linen Midi Dress', 'Wool Throw', 'Stoneware Mug'].map((name, i) => ({
  id: `p${i + 1}`,
  name,
  slug: name.toLowerCase().replace(/\W+/g, '-'),
  productType: 'physical',
  inStock: name !== 'Stoneware Mug',
  price: usd(2800 + i * 1100),
  compareAt: i === 1 ? usd(5900) : null,
  maxPrice: usd(i === 0 ? 3200 : 2800 + i * 1100),
  photo: photo(name),
  badges: i === 0 ? [{ label: 'New', tone: 'info' }] : [],
}))
const fabric = { id: 'fabric', name: 'Fabric', values: [{ id: 'linen', name: 'Linen', count: 2 }, { id: 'cotton', name: 'Cotton', count: 1 }] }
const tee = {
  ...summaries[0],
  description: 'Soft, heavyweight organic cotton.',
  highlights: ['Pre-washed, no shrinking'],
  photos: [photo('Organic Cotton Tee'), { ...photo('Tee in sage'), versionId: 'v-sage-m' }],
  video: null,
  options: [
    { id: 'colour', name: 'Colour', values: [{ id: 'sand', name: 'Sand' }, { id: 'sage', name: 'Sage' }] },
    { id: 'size', name: 'Size', values: [{ id: 's', name: 'S' }, { id: 'm', name: 'M' }] },
  ],
  versions: [
    { id: 'v-sand-s', name: null, choices: [{ optionId: 'colour', valueId: 'sand' }, { optionId: 'size', valueId: 's' }], price: usd(2800), compareAt: null, inStock: true, available: null },
    { id: 'v-sage-m', name: null, choices: [{ optionId: 'colour', valueId: 'sage' }, { optionId: 'size', valueId: 'm' }], price: usd(3200), compareAt: null, inStock: false, available: 0 },
  ],
  specs: [{ name: 'Weight', value: '220 gsm', versionId: null }],
  faqs: [],
  compliance: [{ region: 'US', field: 'fibre', value: '100% organic cotton' }],
  returns: 'Returns within 30 days of delivery.',
  warranty: null,
  seoTitle: null,
  seoDescription: null,
  related: summaries.slice(1, 4),
}
const collections = [
  { id: 'c1', name: 'Cotton Edit', slug: 'cotton-edit', description: 'Soft cotton for every day.', seoTitle: null, seoDescription: null, image: null },
  { id: 'c2', name: 'Coming Soon', slug: 'coming-soon', description: null, seoTitle: null, seoDescription: null, image: null },
]

type Request = { query: string; variables: Record<string, unknown> }

/** The seeded store's Shop API; `closed` answers as the edge does once a preview's session has ended (PREVIEW §5 step 3). */
const shopApi = (state: { closed: boolean; asked: Request[] }) => (request: Request): { status: number; body: unknown } => {
  state.asked.push(request)
  if (state.closed) return { status: 403, body: { errors: [{ message: 'This preview has closed.', extensions: { code: 'PREVIEW_CLOSED' } }] } }
  const { query, variables: v } = request
  const ok = (data: unknown) => ({ status: 200, body: { data } })
  if (query.includes('reportStorefrontProblem')) return ok({ reportStorefrontProblem: true })
  if (query.startsWith('query Store')) return ok({ store })
  if (query.startsWith('query Menu')) return ok({ menu: [{ id: 'm1', label: 'Cotton Edit', kind: 'collection', collectionSlug: 'cotton-edit', url: null, children: [] }] })
  if (query.startsWith('query Collections')) return ok({ collections: { nodes: collections } })
  if (query.startsWith('query Collection(')) return ok({ collection: collections.find((c) => c.slug === v['slug']) ?? null })
  if (query.startsWith('query Product(')) return ok({ product: v['slug'] === tee.slug ? tee : null, store: { marketId: 'm-us', markets: [{ id: 'm-us', countries: ['US'] }] } })
  if (query.startsWith('query Listing')) {
    const filters = (v['filters'] as string[] | null) ?? []
    const words = typeof v['search'] === 'string' ? v['search'].toLowerCase() : null
    let nodes = v['collection'] === 'coming-soon' ? [] : summaries.filter((p) => (words ? p.name.toLowerCase().includes(words) : true) && (filters.length ? filters.some((f) => p.name.toLowerCase().includes(f)) : true))
    if (v['sort'] === 'PRICE_HIGH') nodes = [...nodes].reverse()
    const start = v['after'] === 'page-2' ? 4 : 0
    const page = nodes.slice(start, start + 4)
    return ok({ products: { nodes: page, pageInfo: { endCursor: 'page-2', hasNextPage: start + 4 < nodes.length, hasPreviousPage: start > 0, startCursor: 'page-1' }, facets: [fabric] } })
  }
  return { status: 200, body: { errors: [{ message: 'No answer.', extensions: { code: 'UNAVAILABLE' } }] } }
}

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#d9cfbf"/></svg>')

let root: string
let out: string
let runtime: string
let browser: Browser | null = null

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'browse-test-'))
  runtime = join(root, 'runtime')
  out = join(root, 'preview')
  await buildRuntime(runtime)
  const built = await bundle(baseline, out)
  if (!built.ok) throw new Error(JSON.stringify(built.problems))
  if (chrome) browser = await chromium.launch({ executablePath: chrome, headless: true })
})

afterAll(async () => {
  await browser?.close()
  rmSync(root, { recursive: true, force: true })
})

/** The preview host as the edge Worker serves it: the bundle, core's runtime, `index.html` for any page, and /shop-api. */
const previewHost = async (state: { closed: boolean; asked: Request[] }): Promise<BrowserContext> => {
  if (!browser) throw new Error('no browser')
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const api = shopApi(state)
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) return route.abort('blockedbyclient')
    if (url.pathname === '/shop-api') {
      const answer = api(JSON.parse(route.request().postData() ?? '{}') as Request)
      return route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) })
    }
    if (url.pathname.startsWith('/media/')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg })
    const found = url.pathname.startsWith(`/${runtimeFolder}`) ? await fileFor([runtime], url.pathname.slice(runtimeFolder.length + 1)) : await fileFor([out], url.pathname)
    const file = found ?? (/\.[a-z]+$/.test(url.pathname) ? null : await fileFor([out], '/index.html'))
    if (!file) return route.fulfill({ status: 404 })
    return route.fulfill({ status: 200, body: file.bytes, contentType: file.rel.endsWith('.css') ? 'text/css' : file.rel.endsWith('.js') ? 'text/javascript' : 'text/html' })
  })
  return context
}

const seen = (page: Page) =>
  page.evaluate(() => ({
    h1: [...document.querySelectorAll('h1')].map((h) => h.textContent?.trim() ?? ''),
    robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
    preview: document.querySelectorAll('[data-df-sealed="preview"]').length,
    price: document.querySelectorAll('main [data-df-sealed="price"]').length,
    breadcrumbs: document.querySelectorAll('[data-df-sealed="breadcrumbs"]').length,
    legal: document.querySelectorAll('[data-df-sealed="legal"]').length,
    title: document.title,
  }))

describe.skipIf(!chrome)('the baseline theme in preview mode', () => {
  it('opens every browse page from a deep link, noindex and with the preview banner', async () => {
    const state = { closed: false, asked: [] as Request[] }
    const context = await previewHost(state)
    const errors: string[] = []
    const visit = async (path: string, ready: string) => {
      const page = await context.newPage()
      page.on('pageerror', (e) => errors.push(`${path}: ${e.message}`))
      await page.goto(`${origin}${path}`)
      await page.getByRole('heading', { level: 1, name: ready }).waitFor()
      const found = await seen(page)
      await page.close()
      return found
    }
    try {
      const home = await visit('/', 'Welcome to Juniper & Co.')
      expect(home).toMatchObject({ robots: 'noindex, nofollow', preview: 1 })
      expect(await visit('/collections/cotton-edit/', 'Cotton Edit')).toMatchObject({ robots: 'noindex, nofollow', preview: 1, breadcrumbs: 1, title: 'Cotton Edit' })
      expect(await visit('/collections/all/', 'All products')).toMatchObject({ robots: 'noindex, nofollow', preview: 1 })
      expect(await visit('/collections/coming-soon/', 'Coming Soon')).toMatchObject({ preview: 1 })
      // Its own price and the three related products'.
      expect(await visit('/products/organic-cotton-tee/', 'Organic Cotton Tee')).toMatchObject({ robots: 'noindex, nofollow', preview: 1, price: 4, breadcrumbs: 1, legal: 1, title: 'Organic Cotton Tee' })
      expect(await visit('/products/organic-cotton-tee/v-sage-m/', 'Organic Cotton Tee')).toMatchObject({ preview: 1, price: 4 })
      expect(await visit('/products/no-such-thing/', "We can't find that product")).toMatchObject({ robots: 'noindex, nofollow', preview: 1 })
      expect(await visit('/search/?q=linen', 'Results for "linen"')).toMatchObject({ robots: 'noindex, nofollow', preview: 1 })
      expect(await visit('/about/', 'About us')).toMatchObject({ preview: 1 })
      expect(await visit('/contact/', 'Get in touch')).toMatchObject({ preview: 1 })
      expect(await visit('/policies/returns/', 'Returns and refunds')).toMatchObject({ preview: 1 })
      expect(await visit('/nowhere-at-all/', 'We can’t find that page')).toMatchObject({ robots: 'noindex, nofollow', preview: 1 })
      expect(errors).toEqual([])
    } finally {
      await context.close()
    }
  })

  it('shows an empty collection its own empty state', async () => {
    const context = await previewHost({ closed: false, asked: [] })
    try {
      const page = await context.newPage()
      await page.goto(`${origin}/collections/coming-soon/`)
      await page.getByRole('heading', { level: 2, name: 'Nothing here yet' }).waitFor()
      expect(await page.locator('main article').count()).toBe(0)
    } finally {
      await context.close()
    }
  })

  it('keeps filters, sort and pages in the address and loads more in place', async () => {
    const state = { closed: false, asked: [] as Request[] }
    const context = await previewHost(state)
    try {
      const page = await context.newPage()
      await page.goto(`${origin}/collections/all/`)
      await page.getByRole('heading', { level: 1, name: 'All products' }).waitFor()
      await expect.poll(() => page.locator('main article').count()).toBe(4)
      await page.getByRole('button', { name: 'Load more' }).click()
      await expect.poll(() => page.locator('main article').count()).toBe(7)
      expect(page.url()).toBe(`${origin}/collections/all/`)
      await page.getByRole('checkbox', { name: /^Linen/ }).check()
      await expect.poll(() => page.url()).toBe(`${origin}/collections/all/?filter=linen`)
      await expect.poll(() => page.locator('main article').count()).toBe(2)
      await page.getByLabel('Sort').selectOption('price-high')
      await expect.poll(() => page.url()).toBe(`${origin}/collections/all/?filter=linen&sort=price-high`)
      await expect.poll(() => page.locator('main article h3').first().textContent()).toBe('Linen Midi Dress')
      await page.goBack()
      await expect.poll(() => page.url()).toBe(`${origin}/collections/all/?filter=linen`)
      expect(state.asked.filter((r) => r.query.startsWith('query Listing')).map((r) => r.variables)).toContainEqual(expect.objectContaining({ filters: ['linen'], sort: 'PRICE_HIGH', after: null }))

      await page.goto(`${origin}/products/organic-cotton-tee/`)
      await page.getByRole('button', { name: 'Sage, sold out' }).click()
      await page.getByRole('button', { name: /^M/ }).click()
      await expect.poll(() => page.url()).toBe(`${origin}/products/organic-cotton-tee/v-sage-m/`)
      await expect.poll(() => page.getByRole('status').filter({ hasText: 'Sold out' }).count()).toBe(1)
    } finally {
      await context.close()
    }
  })

  it('shows the closed screen and no store data once the preview session has ended', async () => {
    const state = { closed: false, asked: [] as Request[] }
    const context = await previewHost(state)
    try {
      const page = await context.newPage()
      await page.goto(`${origin}/collections/cotton-edit/`)
      await page.getByRole('heading', { level: 1, name: 'Cotton Edit' }).waitFor()
      state.closed = true
      await page.getByRole('button', { name: 'Load more' }).or(page.getByRole('checkbox', { name: /^Linen/ })).first().click()
      await page.getByRole('heading', { level: 1, name: 'This preview has closed' }).waitFor()
      const body = await page.evaluate(() => document.body.innerText)
      expect(body).toContain('Open it again from your link or from the portal.')
      expect(body).not.toContain('Juniper')
      expect(body).not.toContain('Cotton Edit')

      const fresh = await context.newPage()
      await fresh.goto(`${origin}/products/organic-cotton-tee/`)
      await fresh.getByRole('heading', { level: 1, name: 'This preview has closed' }).waitFor()
      expect(await fresh.evaluate(() => document.body.innerText)).not.toContain('Juniper')
    } finally {
      await context.close()
    }
  })
})
