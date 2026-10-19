import type { Offer } from '../../api/offers'
import { blankAction, blankCondition, blankDraft, convertedMinor, draftOf, endInstantOf, errorsOf, inputOf, instantOf, localOf, noTargets, type OfferDraft, type StoreFacts } from './offerDraft'

const facts: StoreFacts = { timeZone: 'Asia/Kolkata', country: 'IN', main: 'INR', others: [], perEuro: {} }
const twoCurrencies: StoreFacts = { ...facts, others: ['USD'], perEuro: { INR: 90, USD: 1.1 } }

const named = (draft: OfferDraft, patch: Partial<OfferDraft> = {}): OfferDraft => ({ ...draft, name: 'Test offer', ...patch })
const inr = (amount: string) => ({ amount, currency: 'INR' })

describe('what each kind of form sends the API', () => {
  it('money off products by a filter value: a whole percent, only the targets it names, nothing left out by default', () => {
    const draft = named(blankDraft('products', 'delivery'), { percent: '20', target: 'filter', filterValueIds: ['fv-1'], code: 'linen20' })

    expect(inputOf(draft, facts, true)).toEqual({
      name: 'Test offer',
      internalName: null,
      trigger: 'code',
      code: 'LINEN20',
      startsAt: null,
      endsAt: null,
      totalUsesLimit: null,
      perCustomerLimit: 1,
      combines: { product: false, order: false, shipping: false },
      description: null,
      enabled: true,
      conditions: [],
      action: { operation: 'products_percentage_discount', percent: 20, targets: { productIds: undefined, collectionIds: undefined, filterValueIds: ['fv-1'] }, exclude: { giftCards: false, onSale: false }, cap: undefined },
    })
  })

  it('money off products by a fixed amount each: minor units in the main currency, the others converted at the reference rate', () => {
    const draft = named(blankDraft('products', 'delivery'), { kind: 'fixed', amounts: { INR: '100' }, target: 'products', productIds: ['p-1', 'p-2'], excludeOnSale: true })

    expect(inputOf(draft, twoCurrencies, true).action).toEqual({
      operation: 'line_fixed_discount',
      amounts: [
        { currency: 'INR', amount: '10000' },
        { currency: 'USD', amount: '122' },
      ],
      targets: { productIds: ['p-1', 'p-2'], collectionIds: undefined, filterValueIds: undefined },
      exclude: { giftCards: false, onSale: true },
    })
  })

  it('keeps an amount typed in another currency instead of converting it', () => {
    const draft = named(blankDraft('products', 'delivery'), { kind: 'fixed', amounts: { INR: '100', USD: '2.5' }, productIds: ['p-1'] })

    expect(inputOf(draft, twoCurrencies, true).action).toMatchObject({ amounts: [inr('10000'), { currency: 'USD', amount: '250' }] })
  })

  it('money off the order with a cap, a minimum, a customer group and dates on the store’s own clock', () => {
    const draft = named(blankDraft('order', 'delivery'), {
      percent: '15',
      capOn: true,
      cap: '500',
      minimum: 'amount',
      minAmounts: { INR: '999' },
      who: 'groups',
      groupIds: ['g-1'],
      code: 'VIP15',
      startsAt: '2026-10-12T09:00',
      endsAt: '2026-10-14T23:59',
      totalUses: '100',
      perCustomer: '2',
      combines: { product: true, order: false, shipping: true },
    })

    expect(inputOf(draft, facts, false)).toMatchObject({
      enabled: false,
      startsAt: '2026-10-12T03:30:00.000Z',
      endsAt: '2026-10-14T18:29:59.000Z',
      totalUsesLimit: 100,
      perCustomerLimit: 2,
      combines: { product: true, order: false, shipping: true },
      conditions: [
        { operation: 'minimum_order_amount', amounts: [inr('99900')] },
        { operation: 'customer_group', groupIds: ['g-1'] },
      ],
      action: { operation: 'order_percentage_discount', percent: 15, cap: [inr('50000')] },
    })
  })

  it('money off the order by steps: each step’s minimum, and its percent or its amounts, not both', () => {
    const percent = named(blankDraft('order', 'delivery'), { tiers: [{ off: '10', minimum: '1000' }, { off: '15', minimum: '2000' }], code: 'BIGGER' })
    const fixed = { ...percent, kind: 'fixed' as const, tiers: [{ off: '100', minimum: '1000' }, { off: '250', minimum: '2000' }] }

    expect(inputOf(percent, facts, true).action).toEqual({
      operation: 'tiered_discount',
      kind: 'percent',
      tiers: [
        { minimum: [inr('100000')], percent: 10 },
        { minimum: [inr('200000')], percent: 15 },
      ],
    })
    expect(inputOf(fixed, facts, true).action).toEqual({
      operation: 'tiered_discount',
      kind: 'fixed',
      tiers: [
        { minimum: [inr('100000')], amounts: [inr('10000')] },
        { minimum: [inr('200000')], amounts: [inr('25000')] },
      ],
    })
  })

  it('buy X get Y: what is bought, what is got (the same, or other products), how much off, once per order', () => {
    const same = named(blankDraft('bxgy', 'delivery'), { buyQuantity: '2', getQuantity: '1', buyIds: ['p-socks'], getPercent: '100', oncePerOrder: true })
    const other = { ...same, getSame: false, getIds: ['p-hat'], getPercent: '50', oncePerOrder: false }

    expect(inputOf(same, facts, true)).toMatchObject({
      trigger: 'automatic',
      action: { operation: 'buy_x_get_y', buy: { quantity: 2, targets: { productIds: ['p-socks'], collectionIds: undefined, filterValueIds: undefined } }, get: { quantity: 1, targets: undefined }, percent: 100, oncePerOrder: true },
    })
    expect(inputOf(other, facts, true).action).toMatchObject({ get: { quantity: 1, targets: { productIds: ['p-hat'] } }, percent: 50, oncePerOrder: false })
  })

  it('free delivery, or money off delivery, with a minimum order', () => {
    const free = named(blankDraft('shipping', 'delivery'), { minimum: 'amount', minAmounts: { INR: '999' } })
    const off = { ...free, shipMode: 'off' as const, amounts: { INR: '50' } }

    expect(inputOf(free, facts, true)).toMatchObject({ action: { operation: 'free_shipping' }, conditions: [{ operation: 'minimum_order_amount', amounts: [inr('99900')] }] })
    expect(inputOf(off, facts, true).action).toEqual({ operation: 'shipping_fixed_discount', amounts: [inr('5000')] })
  })

  it('a code offer with single-use codes has no shared code, and a number of items or of these products as its minimum', () => {
    const single = named(blankDraft('products', 'delivery'), { singleUse: true, code: 'IGNORED', productIds: ['p-1'], minimum: 'these', minQuantity: '3' })

    expect(inputOf(single, facts, true)).toMatchObject({ code: null, trigger: 'code', conditions: [{ operation: 'contains_products', minimum: 3, productIds: ['p-1'] }] })
    expect(inputOf({ ...single, minimum: 'items' }, facts, true).conditions).toEqual([{ operation: 'minimum_quantity', minimum: 3 }])
  })

  it('who it is for: first order, specific customers or one market, and a weekly repeat', () => {
    const first = named(blankDraft('order', 'delivery'), { code: 'WELCOME', who: 'first', repeat: { days: [5, 1], from: '17:00', to: '21:00' } })

    expect(inputOf(first, facts, true).conditions).toEqual([{ operation: 'first_order' }, { operation: 'recurrence', days: [1, 5], from: '17:00', to: '21:00' }])
    expect(inputOf({ ...first, who: 'customers', customerIds: ['c-1'] }, facts, true).conditions[0]).toEqual({ operation: 'specific_customers', customerIds: ['c-1'] })
    expect(inputOf({ ...first, who: 'market', countries: ['IN', 'LK'] }, facts, true).conditions[0]).toEqual({ operation: 'shipping_country', countries: ['IN', 'LK'] })
  })
})

describe('opening an offer the API holds', () => {
  const stored = (over: Partial<Offer>): Offer => ({
    id: 'o-1',
    name: 'Stored',
    internalName: 'Team note',
    description: 'Kept as it was',
    trigger: 'code',
    code: 'STORED10',
    status: 'live',
    enabled: true,
    startsAt: '2026-10-12T03:30:00.000Z',
    endsAt: null,
    totalUsesLimit: null,
    perCustomerLimit: 1,
    usesCount: 4,
    combines: { product: false, order: true, shipping: false },
    conditions: [],
    action: blankAction({ operation: 'order_percentage_discount', percent: 10 }),
    revision: 3,
    ...over,
  })

  it('reads each field back into the form and sends the same offer when nothing changed', () => {
    const offer = stored({
      conditions: [blankCondition({ operation: 'minimum_order_amount', amounts: [inr('99900')] }), blankCondition({ operation: 'customer_group', groupIds: ['g-1'] })],
      action: blankAction({ operation: 'products_percentage_discount', percent: 20, targets: { ...noTargets, collectionIds: ['c-1'] }, exclude: { giftCards: true, onSale: false }, cap: [inr('50000')] }),
    })
    const draft = draftOf(offer, facts)

    expect(draft).toMatchObject({ type: 'products', percent: '20', target: 'collection', collectionIds: ['c-1'], excludeGiftCards: true, capOn: true, cap: '500.00', minimum: 'amount', minAmounts: { INR: '999.00' }, who: 'groups', code: 'STORED10', note: 'Team note', startsAt: '2026-10-12T09:00' })
    expect(inputOf(draft, facts, true)).toMatchObject({
      code: 'STORED10',
      internalName: 'Team note',
      description: 'Kept as it was',
      startsAt: '2026-10-12T03:30:00.000Z',
      conditions: [{ operation: 'minimum_order_amount', amounts: [inr('99900')] }, { operation: 'customer_group', groupIds: ['g-1'] }],
      action: { operation: 'products_percentage_discount', percent: 20, cap: [inr('50000')] },
    })
  })

  it('keeps a condition the form does not draw, and a second one of a kind it does, so an edit loses no restriction', () => {
    const anyOf = blankCondition({ operation: 'any_of', conditions: [blankCondition({ operation: 'first_order' }), blankCondition({ operation: 'customer_group', groupIds: ['g-9'] })] })
    const second = blankCondition({ operation: 'minimum_quantity', minimum: 2 })
    const offer = stored({ conditions: [blankCondition({ operation: 'minimum_order_amount', amounts: [inr('99900')] }), second, anyOf] })

    const sent = inputOf(draftOf(offer, facts), facts, true).conditions
    expect(sent).toEqual([
      { operation: 'minimum_order_amount', amounts: [inr('99900')] },
      { operation: 'minimum_quantity', minimum: 2 },
      { operation: 'any_of', conditions: [{ operation: 'first_order' }, { operation: 'customer_group', groupIds: ['g-9'] }] },
    ])
  })

  it('reads a code offer without a code as single-use codes', () => {
    expect(draftOf(stored({ code: null }), facts)).toMatchObject({ trigger: 'code', singleUse: true })
  })
})

describe('the store’s own clock', () => {
  it('turns a wall-clock time into the instant and back, in the store’s zone', () => {
    expect(instantOf('2026-10-12T09:00', 'Asia/Kolkata')).toBe('2026-10-12T03:30:00.000Z')
    expect(localOf('2026-10-12T03:30:00.000Z', 'Asia/Kolkata')).toBe('2026-10-12T09:00')
  })

  it('refuses a date the calendar does not have, and half a date', () => {
    expect(instantOf('2026-02-31T09:00', 'Asia/Kolkata')).toBeNull()
    expect(instantOf('2026-10T', 'Asia/Kolkata')).toBeNull()
  })

  it('moves a time the clocks skip on by the gap, and takes the first of a time they repeat', () => {
    expect(instantOf('2026-03-08T02:30', 'America/New_York')).toBe('2026-03-08T07:30:00.000Z')
    expect(instantOf('2026-11-01T01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z')
  })

  it('ends a day at its last second when the end is 23:59', () => {
    expect(endInstantOf('2026-10-14T23:59', 'Asia/Kolkata')).toBe('2026-10-14T18:29:59.000Z')
    expect(endInstantOf('2026-10-14T18:00', 'Asia/Kolkata')).toBe('2026-10-14T12:30:00.000Z')
  })

  it('converts the main currency at the reference rate, half up, and not when a rate is missing', () => {
    expect(convertedMinor(10000, twoCurrencies, 'USD')).toBe(122)
    expect(convertedMinor(10000, { ...twoCurrencies, perEuro: { INR: 90 } }, 'USD')).toBeNull()
  })
})

describe('what the form says is wrong before the API refuses', () => {
  const ok = named(blankDraft('order', 'delivery'), { code: 'SUMMER20' })

  it('accepts a complete form', () => {
    expect(errorsOf(ok, facts)).toEqual({})
  })

  it('wants a name, a percentage from 1 to 100, and a code of the right shape', () => {
    expect(errorsOf({ ...ok, name: ' ' }, facts).name).toBe('Add the name shoppers see.')
    expect(errorsOf({ ...ok, percent: '101' }, facts).value).toBe('Percentage must be between 1 and 100.')
    expect(errorsOf({ ...ok, percent: '' }, facts).value).toBe('Percentage must be between 1 and 100.')
    expect(errorsOf({ ...ok, code: '' }, facts).code).toBe('Type a code or generate one.')
    expect(errorsOf({ ...ok, code: 'a b' }, facts).code).toContain('letters, numbers')
  })

  it('wants an amount above zero for a fixed discount, in the main currency and any other typed', () => {
    const fixed = { ...ok, kind: 'fixed' as const, amounts: { INR: '' } }
    expect(errorsOf(fixed, facts).value).toBe('Enter an amount above zero.')
    expect(errorsOf({ ...fixed, amounts: { INR: '100' } }, facts)).toEqual({})
    expect(errorsOf({ ...fixed, amounts: { INR: '999999999999999.99' } }, facts).value).toBe('Enter an amount above zero.')
    expect(errorsOf({ ...fixed, amounts: { INR: '100', USD: '0' } }, twoCurrencies).value).toContain('other currency')
    expect(errorsOf({ ...fixed, amounts: { INR: '100' } }, { ...twoCurrencies, perEuro: { INR: 90 } }).value).toContain('USD')
  })

  it('wants targets for a products offer, what to buy and get for buy X get Y, and steps within 2 to 5', () => {
    const products = named(blankDraft('products', 'delivery'), { code: 'SUMMER20' })
    expect(errorsOf(products, facts).targets).toBe('Choose at least one product.')
    expect(errorsOf({ ...products, target: 'filter' }, facts).targets).toBe('Choose a filter value.')
    expect(errorsOf({ ...products, target: 'collection' }, facts).targets).toBe('Choose a collection.')
    const bxgy = named(blankDraft('bxgy', 'delivery'))
    expect(errorsOf(bxgy, facts).buy).toBe('Choose what the shopper must buy.')
    expect(errorsOf({ ...bxgy, buyIds: ['p'], getSame: false }, facts).get).toBe('Choose what the shopper gets.')
    expect(errorsOf({ ...ok, tiers: [{ off: '10', minimum: '100' }] }, facts).tiers).toBe('Give between 2 and 5 steps.')
    expect(errorsOf({ ...ok, tiers: [{ off: '10', minimum: '100' }, { off: '', minimum: '200' }] }, facts).tiers).toBe('Give every step a discount and an order total above zero.')
  })

  it('wants the batch of single-use codes within the API’s limits', () => {
    const single = { ...ok, singleUse: true, code: '' }
    expect(errorsOf(single, facts)).toEqual({})
    expect(errorsOf({ ...single, batch: { count: '5001', prefix: '', length: '8' } }, facts).batch).toContain('Make between 1 and')
    expect(errorsOf({ ...single, batch: { count: '10', prefix: 'no spaces', length: '8' } }, facts).batch).toContain('up to 12 letters')
  })

  it('wants a whole date, an end after the start, a repeat that makes sense, and limits that are whole numbers', () => {
    expect(errorsOf({ ...ok, startsAt: '2026-10-12T' }, facts).ends).toBe('Enter a whole date and time.')
    expect(errorsOf({ ...ok, startsAt: '2026-10-14T09:00', endsAt: '2026-10-12T23:59' }, facts).ends).toBe('End date is before the start date.')
    expect(errorsOf({ ...ok, repeat: { days: [], from: '17:00', to: '21:00' } }, facts).repeat).toBe('Pick at least one day for the repeat.')
    expect(errorsOf({ ...ok, repeat: { days: [5], from: '9:00', to: '21:00' } }, facts).repeat).toContain('24-hour')
    expect(errorsOf({ ...ok, repeat: { days: [5], from: '21:00', to: '17:00' } }, facts).repeat).toBe('The repeat must end after it starts.')
    expect(errorsOf({ ...ok, totalUses: '0' }, facts).total).toBe('Enter 1 or more, or choose Unlimited.')
    expect(errorsOf({ ...ok, perCustomer: '1.5' }, facts).perCustomer).toContain('whole number')
  })

  it('wants who it is for, once chosen', () => {
    expect(errorsOf({ ...ok, who: 'groups' }, facts).who).toBe('Choose at least one customer group.')
    expect(errorsOf({ ...ok, who: 'customers' }, facts).who).toBe('Choose at least one customer.')
    expect(errorsOf({ ...ok, who: 'market' }, facts).who).toBe('Choose a market.')
    expect(errorsOf({ ...ok, minimum: 'items', minQuantity: '' }, facts).minimum).toContain('how many items')
  })
})
