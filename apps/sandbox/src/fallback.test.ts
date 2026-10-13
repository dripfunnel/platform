import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { baselineTheme, basics, chrome, previewOrigin, startPreview, type Preview, type ShopRequest } from './test/preview'

// Card #313: a theme whose checkout throws hands the shopper to core's baseline checkout for the rest of the visit
// (ARCHITECTURE §2.1 `checkout`, §3.3), which still takes the order.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const usd = (cents: number) => ({ amount: String(cents), currency: 'USD' })
const cart = { id: 'c1', currency: 'USD', email: 'maya@example.com', phone: null, note: null, needsShipping: true, checkoutStep: 'pay', problems: [], readyToPay: true, deliverable: true, shippingOption: 'flat', lines: [{ versionId: 'v1', quantity: 1, productName: 'Organic Cotton Tee', productSlug: 'organic-cotton-tee', versionName: 'Sand / M', photoUrl: null, unitPrice: usd(2800), lineTotal: usd(2800), discount: null, available: 5, problem: null }], subtotal: usd(2800), discount: null, discounts: [], codes: [], shipping: usd(0), shippingDiscount: null, tax: null, total: usd(2800), amountDue: usd(2800), shippingAddress: { name: 'Maya Chen', line1: '88 Neil Ave', line2: null, city: 'Columbus', region: 'OH', postalCode: '43215', country: 'US', phone: null }, billingAddress: null, shippingOptions: [{ id: 'flat', provider: null, service: null, amount: usd(0), before: null, minDays: 3, maxDays: 5, hours: null }] }
const answer = (asked: ShopRequest[]) => (r: ShopRequest): unknown => {
  asked.push(r)
  if (r.query.startsWith('query Cart')) return { data: { cart } }
  if (r.query.includes('paymentOptions')) return { data: { paymentOptions: [{ provider: 'cod', kind: 'cod', instructions: null, mode: 'test', publicKey: null }], store: { markets: [{ id: 'm', countries: ['US'] }] } } }
  if (r.query.includes('checkout {')) return { data: { checkout: cart } }
  if (r.query.includes('placeOrder')) return { data: { placeOrder: { orderId: 'o-1', total: usd(2800), instructions: null, payment: null } } }
  return basics(r)
}

let root = ''
let preview: Preview | null = null
beforeAll(async () => {
  if (!chrome) return
  root = mkdtempSync(join(tmpdir(), 'broken-checkout-'))
  cpSync(baselineTheme, root, { recursive: true })
  writeFileSync(join(root, 'src/theme/pages/CheckoutPage.tsx'), "export const CheckoutPage = () => {\n  throw new Error('This theme broke its checkout.')\n}\n")
  preview = await startPreview(root)
})
afterAll(async () => {
  await preview?.close()
  if (root) rmSync(root, { recursive: true, force: true })
})

describe.skipIf(!chrome)('a theme checkout that throws', () => {
  it('hands the shopper to the baseline checkout, which takes the order and is kept for the visit', async () => {
    if (!preview) throw new Error('no browser')
    const asked: ShopRequest[] = []
    const context = await preview.open(answer(asked), 390)
    await context.addInitScript(() => localStorage.setItem('df-cart', 'tok'))
    const page = await context.newPage()
    try {
      await page.goto(`${previewOrigin}/checkout/`)
      await page.getByText('Secure checkout').waitFor()
      await page.getByRole('heading', { level: 1, name: 'Checkout' }).waitFor()
      expect(asked.filter((r) => r.query.includes('reportStorefrontProblem')).map((r) => r.variables['kind'])).toContain('CHECKOUT')
      await page.getByRole('radio', { name: 'Cash on delivery' }).click()
      await page.getByRole('button', { name: 'Continue' }).click()
      await page.getByRole('button', { name: 'Place order' }).click()
      await page.waitForURL(`${previewOrigin}/order/o-1/`)
      expect(asked.filter((r) => r.query.includes('placeOrder')).map((r) => r.variables)).toEqual([{ provider: 'cod' }])
      await page.goto(`${previewOrigin}/checkout/`)
      await page.getByText('Secure checkout').waitFor()
      expect(await page.evaluate(() => sessionStorage.getItem('df-baseline-checkout'))).toBe('1')
    } finally {
      await context.close()
    }
  })
})
