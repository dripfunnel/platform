import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { basics, chrome, previewOrigin, startPreview, type Preview, type ShopRequest } from './test/preview'

// Card #859: the baseline theme's order page for an own-delivery order, in a browser against a Shop API the test answers: what a
// screen reader gets of the delivery steps and the handover code, which states show the rider and the code, and that nothing
// about the rider's position or arrival is asked for (api/DELIVERY.md §7, "On the website").
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

let preview: Preview | null = null
beforeAll(async () => {
  if (chrome) preview = await startPreview()
})
afterAll(async () => preview?.close())

const inr = (amount: number) => ({ amount: String(amount), currency: 'INR' })
const reached = [
  { state: 'packing', at: '2026-10-27T04:44:00Z' },
  { state: 'searching', at: '2026-10-27T05:01:00Z' },
  { state: 'assigned', at: '2026-10-27T05:03:00Z' },
  { state: 'picked_up', at: '2026-10-27T05:10:00Z' },
]
const rider = { firstName: 'Asha', phone: '+919700000001', vehicleType: 'scooter', vehicleNumber: 'RJ14 AB 1234' }
const deliveries: Record<string, unknown> = {
  packing: { state: 'packing', steps: reached.slice(0, 1), rider: null, handoverCode: null },
  assigned: { state: 'assigned', steps: reached.slice(0, 3), rider, handoverCode: '2580' },
  delivered: { state: 'delivered', steps: [...reached, { state: 'delivered', at: '2026-10-27T05:22:00Z' }], rider: null, handoverCode: null },
  failed: { state: 'failed', steps: [...reached, { state: 'failed', at: '2026-10-27T05:25:00Z' }], rider: null, handoverCode: null },
}

const order = (id: string) => ({
  id,
  number: '1051',
  state: 'placed',
  paymentState: 'pending',
  paymentMethod: 'cod',
  paymentDueBy: null,
  shippingMethod: null,
  placedAt: '2026-10-27T04:44:00Z',
  pricesIncludeTax: true,
  lines: [{ name: 'Organic Cotton Tee', versionName: 'Sand / M', quantity: 1, unitPrice: inr(149900), lineTotal: inr(149900) }],
  subtotal: inr(149900),
  discounts: [],
  shipping: inr(4900),
  tax: inr(7138),
  total: inr(154800),
  giftCard: inr(0),
  downloads: [],
  licenceKeys: [],
  delivery: deliveries[id] ?? null,
})

const visit = async (id: string) => {
  if (!preview) throw new Error('no browser')
  const asked: ShopRequest[] = []
  const context = await preview.open((r) => {
    asked.push(r)
    return r.query.includes('confirmPayment') ? { data: { confirmPayment: order(String(r.variables['orderId'])) } } : basics(r)
  })
  const page = await context.newPage()
  await page.goto(`${previewOrigin}/order/${id}/`)
  await page.getByRole('heading', { name: 'Delivery', exact: true }).waitFor()
  return { context, page, asked }
}

describe.skipIf(!chrome)('the baseline order page for an own-delivery order', () => {
  it('gives a screen reader the handover code as spaced digits, the rider, and a link to call, while a rider has the order', async () => {
    const { context, page } = await visit('assigned')
    try {
      // The digits are drawn for the eye and hidden from a screen reader, which reads the spaced words instead: "2 5 8 0", not "two thousand…".
      await page.getByText('Handover code 2 5 8 0').waitFor({ state: 'attached' })
      expect(await page.locator('[aria-hidden="true"]', { hasText: '2580' }).count()).toBe(1)
      expect(await page.getByText('Give this code to your rider', { exact: false }).count()).toBe(1)
      expect(await page.getByRole('link', { name: 'Call Asha' }).getAttribute('href')).toBe('tel:+919700000001')
      await page.getByText('Scooter · RJ14 AB 1234').waitFor()
    } finally {
      await context.close()
    }
  })

  it('says in words which steps are done, which is current and which are still to come, so colour is never the only sign', async () => {
    const { context, page } = await visit('assigned')
    try {
      const steps = page.getByRole('list', { name: 'Delivery steps' }).getByRole('listitem')
      const words = (await steps.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
      expect(words).toEqual([
        expect.stringMatching(/^Done Being packed/),
        expect.stringMatching(/^Done Looking for a rider/),
        expect.stringMatching(/^Current step Rider assigned/),
        'Still to come On the way',
        'Still to come Delivered',
      ])
      expect(await steps.nth(2).getAttribute('aria-current')).toBe('step')
    } finally {
      await context.close()
    }
  })

  it.each(['packing', 'delivered', 'failed'])('shows no rider, call link or code while the delivery is %s', async (id) => {
    const { context, page } = await visit(id)
    try {
      expect(await page.getByText('Your handover code').count()).toBe(0)
      expect(await page.getByText('Handover code', { exact: false }).count()).toBe(0)
      expect(await page.getByText('Your delivery partner').count()).toBe(0)
      expect(await page.getByRole('link', { name: /^Call/ }).count()).toBe(0)
    } finally {
      await context.close()
    }
  })

  it('marks where a failed delivery stopped, and asks the Shop API for no map, position or estimate', async () => {
    const { context, page, asked } = await visit('failed')
    try {
      const last = page.getByRole('list', { name: 'Delivery steps' }).getByRole('listitem').last()
      expect((await last.innerText()).replace(/\s+/g, ' ')).toMatch(/^Ended here Not delivered/)
      const orderQueries = asked.filter((r) => r.query.includes('confirmPayment'))
      expect(orderQueries.length).toBeGreaterThan(0)
      expect(asked.some((r) => /position|etaAt|latitude|longitude|photo/i.test(r.query))).toBe(false)
    } finally {
      await context.close()
    }
  })
})
