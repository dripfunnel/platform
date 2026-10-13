import { gateWidths } from './checks.js'
import type { CatalogueSnapshot } from './snapshot.js'

// The checkout smoke test's offline Shop API (ARCHITECTURE §4.2, LIVE-SHOP §4 step 7): one test product, a cart and a
// checkout that move as the engine's do, cash on delivery in test mode, and the order it places. Nothing leaves the machine.

/** The test product's address, `/products/{slug}/`; no real store's catalogue is read. */
export const smokeProductSlug = 'df-smoke-test'

/** What a test shopper types, by the `autocomplete` token core's fields carry, for the store's own country. */
export const smokeShopper = (country: string): Readonly<Record<string, string>> => {
  const place =
    country === 'IN'
      ? { city: 'Bengaluru', region: 'Karnataka', postal: '560025', phone: '+91 98450 22113' }
      : country === 'GB'
        ? { city: 'London', region: '', postal: 'SW1A 1AA', phone: '+44 20 7946 0000' }
        : country === 'US'
          ? { city: 'Columbus', region: 'OH', postal: '43215', phone: '+1 614 555 0100' }
          : { city: 'Testville', region: '', postal: '12345', phone: '+1 614 555 0100' }
  return {
    email: 'smoke-test@example.com',
    tel: place.phone,
    name: 'Test Shopper',
    'address-line1': '1 Test Street',
    'address-level2': place.city,
    'address-level1': place.region,
    'postal-code': place.postal,
  }
}

/** One test purchase at one width: null when it reached the order's page, else what stopped it. */
export type SmokeRun = { width: number; problem: string | null }

/** What failed, in words, for every gate width; empty when a test purchase went through at each (INF 4 gates on it). */
export const smokeProblems = (runs: readonly SmokeRun[]): string[] =>
  gateWidths.flatMap((width) => {
    const run = runs.find((r) => r.width === width)
    return !run ? [`The test purchase wasn't tried at ${width} px.`] : run.problem ? [`The test purchase at ${width} px didn't complete: ${run.problem}`] : []
  })

type Request = { query: string; variables: Record<string, unknown> }

/** A fresh shop for one test purchase; `placed` is the order's id once Place order went through. */
export const smokeShop = (s: CatalogueSnapshot) => {
  const currency = s.store.pricingCurrency
  const country = s.store.address?.country ?? 'US'
  const money = (amount: number) => ({ amount: String(amount), currency })
  const price = 2500
  const version = { id: 'df-smoke-version', name: null, choices: [], price: money(price), compareAt: null, inStock: true, available: 5 }
  const product = { id: 'df-smoke-product', name: 'Smoke test item', slug: smokeProductSlug, description: null, highlights: [], inStock: true, price: money(price), compareAt: null, maxPrice: null, badges: [], photos: [], video: null, options: [], versions: [version], specs: [], faqs: [], compliance: [], returns: null, warranty: null, seoTitle: null, seoDescription: null, related: [] }
  const markets = [{ id: 'df-smoke-market', countries: [country] }]
  const flat = { id: 'flat', provider: null, service: null, amount: money(0), before: null, minDays: 2, maxDays: 4, hours: null }
  let cart: Record<string, unknown> | null = null
  const state = { placed: null as string | null, reports: [] as { kind: string; subject: string }[] }

  const totals = (quantity: number) => ({ subtotal: money(price * quantity), total: money(price * quantity), amountDue: money(price * quantity) })
  const newCart = (quantity: number) => ({
    id: 'df-smoke-cart', currency, email: null, phone: null, note: null, needsShipping: true, checkoutStep: 'contact', problems: [], readyToPay: false, deliverable: null, shippingOption: null,
    lines: [{ versionId: version.id, quantity, productName: product.name, productSlug: product.slug, versionName: null, photoUrl: null, unitPrice: money(price), lineTotal: money(price * quantity), discount: null, available: 5, problem: null }],
    discount: null, discounts: [], codes: [], shipping: null, shippingDiscount: null, tax: null, shippingAddress: null, billingAddress: null, shippingOptions: [], ...totals(quantity),
  })
  const order = () => ({ id: state.placed, number: 'SMOKE-1', state: 'placed', paymentState: 'pending', paymentMethod: 'cod', paymentDueBy: null, shippingMethod: null, placedAt: null, pricesIncludeTax: s.store.pricesIncludeTax, lines: [{ name: product.name, versionName: null, quantity: 1, unitPrice: money(price), lineTotal: money(price) }], subtotal: money(price), discounts: [], shipping: money(0), tax: null, total: money(price) })
  const changed = (key: string, patch: Record<string, unknown> = {}) => {
    if (!cart) return { errors: [{ message: 'No cart.', extensions: { code: 'NO_CART' } }] }
    Object.assign(cart, patch)
    return { data: { [key]: { cart, cartToken: null } } }
  }
  const outage = { errors: [{ message: 'The offline Shop API has no answer for this.', extensions: { code: 'UNAVAILABLE' } }] }

  const answer = ({ query, variables: v }: Request): unknown => {
    if (query.includes('reportStorefrontProblem')) return (state.reports.push({ kind: String(v['kind'] ?? ''), subject: String(v['subject'] ?? '') }), { data: { reportStorefrontProblem: true } })
    if (/^\s*query Store\b/.test(query)) return { data: { store: s.store } }
    if (/^\s*query Product\b/.test(query)) return { data: { product: v['slug'] === smokeProductSlug ? product : null, store: { marketId: markets[0]?.id, markets } } }
    if (query.includes('addToCart(')) {
      const quantity = Number(v['quantity'] ?? 1) + ((cart?.['lines'] as { quantity: number }[] | undefined)?.[0]?.quantity ?? 0)
      cart = newCart(quantity)
      return { data: { addToCart: { cart, cartToken: 'df-smoke-cart-token' } } }
    }
    if (/^\s*query Cart\b/.test(query)) return { data: { cart } }
    if (query.includes('setCartQuantity(')) return Number(v['quantity']) > 0 ? ((cart = newCart(Number(v['quantity']))), { data: { setCartQuantity: { cart, cartToken: null } } }) : ((cart = null), { data: { setCartQuantity: { cart: null, cartToken: null } } })
    if (query.includes('paymentOptions')) return { data: { paymentOptions: [{ provider: 'cod', kind: 'cod', instructions: null, mode: 'test', publicKey: null }], store: { markets } } }
    if (query.includes('setCartContact(')) return changed('setCartContact', { email: v['email'] ?? null, phone: v['phone'] ?? null })
    if (query.includes('setShippingAddress(')) return changed('setShippingAddress', { shippingAddress: v['address'], shippingOptions: [flat], checkoutStep: 'ship' })
    if (query.includes('setShippingOption(')) return changed('setShippingOption', { shippingOption: v['option'], shipping: money(0) })
    if (/\bcheckout \{/.test(query)) return cart ? (Object.assign(cart, { checkoutStep: 'pay', readyToPay: true }), { data: { checkout: cart } }) : { data: { checkout: null } }
    if (query.includes('placeOrder(')) {
      if (!cart || v['provider'] !== 'cod') return { errors: [{ message: 'Not ready.', extensions: { code: 'NOT_READY' } }] }
      state.placed = 'df-smoke-order'
      cart = null
      return { data: { placeOrder: { orderId: state.placed, total: money(price), instructions: null, payment: null } } }
    }
    if (query.includes('confirmPayment(')) return { data: { confirmPayment: state.placed && v['orderId'] === state.placed ? order() : null } }
    return outage
  }
  return { answer, state, country }
}
