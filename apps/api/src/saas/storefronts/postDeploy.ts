import { isCardProvider } from '#core/payments'
import type { EdgeProbe, ProbeAnswer } from '#integrations/http/edgeProbe'

// The post-deploy checks from the edge (storefront LIVE-SHOP.md §4 step 10, ARCHITECTURE §4.2 step 5): home, a product,
// add to cart, checkout opens, the payment element's setup. Run on the store's own address once the pointer moved.

export type CheckName = 'home' | 'product' | 'cart' | 'checkout' | 'payment'
export interface CheckResult {
  name: CheckName
  result: 'passed' | 'failed' | 'skipped'
  detail: string
}

export interface CheckTarget {
  host: string
  buildId: string
  /** Every file of the build, from its `_manifest.json`; the product and checkout pages are found among them. */
  files: readonly string[]
}

export interface CheckTiming {
  wait: (ms: number) => Promise<void>
  now: () => number
}

/** ARCHITECTURE §4.2 step 5: the checks finish within about two minutes of the switch. */
export const checksWindowMs = 120_000
const retryMs = 10_000
const maxAssetsPerPage = 20

// A product's own page, never the client-rendered `_fallback` one (core's routeAddresses); the main language comes first.
const productPage = /^products\/([a-z0-9][a-z0-9-]*)\/index\.html$/
const checkoutPage = /^checkout\/index\.html$/
const pathOf = (file: string) => `/${file.replace(/(?:^|\/)index\.html$/, '')}`

const pass = (name: CheckName, detail: string): CheckResult => ({ name, result: 'passed', detail })
const fail = (name: CheckName, detail: string): CheckResult => ({ name, result: 'failed', detail })
const skip = (name: CheckName, detail: string): CheckResult => ({ name, result: 'skipped', detail })

class Stale extends Error {
  override name = 'Stale'
  constructor(readonly check: CheckName) {
    super(check)
  }
}

/** The scripts and stylesheets a page loads, which must come from the new build's assets too. */
const assetUrls = (html: string, base: URL): URL[] => {
  const found = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g), ...html.matchAll(/<link\b(?=[^>]*\brel="stylesheet")[^>]*\bhref="([^"]+)"/g)]
  return found.flatMap((m) => {
    try {
      const url = new URL((m[1] ?? '').replaceAll('&amp;', '&'), base)
      return url.protocol === 'https:' ? [url] : []
    } catch {
      return []
    }
  }).slice(0, maxAssetsPerPage)
}

const checkPage = async (probe: EdgeProbe, target: CheckTarget, name: CheckName, path: string): Promise<CheckResult> => {
  const url = new URL(path, `https://${target.host}`)
  const page: ProbeAnswer | null = await probe.get(url.href)
  if (!page) return skip(name, 'The store’s address can’t be reached from here.')
  if (page.status === 200 && page.build !== target.buildId) throw new Stale(name)
  if (page.status !== 200) return fail(name, `${path} answered ${page.status}.`)
  if (!page.contentType.startsWith('text/html')) return fail(name, `${path} isn’t a page.`)
  for (const asset of assetUrls(page.body, url)) {
    const loaded = await probe.get(asset.href)
    if (loaded && loaded.status !== 200) return fail(name, `A script or stylesheet of ${path} answered ${loaded.status}.`)
  }
  return pass(name, `${path} opens.`)
}

const productQuery = 'query PostDeployProduct($slug: String!) { product(slug: $slug) { versions { id } } }'
const paymentQuery = 'query PostDeployPayment { paymentOptions { provider kind publicKey } }'

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {})

const checkCart = async (probe: EdgeProbe, target: CheckTarget, slug: string | null): Promise<CheckResult> => {
  if (slug === null) return skip('cart', 'The build has no product page.')
  const answer = await probe.shop(target.host, productQuery, { slug })
  if (!answer) return skip('cart', 'The Shop API can’t be reached from here.')
  if (answer.status !== 200 || answer.errors) return fail('cart', `The Shop API answered ${answer.status} on the store’s address.`)
  const product = record(answer.data)['product']
  const versions = record(product)['versions']
  if (!Array.isArray(versions) || versions.length === 0) return skip('cart', 'The product isn’t on sale any more.')
  return pass('cart', 'The product can be added to a cart.')
}

const checkPayment = async (probe: EdgeProbe, target: CheckTarget): Promise<CheckResult> => {
  const answer = await probe.shop(target.host, paymentQuery, {})
  if (!answer) return skip('payment', 'The Shop API can’t be reached from here.')
  if (answer.status !== 200 || answer.errors) return fail('payment', `The Shop API answered ${answer.status} on the store’s address.`)
  const options = record(answer.data)['paymentOptions']
  if (!Array.isArray(options) || options.length === 0) return skip('payment', 'The store takes no payment yet.')
  const keyless = options.map(record).find((o) => typeof o['provider'] === 'string' && isCardProvider(o['provider']) && typeof o['publicKey'] !== 'string')
  if (keyless) return fail('payment', 'A card payment has no key for its payment element.')
  return pass('payment', `${options.length} way${options.length === 1 ? '' : 's'} to pay.`)
}

const checkOnce = async (probe: EdgeProbe, target: CheckTarget): Promise<CheckResult[]> => {
  const product = target.files.find((f) => productPage.test(f)) ?? null
  const checkout = target.files.find((f) => checkoutPage.test(f)) ?? null
  const slug = product ? (productPage.exec(product)?.[1] ?? null) : null
  return [
    await checkPage(probe, target, 'home', '/'),
    product ? await checkPage(probe, target, 'product', pathOf(product)) : skip('product', 'The build has no product page.'),
    await checkCart(probe, target, slug),
    checkout ? await checkPage(probe, target, 'checkout', pathOf(checkout)) : fail('checkout', 'The build has no checkout page.'),
    await checkPayment(probe, target),
  ]
}

/**
 * Waits until the edge serves the new build (the lookup's 60 seconds, LIVE-SHOP §5 step 1), then checks; a failure is
 * tried once more before it counts, so one dropped request never rolls a store back.
 */
export const runPostDeployChecks = async (probe: EdgeProbe, target: CheckTarget, timing: CheckTiming): Promise<CheckResult[]> => {
  const deadline = timing.now() + checksWindowMs
  let retried = false
  for (;;) {
    let results: CheckResult[]
    try {
      results = await checkOnce(probe, target)
    } catch (error) {
      if (!(error instanceof Stale)) throw error
      if (timing.now() + retryMs > deadline) return [fail(error.check, 'The store’s address still serves the build before this one.')]
      await timing.wait(retryMs)
      continue
    }
    if (!results.some((r) => r.result === 'failed') || retried || timing.now() + retryMs > deadline) return results
    retried = true
    await timing.wait(retryMs)
  }
}

/** The first failed check's code for `publish_run.error`, as LOGGING's `storefront.rolled_back` names it. */
export const failedCheck = (results: readonly CheckResult[]): string | null => {
  const failed = results.find((r) => r.result === 'failed')
  return failed ? `check_${failed.name}` : null
}
