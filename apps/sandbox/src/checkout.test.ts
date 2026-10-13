import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { basics, chrome, previewOrigin, startPreview, type Preview, type ShopRequest } from './test/preview'

// Card #313: the baseline theme's checkout in preview mode, a test purchase through each step against
// a Shop API that moves the cart as the engine does (FIRST-RELEASE §19).
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const usd = (cents: number) => ({ amount: String(cents), currency: 'USD' })
const flat = { id: 'flat', provider: null, service: null, amount: usd(0), before: null, minDays: 3, maxDays: 5, hours: null }

const engine = ({ place, down = 0 }: { place?: (provider: string) => unknown; down?: number } = {}) => {
  let failures = down
  const cart: Record<string, unknown> = { id: 'c1', currency: 'USD', email: null, phone: null, note: null, needsShipping: true, checkoutStep: 'contact', problems: [], readyToPay: false, deliverable: null, shippingOption: null, lines: [{ versionId: 'v1', quantity: 1, productName: 'Organic Cotton Tee', productSlug: 'organic-cotton-tee', versionName: 'Sand / M', photoUrl: null, unitPrice: usd(2800), lineTotal: usd(2800), discount: null, available: 5, problem: null }], subtotal: usd(2800), discount: null, discounts: [], codes: [], shipping: null, shippingDiscount: null, tax: { amount: usd(224), pricesIncludeTax: false }, total: usd(3024), amountDue: usd(3024), shippingAddress: null, billingAddress: null, shippingOptions: [] }
  const asked: ShopRequest[] = []
  const order = { id: 'o-1', number: 'JC-1051', state: 'placed', paymentState: 'pending', paymentMethod: 'cod', placedAt: '2026-10-13T10:00:00.000Z', paymentDueBy: null, shippingOption: 'flat', shippingMethod: null, pricesIncludeTax: false, lines: [{ name: 'Organic Cotton Tee', versionName: 'Sand / M', quantity: 1, unitPrice: usd(2800), lineTotal: usd(2800) }], subtotal: usd(2800), discount: usd(0), discounts: [], shipping: usd(0), tax: usd(224), total: usd(3024) }
  const answer = (r: ShopRequest): unknown => {
    asked.push(r)
    const v = r.variables
    const change = (key: string) => ({ data: { [key]: { cart, cartToken: null } } })
    if (r.query.startsWith('query Cart')) return failures-- > 0 ? { errors: [{ message: 'down', extensions: { code: 'UNAVAILABLE' } }] } : { data: { cart } }
    if (r.query.includes('setCartContact')) return (Object.assign(cart, { email: v['email'], phone: v['phone'] }), change('setCartContact'))
    if (r.query.includes('setShippingAddress')) return (Object.assign(cart, { shippingAddress: v['address'], shippingOptions: [flat], checkoutStep: 'ship' }), change('setShippingAddress'))
    if (r.query.includes('setShippingOption')) return (Object.assign(cart, { shippingOption: v['option'], shipping: usd(0) }), change('setShippingOption'))
    if (r.query.includes('checkout {')) return (Object.assign(cart, { checkoutStep: 'pay', readyToPay: true }), { data: { checkout: cart } })
    if (r.query.includes('paymentOptions')) return { data: { paymentOptions: [{ provider: 'cod', kind: 'cod', instructions: null, mode: 'test', publicKey: null }, { provider: 'razorpay', kind: 'card', instructions: null, mode: 'test', publicKey: 'rzp_test_1' }, { provider: 'bank_transfer', kind: 'bank_transfer', instructions: 'Juniper & Co., IBAN TEST 0001', mode: 'test', publicKey: null }], store: { markets: [{ id: 'm', countries: ['US'] }] } } }
    if (r.query.includes('placeOrder')) return place ? place(String(v['provider'])) : { data: { placeOrder: { orderId: 'o-1', total: usd(3024), instructions: null, payment: null } } }
    if (r.query.includes('confirmPayment')) return { data: { confirmPayment: order } }
    return basics(r)
  }
  return { cart, asked, answer }
}

let preview: Preview | null = null
beforeAll(async () => {
  if (chrome) preview = await startPreview()
})
afterAll(async () => preview?.close())

describe.skipIf(!chrome)('the baseline checkout', () => {
  it.each([390, 1440])('takes a test purchase through every step to the order’s page at %i px', async (width) => {
    if (!preview) throw new Error('no browser')
    const api = engine()
    const context = await preview.open(api.answer, width)
    await context.addInitScript(() => localStorage.setItem('df-cart', 'tok'))
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    try {
      await page.goto(`${previewOrigin}/checkout/`)
      await page.getByRole('heading', { level: 1, name: 'Checkout' }).waitFor()
      await page.getByLabel('Email').fill('maya')
      await page.getByRole('button', { name: 'Continue' }).click()
      await page.getByText("Check this; it doesn't look right.").waitFor()
      await page.getByLabel('Email').fill('maya@example.com')
      await page.getByRole('button', { name: 'Continue' }).click()
      await page.getByLabel('Full name').waitFor()
      await page.getByLabel('Full name').fill('Maya Chen')
      await page.getByLabel('Address', { exact: true }).fill('88 Neil Ave')
      await page.getByLabel('City').fill('Columbus')
      await page.getByLabel('State').fill('OH')
      await page.getByLabel('ZIP code').fill('43215')
      await page.getByRole('button', { name: 'Continue' }).click()
      await page.getByRole('radio', { name: /Standard delivery/ }).click()
      await page.getByRole('radio', { name: 'Cash on delivery' }).click()
      await page.getByRole('button', { name: 'Continue' }).click()
      await page.getByRole('button', { name: 'Place order' }).waitFor()
      expect(await page.locator('[data-df-sealed="payment"]').count()).toBe(1)
      expect(await page.locator('[data-df-sealed="summary"]').count()).toBe(1)
      await page.getByRole('button', { name: 'Place order' }).click()
      await page.waitForURL(`${previewOrigin}/order/o-1/`)
      expect(api.asked.filter((r) => r.query.includes('placeOrder')).map((r) => r.variables)).toEqual([{ provider: 'cod' }])
      expect(api.asked.every((r) => r.headers['x-shop-session'] === undefined)).toBe(true)
      expect(errors).toEqual([])
    } finally {
      await context.close()
    }
  })

  it('shows the empty state without a cart', async () => {
    if (!preview) throw new Error('no browser')
    const context = await preview.open(engine().answer)
    try {
      const page = await context.newPage()
      await page.goto(`${previewOrigin}/checkout/`)
      await page.getByRole('heading', { level: 1, name: "There's nothing to check out" }).waitFor()
    } finally {
      await context.close()
    }
  })

  /** A cart already through contact, address and delivery, as a shopper coming back to checkout has it. */
  const ready = async (api: ReturnType<typeof engine>, width = 1440) => {
    if (!preview) throw new Error('no browser')
    Object.assign(api.cart, { email: 'maya@example.com', shippingAddress: { name: 'Maya Chen', line1: '88 Neil Ave', line2: null, city: 'Columbus', region: 'OH', postalCode: '43215', country: 'US', phone: null }, shippingOptions: [flat], shippingOption: 'flat', checkoutStep: 'ship' })
    const context = await preview.open(api.answer, width)
    await context.addInitScript(() => localStorage.setItem('df-cart', 'tok'))
    const page = await context.newPage()
    await page.goto(`${previewOrigin}/checkout/`)
    return { context, page }
  }

  it('reopens a finished step with Change, prices each delivery, and offers no sign-in on a preview', async () => {
    const { context, page } = await ready(engine())
    try {
      await page.getByRole('radio', { name: 'Cash on delivery' }).waitFor()
      expect(await page.getByRole('link', { name: 'Sign in' }).count()).toBe(0)
      await page.getByRole('button', { name: 'Change Delivery method' }).click()
      await page.getByRole('radio', { name: /Standard delivery\s+Free/ }).waitFor()
      await page.getByRole('button', { name: 'Change Contact' }).click()
      expect(await page.getByLabel('Email').inputValue()).toBe('maya@example.com')
    } finally {
      await context.close()
    }
  })

  it.each([
    ['OUT_OF_STOCK', 'Something in your cart has just sold out. Check your cart and try again.'],
    ['PHONE_REQUIRED', 'Add your mobile number to pay this way.'],
    ['NOT_READY', "There's something to finish before you pay. Check each step."],
    ['CART_CHANGED', 'Your cart changed while you were paying. Check it and try again.'],
  ])('words the engine’s %s refusal when placing', async (code, words) => {
    const { context, page } = await ready(engine({ place: () => ({ errors: [{ message: 'refused', extensions: { code } }] }) }))
    try {
      await page.getByRole('radio', { name: 'Cash on delivery' }).click()
      await page.getByRole('button', { name: 'Continue' }).click()
      await page.getByRole('button', { name: 'Place order' }).click()
      await page.getByRole('alert').filter({ hasText: words }).waitFor()
    } finally {
      await context.close()
    }
  })

  it('offers Try paying again when a provider can’t be reached', async () => {
    const start = { providerRef: 'order_1', publicKey: 'rzp_test_1', accountId: null, clientSecret: null, sessionId: null, redirectUrl: null }
    const api = engine({ place: () => ({ data: { placeOrder: { orderId: 'o-1', total: usd(3024), instructions: null, payment: start } } }) })
    const { context, page } = await ready(api)
    try {
      await page.getByRole('radio', { name: 'UPI, cards and netbanking' }).click()
      await page.getByRole('button', { name: 'Continue' }).click()
      await page.getByRole('button', { name: 'Place order' }).click()
      // The preview host's routing refuses Razorpay's script, as a provider that's down would.
      await page.getByRole('button', { name: 'Try paying again' }).waitFor()
      expect(api.asked.filter((r) => r.query.includes('placeOrder')).length).toBe(1)
    } finally {
      await context.close()
    }
  })

  it('shows the failed state, and checkout again after Try again', async () => {
    const { context, page } = await ready(engine({ down: 1 }))
    try {
      await page.getByRole('heading', { level: 1, name: "We couldn't load checkout" }).waitFor()
      await page.getByRole('button', { name: 'Try again' }).click()
      await page.getByRole('heading', { level: 1, name: 'Checkout' }).waitFor()
    } finally {
      await context.close()
    }
  })
})
