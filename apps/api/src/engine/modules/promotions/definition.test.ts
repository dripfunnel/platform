import { describe, expect, it } from 'vitest'
import { localTimeIn, namedIds, needsGroupOffers, normaliseCode, offerSchema, parseAction, parseCondition, statusOf, toStored, type OfferInput } from './definition'

const p1 = '11111111-1111-4111-8111-111111111111'
const g1 = '22222222-2222-4222-8222-222222222222'

const base: OfferInput = {
  name: ' Summer 20% off ',
  internalName: '',
  description: null,
  trigger: 'code',
  code: ' summer20 ',
  enabled: true,
  startsAt: null,
  endsAt: null,
  totalUsesLimit: null,
  perCustomerLimit: 1,
  combines: { product: false, order: false, shipping: false },
  conditions: [],
  action: { operation: 'order_percentage_discount', percent: 20 },
}

describe('an offer’s definition (OFFERS fact 1)', () => {
  it('trims, upper-cases the code (#337) and defaults what the form leaves out', () => {
    const o = offerSchema.parse(base)
    expect([o.name, o.internalName, o.code]).toEqual(['Summer 20% off', null, 'SUMMER20'])
    expect(o.action).toEqual({ operation: 'order_percentage_discount', percent: 20, cap: null })
  })

  it('refuses a malformed code, a code on an automatic offer, ends before starts and percentages outside 1–100', () => {
    expect(offerSchema.safeParse({ ...base, code: 'no spaces' }).success).toBe(false)
    expect(offerSchema.safeParse({ ...base, code: 'AB' }).success).toBe(false)
    expect(offerSchema.safeParse({ ...base, trigger: 'automatic' }).success).toBe(false)
    expect(offerSchema.safeParse({ ...base, trigger: 'automatic', code: null }).success).toBe(true)
    expect(offerSchema.safeParse({ ...base, startsAt: new Date('2026-10-02'), endsAt: new Date('2026-10-01') }).success).toBe(false)
    expect(offerSchema.safeParse({ ...base, action: { operation: 'order_percentage_discount', percent: 0 } }).success).toBe(false)
    expect(offerSchema.safeParse({ ...base, action: { operation: 'order_percentage_discount', percent: 101 } }).success).toBe(false)
  })

  it('holds a fixed amount to one value per currency, in minor units (fact 10)', () => {
    expect(parseAction({ operation: 'order_fixed_discount', amounts: { INR: '50000', USD: '600' } })).toEqual({ operation: 'order_fixed_discount', amounts: { INR: 50000n, USD: 600n } })
    expect(parseAction({ operation: 'order_fixed_discount', amounts: {} })).toBeNull()
    expect(parseAction({ operation: 'order_fixed_discount', amounts: { INR: '0' } })).toBeNull()
    expect(parseAction({ operation: 'order_fixed_discount', amounts: { XYZ: '100' } })).toBeNull()
    expect(parseAction({ operation: 'order_fixed_discount', amounts: { INR: '12.50' } })).toBeNull()
  })

  it('needs something to discount, and stores amounts back as strings', () => {
    expect(parseAction({ operation: 'products_percentage_discount', percent: 10, targets: {} })).toBeNull()
    const a = parseAction({ operation: 'line_fixed_discount', amounts: { INR: '500' }, targets: { productIds: [p1.toUpperCase(), p1] } })
    expect(a).toEqual({ operation: 'line_fixed_discount', amounts: { INR: 500n }, targets: { productIds: [p1], collectionIds: [], filterValueIds: [] }, exclude: { giftCards: false, onSale: false } })
    expect(a && toStored(a)).toMatchObject({ amounts: { INR: '500' } })
  })

  it('takes OR only as any_of over plain conditions, and a repeat window that runs forwards', () => {
    expect(parseCondition({ operation: 'any_of', conditions: [{ operation: 'first_order' }, { operation: 'customer_group', groupIds: [g1] }] })).not.toBeNull()
    expect(parseCondition({ operation: 'any_of', conditions: [{ operation: 'first_order' }] })).toBeNull()
    expect(parseCondition({ operation: 'any_of', conditions: [{ operation: 'first_order' }, { operation: 'any_of', conditions: [] }] })).toBeNull()
    expect(parseCondition({ operation: 'recurrence', days: [5], from: '17:00', to: '19:00' })).not.toBeNull()
    expect(parseCondition({ operation: 'recurrence', days: [5, 5], from: '17:00', to: '19:00' })).toBeNull()
    expect(parseCondition({ operation: 'recurrence', days: [5], from: '19:00', to: '17:00' })).toBeNull()
    expect(parseCondition({ operation: 'shipping_country', countries: ['in', 'IND'] })).toBeNull()
    expect(parseCondition({ operation: 'shipping_country', countries: ['in'] })).toEqual({ operation: 'shipping_country', countries: ['IN'] })
  })

  it('names the plan switch for groups, chosen customers and tiers, and every id it points at', () => {
    const o = offerSchema.parse(base)
    expect(needsGroupOffers(o)).toBe(false)
    expect(needsGroupOffers({ ...o, conditions: [{ operation: 'any_of', conditions: [{ operation: 'first_order' }, { operation: 'customer_group', groupIds: [g1] }] }] })).toBe(true)
    const tiers = parseAction({ operation: 'tiered_discount', kind: 'percent', tiers: [{ minimum: { INR: '5000' }, percent: 10 }, { minimum: { INR: '10000' }, percent: 15 }] })
    expect(tiers && needsGroupOffers({ conditions: [], action: tiers })).toBe(true)
    expect(parseAction({ operation: 'tiered_discount', kind: 'percent', tiers: [{ minimum: { INR: '5000' }, amounts: { INR: '100' } }, { minimum: { INR: '10000' }, percent: 15 }] })).toBeNull()
    const bxgy = parseAction({ operation: 'buy_x_get_y', buy: { quantity: 2, targets: { productIds: [p1] } }, get: { quantity: 1 } })
    expect(bxgy && namedIds({ conditions: [{ operation: 'customer_group', groupIds: [g1] }], action: bxgy })).toMatchObject({ products: [p1], groups: [g1] })
  })

  it('normalises codes to uppercase and refuses anything else', () => {
    expect(normaliseCode(' diwali-15 ')).toBe('DIWALI-15')
    expect(normaliseCode('-NOPE')).toBeNull()
    expect(normaliseCode('A'.repeat(33))).toBeNull()
    expect(normaliseCode('ÜBER10')).toBeNull()
  })
})

describe('status, derived and never stored (fact 9)', () => {
  const now = new Date('2026-10-10T12:00:00Z')
  const o = { enabled: true, startsAt: null, endsAt: null, usesCount: 0, totalUsesLimit: null }
  it('reads off, then ended, then used up, then scheduled, else live', () => {
    expect(statusOf(o, now)).toBe('live')
    expect(statusOf({ ...o, enabled: false, endsAt: new Date('2026-10-01') }, now)).toBe('off')
    expect(statusOf({ ...o, endsAt: now, totalUsesLimit: 1, usesCount: 1 }, now)).toBe('ended')
    expect(statusOf({ ...o, totalUsesLimit: 5, usesCount: 5, startsAt: new Date('2026-11-01') }, now)).toBe('used_up')
    expect(statusOf({ ...o, startsAt: new Date('2026-11-01') }, now)).toBe('scheduled')
  })

  it('reads the store’s own day and time for a repeating window', () => {
    // 12:00 UTC on a Saturday is 17:30 that Saturday in India and 08:00 in New York.
    expect(localTimeIn(now, 'Asia/Kolkata')).toEqual({ day: 6, minutes: 17 * 60 + 30 })
    expect(localTimeIn(now, 'America/New_York')).toEqual({ day: 6, minutes: 8 * 60 })
    expect(localTimeIn(new Date('2026-10-10T20:00:00Z'), 'Asia/Tokyo')).toEqual({ day: 0, minutes: 5 * 60 })
  })
})
