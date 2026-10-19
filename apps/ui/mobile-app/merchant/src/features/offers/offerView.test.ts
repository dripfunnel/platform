import type { Offer } from '../../api/offers'
import { blankAction, blankCondition, noTargets } from './offerDraft'
import { kindOf, noNames, regionWords, sentence, statusKeyOf, timeLine, whatText } from './offerView'
import { offersAccessOf } from './access'

const now = new Date('2026-10-12T06:00:00.000Z')
const zone = 'Asia/Kolkata'
const hours = (n: number) => new Date(now.getTime() + n * 3_600_000).toISOString()
const inr = (amount: string) => ({ amount, currency: 'INR' })
const india = regionWords('IN')

const offer = (over: Partial<Offer>): Offer => ({
  id: 'o-1',
  name: 'Offer',
  internalName: null,
  description: null,
  trigger: 'automatic',
  code: null,
  status: 'live',
  enabled: true,
  startsAt: null,
  endsAt: null,
  totalUsesLimit: null,
  perCustomerLimit: null,
  usesCount: 0,
  combines: { product: false, order: false, shipping: false },
  conditions: [],
  action: blankAction({ operation: 'free_shipping' }),
  revision: 1,
  ...over,
})

describe('the status an offer shows', () => {
  it('is the API’s status, except that a live offer ending within 48 hours is Ending soon', () => {
    expect(statusKeyOf(offer({ endsAt: hours(47) }), now)).toBe('ending')
    expect(statusKeyOf(offer({ endsAt: hours(49) }), now)).toBe('live')
    expect(statusKeyOf(offer({ status: 'off', endsAt: hours(1) }), now)).toBe('off')
    expect(statusKeyOf(offer({ status: 'used_up' }), now)).toBe('used_up')
  })

  it('says when it ends, started, starts, or how much is used, in the store’s zone', () => {
    expect(timeLine(offer({ endsAt: hours(100) }), now, zone)).toMatch(/^Ends .*Oct/)
    expect(timeLine(offer({}), now, zone)).toBe('No end date')
    expect(timeLine(offer({ endsAt: hours(5) }), now, zone)).toMatch(/^Ends in 5 h/)
    expect(timeLine(offer({ status: 'scheduled', startsAt: hours(72) }), now, zone)).toMatch(/^Starts in 3 days/)
    expect(timeLine(offer({ status: 'used_up', usesCount: 50, totalUsesLimit: 50 }), now, zone)).toBe('50 of 50 used')
    expect(timeLine(offer({ status: 'off', enabled: false }), now, zone)).toBe('Turned off')
    expect(timeLine(offer({ conditions: [blankCondition({ operation: 'recurrence', days: [5], from: '17:00', to: '21:00' })] }), now, zone)).toBe('Repeats Fri, 17:00–21:00')
  })
})

describe('how a row and the summary word an offer', () => {
  const names = { ...noNames, filterValues: new Map([['fv-1', 'Fabric: Linen']]), groups: new Map([['g-1', 'VIP']]) }

  it('names its kind from its action', () => {
    expect(kindOf({ operation: 'line_fixed_discount' })).toBe('products')
    expect(kindOf({ operation: 'tiered_discount' })).toBe('order')
    expect(kindOf({ operation: 'buy_x_get_y' })).toBe('bxgy')
    expect(kindOf({ operation: 'shipping_fixed_discount' })).toBe('shipping')
  })

  it('says what a row gives, short', () => {
    const products = offer({ action: blankAction({ operation: 'products_percentage_discount', percent: 20, targets: { ...noTargets, filterValueIds: ['fv-1'] } }) })
    const shipping = offer({ conditions: [blankCondition({ operation: 'minimum_order_amount', amounts: [inr('99900')] })] })

    expect(whatText(products, india, names)).toBe('20% off · Fabric: Linen')
    expect(whatText(shipping, india, names)).toBe('Free delivery · over ₹999.00')
    expect(whatText(offer({ action: blankAction({ operation: 'buy_x_get_y', percent: 100, buy: { quantity: 2, targets: null }, get: { quantity: 1, targets: null } }) }), india, names)).toBe('Buy 2, get 1 free')
  })

  it('says it in the US’s words for shipping and the region’s word for a code', () => {
    expect(whatText(offer({}), regionWords('US'), names)).toBe('Free shipping')
    expect(regionWords('DE').code).toBe('voucher code')
    expect(regionWords('IN').code).toBe('coupon code')
  })

  it('tells the whole offer in one sentence', () => {
    const welcome = offer({
      trigger: 'code',
      code: 'WELCOME10',
      perCustomerLimit: 1,
      conditions: [blankCondition({ operation: 'first_order' }), blankCondition({ operation: 'minimum_order_amount', amounts: [inr('99900')] })],
      action: blankAction({ operation: 'order_percentage_discount', percent: 10 }),
    })

    expect(sentence(welcome, india, names, now, zone)).toBe('10% off the whole order · code WELCOME10 · first order only · orders of ₹999.00 or more · no end date · once per customer · doesn’t combine with other offers')
  })

  it('says what it combines with when it combines with something', () => {
    expect(sentence(offer({ combines: { product: true, order: false, shipping: true } }), india, names, now, zone)).toContain('doesn’t combine with other order offers')
  })
})

describe('who may do what with offers', () => {
  const read = { permissions: ['offers.read'], supplier: false }

  it('lets the Owner and a Manager change them and get codes, and Staff only look', () => {
    expect(offersAccessOf({ permissions: ['offers.read', 'offers.write', 'offers.export'], supplier: false }, false)).toEqual({ canRead: true, canEdit: true, canExport: true, viewOnly: false, readOnly: false })
    expect(offersAccessOf(read, false)).toEqual({ canRead: true, canEdit: false, canExport: false, viewOnly: true, readOnly: false })
  })

  it('stops changes, but not looking or getting codes, while the store is read-only', () => {
    expect(offersAccessOf({ permissions: ['offers.read', 'offers.write', 'offers.export'], supplier: false }, true)).toMatchObject({ canRead: true, canEdit: false, canExport: true, readOnly: true, viewOnly: false })
  })

  it('gives a supplier nothing, whatever its permissions list says', () => {
    expect(offersAccessOf({ permissions: ['offers.read', 'offers.write'], supplier: true }, false)).toMatchObject({ canRead: false, canEdit: false, canExport: false })
  })
})
