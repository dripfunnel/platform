import { describe, expect, it } from 'vitest'
import type { Offer, OfferAction } from '../../api/offers'
import { messages } from '../../messages'
import { actsFor } from './offerActions'
import { checkWords } from './CodeCheck'
import { kindOf, regionWords, statusKeyOf, timeLine, whatText, type OfferNames } from './offerView'

// How an offer is worded (OFFERS-DESIGN §3 fact 9, B2, §1): status, time line and the row's words.

const now = new Date('2026-10-10T06:30:00.000Z')
const zone = 'Asia/Kolkata'
const india = regionWords('IN')
const names: OfferNames = { collections: new Map([['c1', 'Summer']]), filterValues: new Map([['fv1', 'Fabric: Linen']]), groups: new Map([['g1', 'VIP'], ['g2', 'Wholesale']]) }
const action = (a: Partial<OfferAction> & Pick<OfferAction, 'operation'>): OfferAction => ({ percent: null, amounts: [], cap: [], targets: null, exclude: null, buy: null, get: null, oncePerOrder: false, kind: null, tiers: [], ...a })
const leaf = { amounts: [], minimum: null, productIds: [], collectionIds: [], filterValueIds: [], groupIds: [], customerIds: [], countries: [], days: [], from: null, to: null, conditions: [] }
const offer = (o: Partial<Offer>): Offer => ({
  id: 'o1',
  name: 'Welcome 10% off',
  internalName: null,
  trigger: 'code',
  code: 'WELCOME10',
  status: 'live',
  enabled: true,
  startsAt: null,
  endsAt: null,
  totalUsesLimit: null,
  perCustomerLimit: null,
  usesCount: 0,
  combines: { product: false, order: false, shipping: false },
  conditions: [],
  action: action({ operation: 'order_percentage_discount', percent: 10 }),
  revision: 1,
  ...o,
})
const inr = (amount: string) => [{ amount, currency: 'INR' }]

describe('an offer’s status', () => {
  it('reads Ending soon from a live offer’s end within 48 hours, and keeps every other status the API gives', () => {
    expect(statusKeyOf(offer({ endsAt: '2026-10-11T18:00:00.000Z' }), now)).toBe('ending')
    expect(statusKeyOf(offer({ endsAt: '2026-10-13T18:00:00.000Z' }), now)).toBe('live')
    expect(statusKeyOf(offer({ status: 'scheduled', endsAt: '2026-10-11T00:00:00.000Z' }), now)).toBe('scheduled')
    expect(statusKeyOf(offer({ status: 'used_up' }), now)).toBe('used_up')
  })

  it('words the time line in the store’s time zone', () => {
    expect(timeLine(offer({ endsAt: '2026-10-11T18:29:00.000Z' }), now, zone)).toBe('Ends in 36 h · Sun, Oct 11, 23:59')
    expect(timeLine(offer({ status: 'scheduled', startsAt: '2026-10-13T03:30:00.000Z' }), now, zone)).toBe('Starts in 3 days · Tue, Oct 13, 09:00')
    expect(timeLine(offer({ status: 'used_up', usesCount: 50, totalUsesLimit: 50 }), now, zone)).toBe('50 of 50 used')
    expect(timeLine(offer({ status: 'off', enabled: false, endsAt: '2026-10-01T00:00:00.000Z' }), now, zone)).toBe('Off · end date passed Oct 1')
    expect(timeLine(offer({ conditions: [{ ...leaf, operation: 'recurrence', days: [5, 6], from: '17:00', to: '21:00' }] }), now, zone)).toBe('Repeats Fri and Sat, 17:00–21:00')
  })
})

describe('what an offer gives, in words', () => {
  it('names its type from the action', () => {
    expect(['line_fixed_discount', 'tiered_discount', 'buy_x_get_y', 'shipping_fixed_discount'].map((operation) => kindOf({ operation }))).toEqual(['products', 'order', 'bxgy', 'shipping'])
  })

  it('words a row from the API’s amounts and the store’s own names, counting what it can’t name', () => {
    expect(whatText(offer({ action: action({ operation: 'products_percentage_discount', percent: 20, targets: { productIds: ['p1', 'p2'], collectionIds: [], filterValueIds: ['fv1'] } }) }), india, names)).toBe('20% off · 2 products and Fabric: Linen')
    expect(whatText(offer({ action: action({ operation: 'free_shipping' }), conditions: [{ ...leaf, operation: 'minimum_order_amount', amounts: inr('99900') }] }), india, names)).toBe('Free delivery · over ₹999.00')
    expect(whatText(offer({ action: action({ operation: 'free_shipping' }) }), regionWords('US'), names)).toBe('Free shipping')
    expect(whatText(offer({ conditions: [{ ...leaf, operation: 'customer_group', groupIds: ['g1', 'g2'] }] }), india, names)).toBe('10% off the order · VIP or Wholesale')
    expect(whatText(offer({ action: action({ operation: 'buy_x_get_y', percent: 50, buy: { quantity: 2, targets: null }, get: { quantity: 1, targets: null } }) }), india, names)).toBe('Buy 2, get 1 half price')
  })
})

describe('what can be done to an offer', () => {
  it('offers Turn on only to one that is off and not past its end, and End only before it has ended', () => {
    expect(actsFor(offer({}), now)).toEqual(['off', 'end', 'duplicate', 'delete'])
    expect(actsFor(offer({ status: 'off', enabled: false }), now)).toEqual(['on', 'end', 'duplicate', 'delete'])
    expect(actsFor(offer({ status: 'off', enabled: false, endsAt: '2026-10-01T00:00:00.000Z' }), now)).toEqual(['duplicate', 'delete'])
    expect(actsFor(offer({ status: 'used_up' }), now)).toEqual(['off', 'duplicate', 'delete'])
  })
})

describe('Check a code', () => {
  const w = messages.offers.check
  it('says what a shopper typing it meets, from the API’s answer', () => {
    expect(checkWords('SUMMER20', null, zone, now)).toMatchObject({ title: 'SUMMER20 isn’t one of your codes.', tone: 'danger' })
    expect(checkWords('X', { code: 'OLD', offer: null, deleted: true, singleUse: false, usedAt: null, expiresAt: null, answer: 'INVALID' }, zone, now)).toMatchObject({ title: 'OLD was deleted.', body: w.deletedBody })
    const works = checkWords('X', { code: 'WELCOME10', offer: offer({ perCustomerLimit: 1, conditions: [{ ...leaf, operation: 'minimum_order_amount', amounts: inr('99900') }] }), deleted: false, singleUse: false, usedAt: null, expiresAt: null, answer: 'WORKS' }, zone, now)
    expect(works).toEqual({ title: 'WELCOME10 works now.', body: 'Welcome 10% off. Each shopper can use it once. Needs an order of ₹999.00 or more.', tone: 'success' })
    const used = checkWords('X', { code: 'INSTA-K7QX', offer: offer({ code: null }), deleted: false, singleUse: true, usedAt: '2026-10-09T05:00:00.000Z', expiresAt: null, answer: 'USED_UP' }, zone, now)
    expect(used.body).toBe('Welcome 10% off. This single-use code was used Fri, Oct 9, 10:30.')
    expect(checkWords('X', { code: 'DIWALI15', offer: offer({ status: 'scheduled', startsAt: '2026-10-13T03:30:00.000Z' }), deleted: false, singleUse: false, usedAt: null, expiresAt: null, answer: 'INVALID' }, zone, now).title).toBe('DIWALI15 doesn’t work yet.')
  })
})
