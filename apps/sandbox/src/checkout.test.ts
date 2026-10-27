import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { basics, chrome, previewOrigin, startPreview, type Preview, type ShopRequest } from './test/preview'

// Card #313: the baseline theme's checkout in preview mode, a test purchase through each step against
// a Shop API that moves the cart as the engine does (FIRST-RELEASE §19).
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const usd = (cents: number) => ({ amount: String(cents), currency: 'USD' })
const flat = { id: 'flat', provider: null, service: null, amount: usd(0), before: null, minDays: 3, maxDays: 5, hours: null }
const pickup = { ...flat, id: 'pickup', amount: usd(500) }

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
    if (r.query.includes('applyGiftCard(')) {
      const number = String(v['number'])
      if (number === 'GC12345678') return (Object.assign(cart, { giftCard: { applied: usd(1000), balance: usd(0), expiresAt: null, last4: '5678' }, amountDue: usd(2024) }), change('applyGiftCard'))
      return { errors: [{ message: 'no', extensions: { code: number === 'MANY' ? 'RATE_LIMITED' : number === 'PREVIEW' ? 'NOT_IN_PREVIEW' : 'GIFT_CARD_INVALID' } }] }
    }
    if (r.query.includes('removeGiftCard')) return (Object.assign(cart, { giftCard: null, amountDue: cart['total'] }), change('removeGiftCard'))
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
      // One delivery option: core applies it and skips the step (storefront ARCHITECTURE §2.1).
      await page.getByRole('radio', { name: 'Cash on delivery' }).click()
      expect(await page.getByRole('radio', { name: /Standard delivery/ }).count()).toBe(0)
      await page.getByRole('button', { name: 'Continue' }).click()
      await page.getByRole('button', { name: 'Place order' }).waitFor()
      expect(await page.locator('[data-df-sealed="payment"]').count()).toBe(1)
      expect(await page.locator('[data-df-sealed="summary"]').count()).toBe(1)
      await page.getByRole('button', { name: 'Place order' }).click()
      await page.waitForURL(`${previewOrigin}/order/o-1/`)
      await page.getByRole('heading', { level: 1, name: 'Thank you' }).waitFor()
      await page.getByText('Pay on delivery', { exact: true }).waitFor()
      await page.getByText('Pay in cash to the courier when it arrives.').waitFor()
      expect(await page.locator('[data-df-sealed="summary"]').count()).toBe(1)
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
  const ready = async (api: ReturnType<typeof engine>, width = 1440, shippingOptions = [flat]) => {
    if (!preview) throw new Error('no browser')
    Object.assign(api.cart, { email: 'maya@example.com', shippingAddress: { name: 'Maya Chen', line1: '88 Neil Ave', line2: null, city: 'Columbus', region: 'OH', postalCode: '43215', country: 'US', phone: null }, shippingOptions, shippingOption: 'flat', checkoutStep: 'ship' })
    const context = await preview.open(api.answer, width)
    await context.addInitScript(() => localStorage.setItem('df-cart', 'tok'))
    const page = await context.newPage()
    await page.goto(`${previewOrigin}/checkout/`)
    return { context, page }
  }

  it('reopens a finished step with Change, prices each delivery, and offers no sign-in on a preview', async () => {
    // Two options, so the delivery step is the shopper's to choose; a sole one is skipped.
    const { context, page } = await ready(engine(), 1440, [flat, pickup])
    try {
      await page.getByRole('radio', { name: 'Cash on delivery' }).waitFor()
      expect(await page.getByRole('link', { name: 'Sign in' }).count()).toBe(0)
      await page.getByRole('button', { name: 'Change Delivery method' }).click()
      await page.getByRole('radio', { name: /Standard delivery\s+Free/ }).waitFor()
      await page.getByRole('radio', { name: /Collect in person/ }).waitFor()
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

  /** The order's page on its own, as a shopper lands on it from a provider or their email. */
  const orderPage = async (confirm: (asked: number) => unknown) => {
    if (!preview) throw new Error('no browser')
    const api = engine()
    let asked = 0
    const context = await preview.open((r) => (r.query.includes('confirmPayment') ? confirm(asked++) : api.answer(r)))
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`${previewOrigin}/order/o-1/`)
    return { context, page, errors }
  }
  const placed = { id: 'o-1', number: 'JC-1051', state: 'placed', paymentState: 'pending', paymentMethod: 'bank_transfer', placedAt: '2026-10-13T10:00:00.000Z', paymentDueBy: '2026-10-16T10:00:00.000Z', shippingMethod: 'Standard delivery', pricesIncludeTax: false, lines: [{ name: 'Organic Cotton Tee', versionName: 'Sand / M', quantity: 1, unitPrice: usd(2800), lineTotal: usd(2800) }], subtotal: usd(2800), discounts: [], shipping: usd(0), tax: usd(224), total: usd(3024) }

  it('gives an awaited bank transfer its reference, pay-by date and the store’s details, with the sealed summary', async () => {
    const { context, page, errors } = await orderPage(() => ({ data: { confirmPayment: placed } }))
    try {
      await page.getByRole('heading', { level: 1, name: 'Thank you' }).waitFor()
      await page.getByText('Waiting for your payment').waitFor()
      await page.getByRole('heading', { name: 'Pay by bank transfer' }).waitFor()
      await page.getByText(/Use your order number JC-1051 as the reference\. Pay by Friday, October 16/).waitFor()
      await page.getByText('Juniper & Co., IBAN TEST 0001').waitFor()
      await page.getByRole('heading', { name: 'Order JC-1051' }).waitFor()
      expect(await page.locator('[data-df-sealed="summary"]').count()).toBe(1)
      expect(errors).toEqual([])
    } finally {
      await context.close()
    }
  })

  it('says a card payment is still being confirmed, and Check again asks the provider again', async () => {
    const { context, page } = await orderPage((n) => ({ data: { confirmPayment: { ...placed, paymentMethod: 'razorpay', paymentDueBy: null, paymentState: n === 0 ? 'pending' : 'paid' } } }))
    try {
      await page.getByText('Confirming your payment').waitFor()
      await page.getByRole('button', { name: 'Check again' }).click()
      await page.getByText('Paid', { exact: true }).waitFor()
      expect(await page.getByRole('button', { name: 'Check again' }).count()).toBe(0)
    } finally {
      await context.close()
    }
  })

  it('says it can’t find an order the shopper can’t see, and offers Try again when it can’t load', async () => {
    const missing = await orderPage(() => ({ data: { confirmPayment: null } }))
    try {
      await missing.page.getByRole('heading', { level: 1, name: "We can't find this order" }).waitFor()
    } finally {
      await missing.context.close()
    }
    const failed = await orderPage((n) => (n === 0 ? { errors: [{ message: 'down', extensions: { code: 'UNAVAILABLE' } }] } : { data: { confirmPayment: { ...placed, paymentMethod: 'cod', paymentDueBy: null } } }))
    try {
      await failed.page.getByRole('heading', { level: 1, name: "We couldn't load your order" }).waitFor()
      await failed.page.getByRole('button', { name: 'Try again' }).click()
      await failed.page.getByRole('heading', { level: 1, name: 'Thank you' }).waitFor()
    } finally {
      await failed.context.close()
    }
  })

  it('takes a gift card at the payment step: says why one is refused (a wrong number, too many tries, a preview), shows one applied, and removes it', async () => {
    const { context, page } = await ready(engine())
    try {
      await page.getByLabel('Gift card number').waitFor()
      await page.getByLabel('Gift card number').fill('NOPE')
      await page.getByRole('button', { name: 'Apply' }).click()
      await page.getByText("That number doesn't match a gift card. Check it and try again.").waitFor()
      await page.getByLabel('Gift card number').fill('MANY')
      await page.getByRole('button', { name: 'Apply' }).click()
      await page.getByText('Too many tries. Wait a few minutes and try again.').waitFor()
      await page.getByLabel('Gift card number').fill('PREVIEW')
      await page.getByRole('button', { name: 'Apply' }).click()
      await page.getByText("Gift cards can't be used on a preview of the shop; they work on the live shop.").waitFor()
      await page.getByLabel('Gift card number').fill('GC12 3456 78')
      await page.getByRole('button', { name: 'Apply' }).click()
      await page.getByText('Your gift card ending 5678 is paying part of this order.').waitFor()
      await page.getByRole('button', { name: 'Remove' }).click()
      await page.getByLabel('Gift card number').waitFor()
    } finally {
      await context.close()
    }
  })

  it('gives a paid order its downloads, licence keys and a gift card’s recipient', async () => {
    const { context, page, errors } = await orderPage(() => ({ data: { confirmPayment: { ...placed, paymentState: 'paid', paymentMethod: 'stripe', paymentDueBy: null, lines: [{ name: 'Gift card', versionName: null, quantity: 1, unitPrice: usd(5000), lineTotal: usd(5000), gift: { recipientName: 'Asha', recipientEmail: 'asha@example.com', sendOn: null } }], downloads: [{ name: 'Pattern PDF', url: `${previewOrigin}/dl/abc`, usesLeft: 5, expiresAt: '2026-11-12T10:00:00.000Z' }], licenceKeys: [{ name: 'Font licence', key: 'AAAA-BBBB-CCCC' }] } } }))
    try {
      await page.getByRole('heading', { name: 'Your downloads' }).waitFor()
      expect(await page.getByRole('link', { name: 'Download Pattern PDF' }).getAttribute('href')).toBe(`${previewOrigin}/dl/abc`)
      await page.getByText(/5 downloads left, until Thursday, November 12/).waitFor()
      await page.getByText('AAAA-BBBB-CCCC').waitFor()
      await page.getByText("We've emailed the gift card to Asha, and sent you a copy.").waitFor()
      expect(errors).toEqual([])
    } finally {
      await context.close()
    }
  })
})
