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
  /** The shared asset host; scripts on any other host but the store's own are not ours to fetch. */
  assetHost: string
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
/** No call starts after this; what is left counts as skipped, so a slow store is never rolled back for slowness. */
export const checksLimitMs = 300_000
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

/** The scripts and stylesheets a page loads from its own host or the asset host; a theme loads nothing else (AGENTS.md). */
const assetUrls = (html: string, base: URL, assetHost: string): URL[] => {
  const found = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g), ...html.matchAll(/<link\b(?=[^>]*\brel="stylesheet")[^>]*\bhref="([^"]+)"/g)]
  return found.flatMap((m) => {
    try {
      const url = new URL((m[1] ?? '').replaceAll('&amp;', '&'), base)
      return url.protocol === 'https:' && (url.host === base.host || url.host === assetHost) ? [url] : []
    } catch {
      return []
    }
  }).slice(0, maxAssetsPerPage)
}

const notOurs = 'The store’s address isn’t answered by the platform’s edge (its DNS or a proxy in front).'
const unreachable = 'The store’s address didn’t answer.'

const outOfTime = (name: CheckName) => skip(name, 'Not checked: the checks ran out of time.')

const checkPage = async (probe: EdgeProbe, target: CheckTarget, name: CheckName, path: string, inTime: () => boolean): Promise<CheckResult> => {
  if (!inTime()) return outOfTime(name)
  const url = new URL(path, `https://${target.host}`)
  const page: ProbeAnswer | null = await probe.get(url.href)
  // No answer at all (DNS, TLS, timeouts) is the address's trouble, which the build before had too: never the build's.
  if (!page || page.status === 0) return skip(name, unreachable)
  // An answer the edge Worker didn't give (a parked domain, a proxy in front) says nothing about the build.
  if (page.build === null) return skip(name, notOurs)
  if (page.build !== target.buildId) throw new Stale(name)
  if (page.status !== 200) return fail(name, `${path} answered ${page.status}.`)
  if (!page.contentType.startsWith('text/html')) return fail(name, `${path} isn’t a page.`)
  for (const asset of assetUrls(page.body, url, target.assetHost)) {
    if (!inTime()) break
    const loaded = await probe.get(asset.href)
    if (loaded && loaded.status !== 0 && loaded.status !== 200) return fail(name, `A script or stylesheet of ${path} answered ${loaded.status}.`)
  }
  return pass(name, `${path} opens.`)
}

const productQuery = 'query PostDeployProduct($slug: String!) { product(slug: $slug) { versions { id } } }'
const paymentQuery = 'query PostDeployPayment { paymentOptions { provider kind publicKey } }'

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {})

const checkCart = async (probe: EdgeProbe, target: CheckTarget, slug: string | null): Promise<CheckResult> => {
  if (slug === null) return skip('cart', 'The build has no product page.')
  const answer = await probe.shop(target.host, productQuery, { slug })
  if (!answer || answer.status === 0) return skip('cart', 'The Shop API didn’t answer on the store’s address.')
  if (answer.status !== 200 || answer.errors) return fail('cart', `The Shop API answered ${answer.status} on the store’s address.`)
  const product = record(answer.data)['product']
  const versions = record(product)['versions']
  if (!Array.isArray(versions) || versions.length === 0) return skip('cart', 'The product isn’t on sale any more.')
  return pass('cart', 'The product can be added to a cart.')
}

const checkPayment = async (probe: EdgeProbe, target: CheckTarget): Promise<CheckResult> => {
  const answer = await probe.shop(target.host, paymentQuery, {})
  if (!answer || answer.status === 0) return skip('payment', 'The Shop API didn’t answer on the store’s address.')
  if (answer.status !== 200 || answer.errors) return fail('payment', `The Shop API answered ${answer.status} on the store’s address.`)
  const options = record(answer.data)['paymentOptions']
  if (!Array.isArray(options) || options.length === 0) return skip('payment', 'The store takes no payment yet.')
  const keyless = options.map(record).find((o) => typeof o['provider'] === 'string' && isCardProvider(o['provider']) && typeof o['publicKey'] !== 'string')
  if (keyless) return fail('payment', 'A card payment has no key for its payment element.')
  return pass('payment', `${options.length} way${options.length === 1 ? '' : 's'} to pay.`)
}

const checkOnce = async (probe: EdgeProbe, target: CheckTarget, inTime: () => boolean): Promise<CheckResult[]> => {
  const product = target.files.find((f) => productPage.test(f)) ?? null
  const checkout = target.files.find((f) => checkoutPage.test(f)) ?? null
  const slug = product ? (productPage.exec(product)?.[1] ?? null) : null
  const home = await checkPage(probe, target, 'home', '/', inTime)
  // An address that isn't ours, or doesn't answer, tells nothing more on any other path.
  if (home.result === 'skipped' && (home.detail === notOurs || home.detail === unreachable)) return (['home', 'product', 'cart', 'checkout', 'payment'] as const).map((name) => skip(name, home.detail))
  return [
    home,
    product ? await checkPage(probe, target, 'product', pathOf(product), inTime) : skip('product', 'The build has no product page.'),
    inTime() ? await checkCart(probe, target, slug) : outOfTime('cart'),
    checkout ? await checkPage(probe, target, 'checkout', pathOf(checkout), inTime) : fail('checkout', 'The build has no checkout page.'),
    inTime() ? await checkPayment(probe, target) : outOfTime('payment'),
  ]
}

/**
 * Waits until the edge serves the new build (the lookup's 60 seconds, LIVE-SHOP §5 step 1), then checks; a failure is
 * tried once more before it counts, so one dropped request never rolls a store back.
 */
export const runPostDeployChecks = async (probe: EdgeProbe, target: CheckTarget, timing: CheckTiming): Promise<CheckResult[]> => {
  const started = timing.now()
  const deadline = started + checksWindowMs
  const inTime = () => timing.now() < started + checksLimitMs
  let retried = false
  for (;;) {
    let results: CheckResult[]
    try {
      results = await checkOnce(probe, target, inTime)
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
