import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { basics, chrome, previewOrigin, startPreview, type Preview, type ShopRequest } from './test/preview'

// Card #324: the baseline theme's gift card, download and service pages in preview mode.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const usd = (cents: number) => ({ amount: String(cents), currency: 'USD' })
const productOf = (extra: Record<string, unknown>) => ({ id: 'p1', name: 'Gift card', slug: 'gift-card', productType: 'gift_card', giftCard: { expiryMonths: 12 }, download: null, service: null, description: null, highlights: [], inStock: true, price: usd(5000), compareAt: null, maxPrice: null, badges: [], photos: [], video: null, options: [], versions: [{ id: 'g50', name: null, choices: [], price: usd(5000), compareAt: null, inStock: true, available: null }], specs: [], faqs: [], compliance: [], returns: null, warranty: null, seoTitle: null, seoDescription: null, related: [], ...extra })
const cart = { id: 'c1', currency: 'USD', email: null, phone: null, note: null, needsShipping: false, checkoutStep: 'contact', problems: [], readyToPay: false, deliverable: null, shippingOption: null, lines: [], subtotal: usd(0), discount: null, discounts: [], codes: [], shipping: null, shippingDiscount: null, tax: null, total: usd(0), amountDue: usd(0), giftCard: null, shippingAddress: null, billingAddress: null, shippingOptions: [] }

const answer = (product: unknown, asked: ShopRequest[]) => (r: ShopRequest): unknown => {
  asked.push(r)
  if (r.query.startsWith('query Product')) return { data: { product, store: { marketId: 'm', markets: [{ id: 'm', countries: ['US'] }] } } }
  if (r.query.includes('addToCart(')) return { data: { addToCart: { cartToken: 't', cart } } }
  return basics(r)
}

let preview: Preview | null = null
beforeAll(async () => {
  if (chrome) preview = await startPreview()
})
afterAll(async () => preview?.close())

describe.skipIf(!chrome)('the baseline theme’s product kinds', () => {
  it('sells a gift card only once it has a recipient’s name and a real email, says why until then, and sends the recipient', async () => {
    if (!preview) throw new Error('no browser')
    const asked: ShopRequest[] = []
    const context = await preview.open(answer(productOf({}), asked), 390)
    try {
      const page = await context.newPage()
      await page.goto(`${previewOrigin}/products/gift-card/`)
      const add = page.getByRole('button', { name: 'Add gift card to cart' })
      await add.waitFor()
      expect(await page.getByRole('button', { name: 'Buy now' }).count()).toBe(0)
      expect(await add.isDisabled()).toBe(true)
      const why = await add.getAttribute('aria-describedby')
      expect(await page.locator(`[id="${why}"]`).textContent()).toBe("Add the recipient's name and email to add this gift card.")
      await page.getByLabel("Recipient's name").fill('Asha')
      await page.getByLabel("Recipient's email").fill('a@b')
      expect(await add.isDisabled()).toBe(true)
      await page.getByLabel("Recipient's email").fill('asha@example.com')
      await page.getByText(/It can be used for 12 months after it's sent/).waitFor()
      expect(await add.isDisabled()).toBe(false)
      expect(await add.getAttribute('aria-describedby')).toBeNull()
      await add.click()
      await page.getByText('Added to your cart.').waitFor()
      expect(asked.find((r) => r.query.includes('addToCart('))?.variables).toEqual({ versionId: 'g50', quantity: 1, gift: { recipientName: 'Asha', recipientEmail: 'asha@example.com', sendOn: null, message: null } })
    } finally {
      await context.close()
    }
  })

  it('says what a download and a service give, and sells them as any product', async () => {
    if (!preview) throw new Error('no browser')
    const context = await preview.open(answer(productOf({ name: 'Pattern', productType: 'digital', giftCard: null, download: { days: 30, limit: 5 } }), []))
    try {
      const page = await context.newPage()
      await page.goto(`${previewOrigin}/products/gift-card/`)
      await page.getByText('A download: 5 downloads within 30 days of paying.').waitFor()
      expect(await page.getByRole('button', { name: 'Add to cart' }).isDisabled()).toBe(false)
      expect(await page.getByRole('button', { name: 'Buy now' }).count()).toBe(1)
    } finally {
      await context.close()
    }
    const service = await preview.open(answer(productOf({ name: 'Fitting', productType: 'service', giftCard: null, service: { duration: '45 minutes', location: 'At our studio' } }), []))
    try {
      const page = await service.newPage()
      await page.goto(`${previewOrigin}/products/gift-card/`)
      await page.getByText('45 minutes · At our studio').waitFor()
    } finally {
      await service.close()
    }
  })
})
