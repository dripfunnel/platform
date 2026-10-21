import { describe, expect, it } from 'vitest'
import { parseAction, parseCondition, type Action, type Combines, type Condition } from './definition'
import { priceOffers, type PricingInput, type PricingLine, type PricingOffer } from './pricing'

const shirt = 'a0000000-0000-4000-8000-000000000001'
const socks = 'a0000000-0000-4000-8000-000000000002'
const card = 'a0000000-0000-4000-8000-000000000003'
const summer = 'c0000000-0000-4000-8000-000000000001'
const linen = 'f0000000-0000-4000-8000-000000000001'
const vip = 'b0000000-0000-4000-8000-000000000001'

const line = (id: string, productId: string, quantity: number, unit: bigint, o: Partial<PricingLine> = {}): PricingLine => ({
  id, productId, quantity, amount: unit * BigInt(quantity), collectionIds: [], filterValueIds: [], giftCard: false, onSale: false, ...o,
})
const action = (raw: unknown): Action => {
  const a = parseAction(raw)
  if (!a) throw new Error(`bad action ${JSON.stringify(raw)}`)
  return a
}
const condition = (raw: unknown): Condition => {
  const c = parseCondition(raw)
  if (!c) throw new Error(`bad condition ${JSON.stringify(raw)}`)
  return c
}
const all: Combines = { product: true, order: true, shipping: true }
let n = 0
const offer = (raw: unknown, o: Partial<PricingOffer> = {}): PricingOffer => {
  n += 1
  return { id: `offer-${String(n).padStart(2, '0')}`, name: `Offer ${n}`, codeId: null, createdAt: new Date(2026, 0, n), conditions: [], action: action(raw), combines: { product: false, order: false, shipping: false }, ...o }
}
const cart = (offers: PricingOffer[], o: Partial<PricingInput> = {}): PricingInput => ({
  currency: 'INR',
  lines: [line('l1', shirt, 2, 400000n, { collectionIds: [summer], filterValueIds: [linen] }), line('l2', socks, 3, 30000n)],
  shipping: 9900n,
  shopper: { customerId: null, groupIds: [], firstOrder: false, country: 'IN' },
  local: { day: 5, minutes: 18 * 60 },
  offers,
  ...o,
})
const off = (input: PricingInput) => {
  const r = priceOffers(input)
  return { lines: Object.fromEntries(r.lineDiscounts), shipping: r.shippingDiscount, total: r.discount, applied: r.applied.map((a) => a.offerId), notApplied: r.notApplied }
}

describe('what each kind of offer takes off (OFFERS fact 4)', () => {
  it('a percentage off the order is spread over the lines and sums exactly', () => {
    const r = off(cart([offer({ operation: 'order_percentage_discount', percent: 10 })]))
    // 10% of ₹8,900.00 is ₹890.00: ₹800 from the shirts, ₹90 from the socks.
    expect(r.lines).toEqual({ l1: 80000n, l2: 9000n })
    expect(r.total).toBe(89000n)
  })

  it('a fixed amount off the order never takes it below nothing, in the cart’s own currency only (fact 10)', () => {
    expect(off(cart([offer({ operation: 'order_fixed_discount', amounts: { INR: '100000000' } })])).total).toBe(890000n)
    expect(off(cart([offer({ operation: 'order_fixed_discount', amounts: { USD: '1000' } })])).notApplied).toEqual([{ offerId: expect.any(String), reason: 'NOTHING_TO_DISCOUNT' }])
  })

  it('a percentage off chosen products, by product, collection or filter value, with exclusions and a cap', () => {
    expect(off(cart([offer({ operation: 'products_percentage_discount', percent: 20, targets: { collectionIds: [summer] } })])).lines).toEqual({ l1: 160000n, l2: 0n })
    expect(off(cart([offer({ operation: 'products_percentage_discount', percent: 20, targets: { filterValueIds: [linen] }, cap: { INR: '50000' } })])).lines).toEqual({ l1: 50000n, l2: 0n })
    const sale = cart([offer({ operation: 'products_percentage_discount', percent: 50, targets: { productIds: [shirt, card] }, exclude: { giftCards: true, onSale: true } })], {
      lines: [line('l1', shirt, 1, 1000n, { onSale: true }), line('l3', card, 1, 5000n, { giftCard: true })],
    })
    expect(off(sale).total).toBe(0n)
  })

  it('a fixed amount off products is per unit (#337), never more than the line', () => {
    expect(off(cart([offer({ operation: 'line_fixed_discount', amounts: { INR: '50000' }, targets: { productIds: [shirt, socks] } })])).lines).toEqual({ l1: 100000n, l2: 90000n })
  })

  it('free shipping removes all of it; a fixed amount off shipping only up to what it costs; nothing before one is chosen', () => {
    expect(off(cart([offer({ operation: 'free_shipping' })])).shipping).toBe(9900n)
    expect(off(cart([offer({ operation: 'shipping_fixed_discount', amounts: { INR: '20000' } })])).shipping).toBe(9900n)
    expect(off(cart([offer({ operation: 'shipping_fixed_discount', amounts: { INR: '5000' } })])).shipping).toBe(5000n)
    expect(off(cart([offer({ operation: 'free_shipping' })], { shipping: null })).notApplied[0]?.reason).toBe('NOTHING_TO_DISCOUNT')
  })

  it('buy X get Y frees the cheapest qualifying units, once per set unless once per order (#337)', () => {
    const lines = [line('a', socks, 3, 30000n), line('c', shirt, 3, 50000n)]
    const mixed = cart([offer({ operation: 'buy_x_get_y', buy: { quantity: 2, targets: { productIds: [socks, shirt] } }, get: { quantity: 1 } })], { lines })
    // Six units, sets of three: two free, both of them socks, the cheapest.
    expect(off(mixed).lines).toEqual({ a: 60000n, c: 0n })
    const once = cart([offer({ operation: 'buy_x_get_y', buy: { quantity: 2, targets: { productIds: [socks, shirt] } }, get: { quantity: 1 }, oncePerOrder: true })], { lines })
    expect(off(once).lines).toEqual({ a: 30000n, c: 0n })
    const half = cart([offer({ operation: 'buy_x_get_y', buy: { quantity: 1, targets: { productIds: [shirt] } }, get: { quantity: 1, targets: { productIds: [socks] } }, percent: 50 })], { lines })
    expect(off(half).lines).toEqual({ a: 45000n, c: 0n })
  })

  it('a tiered offer takes the highest step reached', () => {
    const tiers = { operation: 'tiered_discount', kind: 'percent', tiers: [{ minimum: { INR: '500000' }, percent: 10 }, { minimum: { INR: '800000' }, percent: 15 }, { minimum: { INR: '2000000' }, percent: 30 }] }
    expect(off(cart([offer(tiers)])).total).toBe(133500n)
    expect(off(cart([offer(tiers)], { lines: [line('l2', socks, 1, 30000n)] })).total).toBe(0n)
  })
})

describe('conditions, all of them, or any of an any_of (fact 2)', () => {
  const pct = { operation: 'order_percentage_discount', percent: 10 }
  it('compares a minimum with the order total in the cart’s currency', () => {
    expect(off(cart([offer(pct, { conditions: [condition({ operation: 'minimum_order_amount', amounts: { INR: '890000' } })] })])).total).toBe(89000n)
    expect(off(cart([offer(pct, { conditions: [condition({ operation: 'minimum_order_amount', amounts: { INR: '890001' } })] })])).notApplied[0]?.reason).toBe('CONDITIONS')
    expect(off(cart([offer(pct, { conditions: [condition({ operation: 'minimum_order_amount', amounts: { USD: '1' } })] })])).total).toBe(0n)
  })

  it('counts units of what they must buy, and knows who the shopper is', () => {
    expect(off(cart([offer(pct, { conditions: [condition({ operation: 'minimum_quantity', minimum: 5 })] })])).total).toBe(89000n)
    expect(off(cart([offer(pct, { conditions: [condition({ operation: 'contains_products', minimum: 3, productIds: [shirt] })] })])).total).toBe(0n)
    expect(off(cart([offer(pct, { conditions: [condition({ operation: 'contains_collection', minimum: 2, collectionIds: [summer] })] })])).total).toBe(89000n)
    expect(off(cart([offer(pct, { conditions: [condition({ operation: 'customer_group', groupIds: [vip] })] })])).total).toBe(0n)
    const member = { customerId: 'c1', groupIds: [vip], firstOrder: true, country: 'IN' }
    expect(off(cart([offer(pct, { conditions: [condition({ operation: 'customer_group', groupIds: [vip] }), condition({ operation: 'first_order' })] })], { shopper: member })).total).toBe(89000n)
    expect(off(cart([offer(pct, { conditions: [condition({ operation: 'shipping_country', countries: ['US'] })] })])).total).toBe(0n)
  })

  it('any_of holds when one of its conditions does; a repeat window in the store’s own time', () => {
    const either = condition({ operation: 'any_of', conditions: [{ operation: 'customer_group', groupIds: [vip] }, { operation: 'minimum_quantity', minimum: 5 }] })
    expect(off(cart([offer(pct, { conditions: [either] })])).total).toBe(89000n)
    const friday = condition({ operation: 'recurrence', days: [5], from: '17:00', to: '19:00' })
    expect(off(cart([offer(pct, { conditions: [friday] })])).total).toBe(89000n)
    expect(off(cart([offer(pct, { conditions: [friday] })], { local: { day: 5, minutes: 19 * 60 } })).total).toBe(0n)
  })
})

describe('combining, in the fixed order (fact 7, #337)', () => {
  it('runs product, then order, then shipping offers, each on what is left', () => {
    const r = off(cart([
      offer({ operation: 'order_percentage_discount', percent: 10 }, { combines: all }),
      offer({ operation: 'products_percentage_discount', percent: 50, targets: { productIds: [socks] } }, { combines: all }),
      offer({ operation: 'free_shipping' }, { combines: all }),
    ]))
    // Socks ₹900 → ₹450; then 10% of ₹8,450 is ₹845; then delivery is free.
    expect(r.total).toBe(45000n + 84500n + 9900n)
    expect(r.applied).toEqual(['offer-' + String(n - 1).padStart(2, '0'), 'offer-' + String(n - 2).padStart(2, '0'), 'offer-' + String(n).padStart(2, '0')])
  })

  it('takes the bigger of two that don’t combine, and says why the other didn’t apply', () => {
    const small = offer({ operation: 'order_percentage_discount', percent: 5 })
    const big = offer({ operation: 'order_fixed_discount', amounts: { INR: '100000' } })
    const r = off(cart([small, big]))
    expect(r.applied).toEqual([big.id])
    expect(r.notApplied).toEqual([{ offerId: small.id, reason: 'DOESNT_COMBINE' }])
    // Whatever order they arrive in.
    expect(off(cart([big, small])).applied).toEqual([big.id])
  })

  it('needs both sides to combine: a new offer combines with nothing by default', () => {
    const shipping = offer({ operation: 'free_shipping' })
    const order = offer({ operation: 'order_percentage_discount', percent: 10 }, { combines: all })
    expect(off(cart([order, shipping])).applied).toEqual([order.id])
    const shippingOk = offer({ operation: 'free_shipping' }, { combines: { product: false, order: true, shipping: false } })
    expect(off(cart([order, shippingOk])).applied).toEqual([order.id, shippingOk.id])
  })

  it('stacks two product offers that combine with each other, the second on the reduced price', () => {
    const a = offer({ operation: 'products_percentage_discount', percent: 20, targets: { productIds: [shirt] } }, { combines: all })
    const b = offer({ operation: 'products_percentage_discount', percent: 30, targets: { productIds: [shirt] } }, { combines: all })
    // 30% of ₹8,000 is ₹2,400, then 20% of ₹5,600 is ₹1,120: 44% off, not 50%.
    expect(off(cart([a, b])).lines).toEqual({ l1: 352000n, l2: 0n })
  })
})
