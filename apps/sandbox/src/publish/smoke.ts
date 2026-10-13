import type { Browser, Page } from 'playwright-core'
import { consentStorageKey } from '@dripfunnel/storefront-core'
import { gateWidths, smokeProductSlug, smokeShop, smokeShopper, type CatalogueSnapshot, type SmokeRun } from '@dripfunnel/storefront-core/guard'
import { headersOf } from './check'
import { fileFor, serveFolders, type Served } from './serve'

// The checkout smoke test (ARCHITECTURE §4.2, LIVE-SHOP §4 step 7): at one width, a shopper buys core's test product from
// its page through the cart and checkout to the order's page, against core's offline Shop API. Any theme's checkout is
// driven the same way: core renders every field, marked with its autocomplete token, and marks Add to cart and Place order.

const stepMs = 15_000
const rounds = 12

type Edge = { fallbacks?: { prefix: string; page: string }[] }

/** Fills what the open step asks for and presses its Continue; false when there was nothing to do. */
const fillStep = async (page: Page, shopper: Readonly<Record<string, string>>, country: string): Promise<boolean> => {
  let acted = false
  for (const input of await page.locator('main input:visible').all()) {
    const type = (await input.getAttribute('type')) ?? 'text'
    if (type === 'radio' || type === 'checkbox' || (await input.inputValue()) !== '') continue
    const token = ((await input.getAttribute('autocomplete')) ?? '').split(/\s+/).at(-1) ?? ''
    const value = shopper[type === 'email' ? 'email' : type === 'tel' ? 'tel' : token]
    if (value) {
      await input.fill(value)
      acted = true
    }
  }
  for (const select of await page.locator('main select:visible').all()) {
    if ((await select.inputValue()) !== '') continue
    await select.selectOption(country).catch(() => select.selectOption({ index: 1 }))
    acted = true
  }
  const radios = page.locator('main input[type="radio"]:visible')
  if ((await radios.count()) > 0 && (await page.locator('main input[type="radio"]:checked').count()) === 0) {
    await radios.first().check()
    acted = true
    await page.waitForLoadState('networkidle').catch(() => undefined)
  }
  const next = page.locator('main form button[type="submit"]:visible:enabled').first()
  if ((await next.count()) > 0) {
    await next.click()
    acted = true
  }
  await page.waitForLoadState('networkidle').catch(() => undefined)
  return acted
}

/** One test purchase at `width`: null when it reached the order's page, else where it stopped. */
const smokeCheckout = async (browser: Browser, served: Served, s: CatalogueSnapshot, roots: { site: string; assets: string }, width: number): Promise<SmokeRun> => {
  const shop = smokeShop(s)
  const shopper = smokeShopper(shop.country)
  const edge = JSON.parse((await fileFor([roots.site], '/_edge.json'))?.bytes.toString('utf8') ?? '{}') as Edge
  const errors: string[] = []
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  await context.addInitScript(([key]) => localStorage.setItem(key ?? '', JSON.stringify({ analytics: false, marketing: false, at: '2026-01-01T00:00:00.000Z' })), [consentStorageKey])
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0] ?? 'An error.'))
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === served.origin && url.pathname === '/shop-api') {
      const body = JSON.parse(route.request().postData() ?? '{}') as { query?: string; variables?: Record<string, unknown> }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shop.answer({ query: body.query ?? '', variables: body.variables ?? {} })) })
    }
    if (url.origin === served.origin) {
      // An address with no file of its own gets its route's page, as the edge Worker serves it (LIVE-SHOP §5 step 6).
      const fallback = (await fileFor([roots.site], url.pathname)) ? null : edge.fallbacks?.find((f) => url.pathname.startsWith(f.prefix))
      return fallback ? route.fulfill({ response: await route.fetch({ url: `${served.origin}${fallback.page}` }) }) : route.fallback()
    }
    const base = s.assetBase ? new URL(s.assetBase) : null
    if (base && url.origin === base.origin && url.pathname.startsWith(base.pathname)) {
      const found = await fileFor([roots.assets], url.pathname.slice(base.pathname.length))
      return found ? route.fulfill({ status: 200, body: found.bytes, contentType: found.rel.endsWith('.css') ? 'text/css' : 'text/javascript' }) : route.fulfill({ status: 404 })
    }
    return route.abort('blockedbyclient')
  })
  const stopped = (problem: string): SmokeRun => ({ width, problem: errors[0] ? `${problem} (${errors[0]})` : problem })
  try {
    await page.goto(`${served.origin}/products/${smokeProductSlug}/`, { waitUntil: 'networkidle', timeout: stepMs }).catch(() => undefined)
    const add = page.locator('[data-df-action="add-to-cart"]').first()
    if (!(await add.isVisible().catch(() => false))) return stopped('the product page shows no Add to cart.')
    await add.click()
    await page.waitForLoadState('networkidle').catch(() => undefined)
    await page.goto(`${served.origin}/cart/`, { waitUntil: 'networkidle', timeout: stepMs }).catch(() => undefined)
    const onward = page.locator('main a[href="/checkout/"]').first()
    if (!(await onward.isVisible().catch(() => false))) return stopped('the cart page shows no way to checkout.')
    await onward.click()
    await page.waitForURL(/\/checkout\/$/, { timeout: stepMs }).catch(() => undefined)
    await page.waitForLoadState('networkidle').catch(() => undefined)
    for (let round = 0; round < rounds && !shop.state.placed; round += 1) {
      const place = page.locator('[data-df-action="place-order"]:visible')
      if ((await place.count()) > 0 && (await place.first().isEnabled())) {
        await place.first().click()
        break
      }
      if (!(await fillStep(page, shopper, shop.country))) return stopped('its checkout stopped with nothing left to fill in and no Place order.')
    }
    if (!shop.state.placed) return stopped('Place order never went through.')
    await page.waitForURL(/\/order\//, { timeout: stepMs }).catch(() => undefined)
    if (!new URL(page.url()).pathname.startsWith('/order/')) return stopped('placing the order didn’t lead to the order’s page.')
    if (!(await page.locator('main h1').first().isVisible().catch(() => false))) return stopped('the order’s page shows no heading.')
    return errors.length > 0 ? stopped('the page stopped with an error') : { width, problem: null }
  } finally {
    await context.close()
  }
}

/** The smoke test over a built site at every gate width, each page with its CSP, as the build image runs it. */
export const smokeTest = async ({ browser, site, snapshot }: { browser: Browser; site: string; snapshot: CatalogueSnapshot }): Promise<SmokeRun[]> => {
  const headers = await headersOf(site, snapshot)
  const served = await serveFolders([site], (rel) => headers[rel]?.['content-security-policy'] ?? null)
  try {
    const runs: SmokeRun[] = []
    for (const width of gateWidths) runs.push(await smokeCheckout(browser, served, snapshot, { site, assets: site }, width))
    return runs
  } finally {
    await served.close()
  }
}
