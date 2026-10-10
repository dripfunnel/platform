import { describe, expect, it } from 'vitest'
import type { Offer, OfferAction } from '../../api/offers'
import { messages } from '../../messages'
import { blankCondition, blankDraft, seasonCode, convertedMinor, convertedText, draftOf, endInstantOf, errorsOf, inputOf, instantOf, localOf, type StoreFacts } from './offerDraft'

// The editor's form and the record it saves (OFFERS-DESIGN §3.1): the store's time zone, money per currency, what each
// kind of offer sends, and what stops it saving.

const words = messages.offers.editor.errors
const india: StoreFacts = { timeZone: 'Asia/Kolkata', country: 'IN', main: 'INR', others: [], perEuro: {} }
const multi: StoreFacts = { timeZone: 'America/New_York', country: 'US', main: 'USD', others: ['EUR', 'JPY'], perEuro: { USD: 1.1, EUR: 1, JPY: 160 } }
const ctx = (facts: StoreFacts) => ({ facts, now: new Date('2026-10-10T06:30:00.000Z'), ship: 'delivery', season: { name: 'Diwali', on: new Date('2026-11-08T00:00:00.000Z') } })
const action = (a: Partial<OfferAction> & Pick<OfferAction, 'operation'>): OfferAction => ({ percent: null, amounts: [], cap: [], targets: null, exclude: null, buy: null, get: null, oncePerOrder: false, kind: null, tiers: [], ...a })
const base: Offer = { id: 'o1', name: 'Offer', internalName: null, description: null, trigger: 'automatic', code: null, status: 'off', enabled: false, startsAt: null, endsAt: null, totalUsesLimit: null, perCustomerLimit: null, usesCount: 0, combines: { product: false, order: false, shipping: false }, conditions: [], action: { percent: null, amounts: [], cap: [], targets: null, exclude: null, buy: null, get: null, oncePerOrder: false, kind: null, tiers: [], operation: 'free_shipping' }, revision: 1 }
const leaf = { amounts: [], minimum: null, productIds: [], collectionIds: [], filterValueIds: [], groupIds: [], customerIds: [], countries: [], days: [], from: null, to: null, conditions: [] }

describe('dates in the store’s time zone', () => {
  it('reads and writes the store’s wall clock, daylight saving included', () => {
    expect(instantOf('2026-10-12T09:00', 'Asia/Kolkata')).toBe('2026-10-12T03:30:00.000Z')
    expect(localOf('2026-10-12T03:30:00.000Z', 'Asia/Kolkata')).toBe('2026-10-12T09:00')
    expect(instantOf('2026-07-01T09:00', 'America/New_York')).toBe('2026-07-01T13:00:00.000Z')
    expect(instantOf('2026-12-01T09:00', 'America/New_York')).toBe('2026-12-01T14:00:00.000Z')
    expect(instantOf('not a date', 'UTC')).toBeNull()
  })

  it('moves a time the clocks skip on by the gap, and takes the first of a time they repeat', () => {
    expect(instantOf('2026-03-08T02:30', 'America/New_York')).toBe('2026-03-08T07:30:00.000Z')
    expect(localOf('2026-03-08T07:30:00.000Z', 'America/New_York')).toBe('2026-03-08T03:30')
    expect(instantOf('2026-11-01T01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z')
    expect(instantOf('2026-11-01T02:30', 'America/New_York')).toBe('2026-11-01T07:30:00.000Z')
  })

  it('ends a day ending at 23:59 at its last second (fact 9)', () => {
    expect(endInstantOf('2026-10-31T23:59', 'Asia/Kolkata')).toBe('2026-10-31T18:29:59.000Z')
    expect(endInstantOf('2026-10-31T18:00', 'Asia/Kolkata')).toBe('2026-10-31T12:30:00.000Z')
  })
})

describe('a new offer', () => {
  it('combines with nothing and is a code with once per customer, as §5 and #337 decide', () => {
    const d = blankDraft('order', null, ctx(india))
    expect(d).toMatchObject({ combines: { product: false, order: false, shipping: false }, trigger: 'code', perCustomer: '1', name: '10% off your order' })
    expect(blankDraft('shipping', null, ctx(india))).toMatchObject({ trigger: 'automatic', perCustomer: '', name: 'Free delivery' })
  })

  it('fills the form from a recipe for the merchant to adjust (V)', () => {
    expect(blankDraft('order', 'welcome', ctx(india))).toMatchObject({ code: 'WELCOME10', who: 'first', percent: '10' })
    expect(blankDraft('order', 'seasonal', ctx(india))).toMatchObject({ code: 'DIWALI20', name: 'Diwali 20% off', startsAt: '2026-11-01T00:00', endsAt: '2026-11-08T23:59' })
    expect(blankDraft('order', 'vip', ctx(india))).toMatchObject({ who: 'groups', code: 'VIP15' })
  })

  it('makes a valid seasonal code from an occasion named in any script', () => {
    expect(seasonCode('Diwali')).toBe('DIWALI20')
    expect(seasonCode('Singles’ Day')).toBe('SINGLESDAY20')
    expect(seasonCode('Noël')).toBe('NOEL20')
    for (const name of ['春节', 'Рождество', 'दिवाली', '!!!', '']) {
      const code = seasonCode(name)
      expect(code).toMatch(/^SALE[A-Z2-9]{4}20$/)
      expect(errorsOf({ ...blankDraft('order', null, ctx(india)), code }, india)).toEqual({})
    }
    expect(blankDraft('order', 'seasonal', { ...ctx(india), season: { name: '春节', on: new Date('2027-02-06T00:00:00.000Z') } }).code).toMatch(/^SALE[A-Z2-9]{4}20$/)
    expect(blankDraft('order', 'winBack', ctx(india))).toMatchObject({ who: 'customers', totalUses: '1' })
    expect(blankDraft('order', 'buy2get1', ctx(india)).type).toBe('bxgy')
  })
})

describe('what Save sends', () => {
  it('sends only each operation’s own arguments, amounts in minor units in every currency the store sells', () => {
    const d = { ...blankDraft('products', null, ctx(multi)), kind: 'fixed' as const, amounts: { USD: '5', JPY: '900' }, productIds: ['p1'], excludeGiftCards: true, minimum: 'amount' as const, minAmounts: { USD: '50' }, startsAt: '2026-11-27T00:00', endsAt: '2026-11-30T23:59' }
    const input = inputOf(d, multi, true)
    expect(input.action).toEqual({ operation: 'line_fixed_discount', amounts: [{ currency: 'USD', amount: '500' }, { currency: 'EUR', amount: '455' }, { currency: 'JPY', amount: '900' }], targets: { productIds: ['p1'], collectionIds: undefined, filterValueIds: undefined }, exclude: { giftCards: true, onSale: false } })
    expect(input.conditions).toEqual([{ operation: 'minimum_order_amount', amounts: [{ currency: 'USD', amount: '5000' }, { currency: 'EUR', amount: '4545' }, { currency: 'JPY', amount: '7273' }] }])
    expect(input).toMatchObject({ enabled: true, trigger: 'code', startsAt: '2026-11-27T05:00:00.000Z', endsAt: '2026-12-01T04:59:59.000Z', perCustomerLimit: 1, totalUsesLimit: null })
    expect(convertedText('5', multi, 'EUR')).toBe('4.55')
  })

  it('sends buy X get Y, tiers, a cap, groups and a weekly repeat as the engine reads them', () => {
    const bxgy = inputOf({ ...blankDraft('bxgy', null, ctx(india)), buyIds: ['p11'], getPercent: '50', oncePerOrder: true }, india, false)
    expect(bxgy.action).toEqual({ operation: 'buy_x_get_y', buy: { quantity: 2, targets: { productIds: ['p11'], collectionIds: undefined, filterValueIds: undefined } }, get: { quantity: 1, targets: undefined }, percent: 50, oncePerOrder: true })
    expect(bxgy.code).toBeNull()
    const tiers = inputOf({ ...blankDraft('order', null, ctx(india)), code: 'BIG', tiers: [{ off: '10', minimum: '500' }, { off: '15', minimum: '1000' }] }, india, true)
    expect(tiers.action).toEqual({ operation: 'tiered_discount', kind: 'percent', tiers: [{ minimum: [{ currency: 'INR', amount: '50000' }], percent: 10 }, { minimum: [{ currency: 'INR', amount: '100000' }], percent: 15 }] })
    const capped = inputOf({ ...blankDraft('order', null, ctx(india)), code: 'VIP', capOn: true, cap: '300', who: 'groups', groupIds: ['g1', 'g2'], repeat: { days: [6, 5], from: '17:00', to: '21:00' } }, india, true)
    expect(capped.action).toEqual({ operation: 'order_percentage_discount', percent: 10, cap: [{ currency: 'INR', amount: '30000' }] })
    expect(capped.conditions).toEqual([{ operation: 'customer_group', groupIds: ['g1', 'g2'] }, { operation: 'recurrence', days: [5, 6], from: '17:00', to: '21:00' }])
  })

  it('reads an offer back into the same form, keeping conditions the form doesn’t draw', () => {
    const offer: Offer = {
      id: 'o1',
      name: 'VIP 15% off',
      internalName: 'Q4',
      description: 'Our thank-you to regulars',
      trigger: 'code',
      code: 'VIP15',
      status: 'live',
      enabled: true,
      startsAt: '2026-10-12T03:30:00.000Z',
      endsAt: null,
      totalUsesLimit: 100,
      perCustomerLimit: 2,
      usesCount: 0,
      combines: { product: true, order: false, shipping: true },
      conditions: [
        { ...leaf, operation: 'customer_group', groupIds: ['g1'] },
        { ...leaf, operation: 'any_of', conditions: [{ ...leaf, operation: 'first_order' }, { ...leaf, operation: 'minimum_quantity', minimum: 3 }] },
      ],
      action: action({ operation: 'products_percentage_discount', percent: 15, targets: { productIds: [], collectionIds: ['c1'], filterValueIds: [] }, cap: [{ currency: 'INR', amount: '25000' }] }),
      revision: 4,
    }
    const d = draftOf(offer, india)
    expect(d).toMatchObject({ type: 'products', kind: 'percent', percent: '15', target: 'collection', collectionIds: ['c1'], capOn: true, cap: '250.00', who: 'groups', note: 'Q4', startsAt: '2026-10-12T09:00', totalUses: '100', perCustomer: '2' })
    const input = inputOf(d, india, true)
    expect(input.conditions).toEqual([{ operation: 'customer_group', groupIds: ['g1'] }, { operation: 'any_of', conditions: [{ operation: 'first_order' }, { operation: 'minimum_quantity', minimum: 3 }] }])
    expect(input.startsAt).toBe('2026-10-12T03:30:00.000Z')
  })
})

describe('money in other currencies', () => {
  it('converts on integer minor units, rounding a half up once', () => {
    const halves: StoreFacts = { ...multi, main: 'USD', others: ['EUR'], perEuro: { USD: 2, EUR: 1 } }
    expect(convertedMinor(3, halves, 'EUR')).toBe(2)
    expect(convertedMinor(1, halves, 'EUR')).toBe(1)
    expect(convertedMinor(2, halves, 'EUR')).toBe(1)
    expect(convertedText('0.03', halves, 'EUR')).toBe('0.02')
    expect(convertedMinor(500, multi, 'JPY')).toBe(727)
    expect(convertedMinor(500, { ...multi, perEuro: { USD: 1.1 } }, 'EUR')).toBeNull()
  })

  it('reads a fixed and a tiered offer back to the same input', () => {
    const fixed: Offer = { ...base, action: action({ operation: 'order_fixed_discount', amounts: [{ currency: 'USD', amount: '1000' }, { currency: 'EUR', amount: '900' }, { currency: 'JPY', amount: '1500' }] }), conditions: [{ ...leaf, operation: 'minimum_order_amount', amounts: [{ currency: 'USD', amount: '5000' }, { currency: 'EUR', amount: '4500' }, { currency: 'JPY', amount: '7500' }] }] }
    const d = draftOf(fixed, multi)
    expect(d).toMatchObject({ kind: 'fixed', amounts: { USD: '10.00', EUR: '9.00', JPY: '1500' }, minimum: 'amount', minAmounts: { USD: '50.00', EUR: '45.00', JPY: '7500' } })
    const back = inputOf(d, multi, true)
    expect(back.action).toEqual({ operation: 'order_fixed_discount', amounts: fixed.action.amounts })
    expect(back.conditions).toEqual([{ operation: 'minimum_order_amount', amounts: fixed.conditions[0]?.amounts }])
    const tiered: Offer = { ...base, action: action({ operation: 'tiered_discount', kind: 'fixed', tiers: [{ minimum: [{ currency: 'INR', amount: '50000' }], percent: null, amounts: [{ currency: 'INR', amount: '5000' }] }, { minimum: [{ currency: 'INR', amount: '100000' }], percent: null, amounts: [{ currency: 'INR', amount: '15000' }] }] }) }
    const t = draftOf(tiered, india)
    expect(t).toMatchObject({ type: 'order', kind: 'fixed', tiers: [{ off: '50.00', minimum: '500.00' }, { off: '150.00', minimum: '1000.00' }] })
    expect(inputOf(t, india, true).action).toEqual({ operation: 'tiered_discount', kind: 'fixed', tiers: [{ minimum: [{ currency: 'INR', amount: '50000' }], amounts: [{ currency: 'INR', amount: '5000' }] }, { minimum: [{ currency: 'INR', amount: '100000' }], amounts: [{ currency: 'INR', amount: '15000' }] }] })
  })

  it('keeps a cap’s and a step’s amounts in every currency while the main amount is unchanged', () => {
    const cap = [{ currency: 'USD', amount: '1200' }, { currency: 'EUR', amount: '1000' }, { currency: 'JPY', amount: '2000' }]
    const capped: Offer = { ...base, action: action({ operation: 'order_percentage_discount', percent: 20, cap }) }
    const d = draftOf(capped, multi)
    expect(inputOf(d, multi, true).action).toEqual({ operation: 'order_percentage_discount', percent: 20, cap })
    expect(inputOf({ ...d, cap: '15' }, multi, true).action).toEqual({ operation: 'order_percentage_discount', percent: 20, cap: [{ currency: 'USD', amount: '1500' }, { currency: 'EUR', amount: '1364' }, { currency: 'JPY', amount: '2182' }] })
    const steps = [
      { minimum: [{ currency: 'USD', amount: '5000' }, { currency: 'EUR', amount: '4000' }, { currency: 'JPY', amount: '9000' }], percent: 10, amounts: [] },
      { minimum: [{ currency: 'USD', amount: '9000' }, { currency: 'EUR', amount: '8000' }, { currency: 'JPY', amount: '15000' }], percent: 20, amounts: [] },
    ]
    const tiered = draftOf({ ...base, action: action({ operation: 'tiered_discount', kind: 'percent', tiers: steps }) }, multi)
    expect(inputOf(tiered, multi, true).action).toEqual({ operation: 'tiered_discount', kind: 'percent', tiers: steps.map((t) => ({ minimum: t.minimum, percent: t.percent })) })
  })

  it('keeps a second condition for a slot the form draws once, so an edit loses no restriction', () => {
    const conditions = [
      blankCondition({ operation: 'customer_group', groupIds: ['g1'] }),
      blankCondition({ operation: 'shipping_country', countries: ['IN'] }),
      blankCondition({ operation: 'minimum_order_amount', amounts: [{ currency: 'INR', amount: '99900' }] }),
      blankCondition({ operation: 'minimum_quantity', minimum: 3 }),
      blankCondition({ operation: 'recurrence', days: [5], from: '17:00', to: '21:00' }),
      blankCondition({ operation: 'recurrence', days: [6], from: '10:00', to: '12:00' }),
    ]
    const d = draftOf({ ...base, action: action({ operation: 'order_percentage_discount', percent: 10 }), conditions }, india)
    expect(d).toMatchObject({ who: 'groups', groupIds: ['g1'], minimum: 'amount', repeat: { days: [5], from: '17:00', to: '21:00' } })
    expect(d.kept.map((c) => c.operation)).toEqual(['shipping_country', 'minimum_quantity', 'recurrence'])
    expect(inputOf(d, india, true).conditions).toEqual([
      { operation: 'minimum_order_amount', amounts: [{ currency: 'INR', amount: '99900' }] },
      { operation: 'customer_group', groupIds: ['g1'] },
      { operation: 'recurrence', days: [5], from: '17:00', to: '21:00' },
      { operation: 'shipping_country', countries: ['IN'] },
      { operation: 'minimum_quantity', minimum: 3 },
      { operation: 'recurrence', days: [6], from: '10:00', to: '12:00' },
    ])
  })

  it('keeps a repeat without both times as it came, never giving it times the merchant didn’t set', () => {
    const allDay = blankCondition({ operation: 'recurrence', days: [5], from: null, to: null })
    const d = draftOf({ ...base, action: action({ operation: 'order_percentage_discount', percent: 10 }), conditions: [allDay] }, india)
    expect(d.repeat).toBeNull()
    expect(inputOf(d, india, true).conditions).toEqual([{ operation: 'recurrence', days: [5], from: null, to: null }])
  })

  it('keeps a “buys at least N” it can’t draw, as it came', () => {
    const these = { ...leaf, operation: 'contains_products', minimum: 2, productIds: ['p9'] }
    const onOrder = draftOf({ ...base, action: action({ operation: 'order_percentage_discount', percent: 10 }), conditions: [these] }, india)
    expect(onOrder.minimum).toBe('none')
    expect(inputOf(onOrder, india, true).conditions).toEqual([{ operation: 'contains_products', minimum: 2, productIds: ['p9'] }])
    const otherIds = draftOf({ ...base, action: action({ operation: 'products_percentage_discount', percent: 10, targets: { productIds: ['p1'], collectionIds: [], filterValueIds: [] } }), conditions: [these] }, india)
    expect(inputOf(otherIds, india, true).conditions).toEqual([{ operation: 'contains_products', minimum: 2, productIds: ['p9'] }])
    const drawn = draftOf({ ...base, action: action({ operation: 'products_percentage_discount', percent: 10, targets: { productIds: ['p9'], collectionIds: [], filterValueIds: [] } }), conditions: [these] }, india)
    expect(drawn).toMatchObject({ minimum: 'these', minQuantity: '2', kept: [] })
    expect(inputOf(drawn, india, true).conditions).toEqual([{ operation: 'contains_products', minimum: 2, productIds: ['p9'] }])
  })

  it('keeps the collections and filter values a buy X get Y names, which the form doesn’t draw', () => {
    const t = (x: Partial<OfferAction['targets'] & object>) => ({ productIds: [], collectionIds: [], filterValueIds: [], ...x })
    const bxgy: Offer = { ...base, action: action({ operation: 'buy_x_get_y', percent: 100, buy: { quantity: 2, targets: t({ productIds: ['p1'], collectionIds: ['c1'] }) }, get: { quantity: 1, targets: t({ filterValueIds: ['fv1'] }) } }) }
    const d = draftOf(bxgy, india)
    expect(errorsOf(d, india)).toEqual({})
    expect(inputOf(d, india, true).action).toEqual({ operation: 'buy_x_get_y', buy: { quantity: 2, targets: { productIds: ['p1'], collectionIds: ['c1'], filterValueIds: undefined } }, get: { quantity: 1, targets: { productIds: undefined, collectionIds: undefined, filterValueIds: ['fv1'] } }, percent: 100, oncePerOrder: false })
  })

  it('sends an offer’s description back as it came', () => {
    expect(inputOf(draftOf({ ...base, description: 'Thanks for coming back' }, india), india, true).description).toBe('Thanks for coming back')
    expect(inputOf(blankDraft('order', null, ctx(india)), india, true).description).toBeNull()
  })
})

describe('what stops it saving (C5)', () => {
  it('says each problem in plain words, within the API’s own limits', () => {
    const d = blankDraft('products', null, ctx(india))
    expect(errorsOf(d, india)).toEqual({ targets: words.products, code: words.codeMissing })
    expect(errorsOf({ ...d, percent: '120', code: 'a b', productIds: ['p1'] }, india)).toEqual({ value: words.percent, code: 'Use 3 to 32 letters, numbers, - or _. No spaces.' })
    expect(errorsOf({ ...d, productIds: ['p1'], code: 'SUMMER20', startsAt: '2026-10-12T09:00', endsAt: '2026-10-11T09:00' }, india)).toEqual({ ends: words.endsBefore })
    expect(errorsOf({ ...d, productIds: ['p1'], code: 'X1', singleUse: true, batch: { count: '9000', prefix: '', length: '8' } }, india)).toEqual({ batch: 'Make between 1 and 5,000 codes.' })
    expect(errorsOf({ ...d, productIds: ['p1'], code: 'OK1', who: 'groups', repeat: { days: [], from: '17:00', to: '21:00' }, totalUses: '0' }, india)).toEqual({ who: words.groups, repeat: words.repeatDays, total: words.total })
    expect(errorsOf({ ...blankDraft('order', null, ctx(india)), code: 'OK1', tiers: [{ off: '10', minimum: '500' }] }, india)).toEqual({ tiers: 'Give between 2 and 5 steps.' })
    const perCustomer = 'Uses per customer must be a whole number from 1 to 1,000, or Unlimited.'
    for (const typed of ['abc', '1.5', '-1', '0', '5000']) expect(errorsOf({ ...blankDraft('order', null, ctx(india)), code: 'OK1', perCustomer: typed }, india)).toEqual({ perCustomer })
    expect(errorsOf({ ...blankDraft('order', null, ctx(india)), code: 'OK1', perCustomer: '' }, india)).toEqual({})
  })

  it('won’t leave a currency without an amount when there’s no rate to convert it', () => {
    const noEur: StoreFacts = { ...multi, perEuro: { USD: 1.1, JPY: 160 } }
    const order = { ...blankDraft('order', null, ctx(noEur)), code: 'OK1' }
    const noRate = 'There’s no exchange rate for EUR today, so it can’t be converted: type the amount in each of them.'
    expect(errorsOf({ ...order, kind: 'fixed', amounts: { USD: '10' } }, noEur)).toEqual({ value: noRate })
    expect(errorsOf({ ...order, kind: 'fixed', amounts: { USD: '10', EUR: '9' } }, noEur)).toEqual({})
    expect(errorsOf({ ...order, minimum: 'amount', minAmounts: { USD: '50' } }, noEur)).toEqual({ minimum: noRate })
    expect(errorsOf({ ...order, capOn: true, cap: '30' }, noEur)).toEqual({ cap: noRate })
    expect(errorsOf({ ...order, tiers: [{ off: '10', minimum: '50' }, { off: '15', minimum: '100' }] }, noEur)).toEqual({ tiers: noRate })
  })

  it('checks every kind of offer’s own fields, and every currency’s box', () => {
    const order = { ...blankDraft('order', null, ctx(multi)), code: 'OK1' }
    expect(errorsOf({ ...order, kind: 'fixed', amounts: {} }, multi)).toEqual({ value: words.amount })
    expect(errorsOf({ ...order, kind: 'fixed', amounts: { USD: '10', EUR: 'abc' } }, multi)).toEqual({ value: words.otherAmount })
    expect(errorsOf({ ...order, kind: 'fixed', amounts: { USD: '10', JPY: '0' } }, multi)).toEqual({ value: words.otherAmount })
    expect(errorsOf({ ...order, kind: 'fixed', amounts: { USD: '10', EUR: '' } }, multi)).toEqual({})
    expect(errorsOf({ ...order, minimum: 'amount', minAmounts: { USD: '0' } }, multi)).toEqual({ minimum: words.minimumAmount })
    expect(errorsOf({ ...order, minimum: 'amount', minAmounts: { USD: '50', EUR: '-5' } }, multi)).toEqual({ minimum: words.otherAmount })
    expect(errorsOf({ ...order, minimum: 'items', minQuantity: '0' }, multi)).toEqual({ minimum: 'Enter how many items, from 1 to 999.' })
    const ship = blankDraft('shipping', null, ctx(multi))
    expect(errorsOf(ship, multi)).toEqual({})
    expect(errorsOf({ ...ship, shipMode: 'off', amounts: { USD: '' } }, multi)).toEqual({ value: words.amount })
    expect(errorsOf({ ...ship, shipMode: 'off', amounts: { USD: '5', EUR: 'x' } }, multi)).toEqual({ value: words.otherAmount })
    const bxgy = blankDraft('bxgy', null, ctx(multi))
    expect(errorsOf(bxgy, multi)).toEqual({ buy: words.buy })
    expect(errorsOf({ ...bxgy, buyIds: ['p1'], getSame: false }, multi)).toEqual({ get: words.get })
    expect(errorsOf({ ...bxgy, buyIds: ['p1'], buyQuantity: '100' }, multi)).toEqual({ value: 'Use whole numbers from 1 to 99.' })
    expect(errorsOf({ ...bxgy, buyIds: ['p1'], getPercent: '0' }, multi)).toEqual({ value: words.percent })
  })
})
