import { blankDetails, detailsOf, kindChanged, kindInputOf, kindOf, kindProblemsOf, type KindDetails } from './kindDetails'
import { amountsOf, blankDraft, inputOf, withAmounts, withDetails, type Draft } from './draft'

const file = { id: 'asset-9', mime: 'application/pdf', bytes: 18_000_000 }
const withFile = (over: Partial<KindDetails['download']> = {}): KindDetails => ({ ...blankDetails(), download: { ...blankDetails().download, file, ...over } })

describe('each kind’s fields map to the API’s input', () => {
  it('sends a download’s file, its limit and how long its link works', () => {
    expect(kindInputOf('digital', withFile({ limit: 10, days: 365 }))).toEqual({ download: { mode: 'file', fileId: 'asset-9', limit: 10, days: 365 } })
  })

  it('keeps a stored pool of licence keys as it is, with no file', () => {
    expect(kindInputOf('digital', withFile({ mode: 'keys' }))).toEqual({ download: { mode: 'keys', fileId: null, limit: 5, days: 30 } })
  })

  it('sends a service’s length and place trimmed, and null for what is left empty', () => {
    const details = { ...blankDetails(), service: { duration: ' 2 hours ', location: '  ' } }
    expect(kindInputOf('service', details)).toEqual({ service: { duration: '2 hours', location: null } })
  })

  it('sends a gift card’s expiry in months, or null for never', () => {
    expect(kindInputOf('gift_card', { ...blankDetails(), giftCard: { expiryMonths: 12, shortestMonths: 12 } })).toEqual({ giftCard: { expiryMonths: 12 } })
    expect(kindInputOf('gift_card', blankDetails())).toEqual({ giftCard: { expiryMonths: null } })
  })

  it('sends nothing for a physical item', () => {
    expect(kindInputOf('physical', blankDetails())).toBeNull()
  })

  it('reads a stored kind over the defaults for the kinds the product isn’t', () => {
    const view = { productId: 'p', productType: 'gift_card', revision: 3, download: null, service: null, giftCard: { expiryMonths: 24, shortestMonths: 12 } }
    expect(detailsOf(view)).toEqual({ ...blankDetails(), giftCard: { expiryMonths: 24, shortestMonths: 12 } })
    expect(detailsOf(null)).toEqual(blankDetails())
  })

  it('takes a type the app doesn’t know as a physical item', () => {
    expect(kindOf('digital')).toBe('digital')
    expect(kindOf('subscription')).toBe('physical')
  })
})

describe('what stops a kind saving', () => {
  it('needs a download’s file, and waits for one still uploading', () => {
    expect(kindProblemsOf('digital', blankDetails())).toEqual(['file'])
    expect(kindProblemsOf('digital', withFile())).toEqual([])
    expect(kindProblemsOf('digital', { ...blankDetails(), download: { ...blankDetails().download, uploading: true } })).toEqual(['fileBusy'])
  })

  it('asks nothing of a stored key pool, a service or a gift card', () => {
    expect(kindProblemsOf('digital', withFile({ mode: 'keys', file: null }))).toEqual([])
    expect(kindProblemsOf('service', blankDetails())).toEqual([])
    expect(kindProblemsOf('gift_card', blankDetails())).toEqual([])
  })

  it('saves the kind’s card when the kind or its details changed, not when only the upload’s progress did', () => {
    const saved = { kind: 'digital' as const, details: withFile() }
    expect(kindChanged(saved, saved)).toBe(false)
    expect(kindChanged({ kind: 'digital', details: withFile({ uploading: true, refusal: 'TOO_LARGE' }) }, saved)).toBe(false)
    expect(kindChanged({ kind: 'digital', details: withFile({ limit: 3 }) }, saved)).toBe(true)
    expect(kindChanged({ kind: 'service', details: blankDetails() }, saved)).toBe(true)
  })
})

describe('a gift card’s amounts are its versions', () => {
  const label = (amount: string) => `A${amount}`
  const priced = (price: string): Draft => ({ ...blankDraft(), kind: 'gift_card', versions: blankDraft().versions.map((version) => ({ ...version, price })) })

  it('makes one kind of choice named Amount with a version per amount, lowest first', () => {
    const made = withAmounts(priced('500'), ['100000', '50000', '200000'], 'INR', 'Amount', label)

    expect(made.options).toEqual([{ id: null, name: 'Amount', values: [{ id: null, name: 'A50000' }, { id: null, name: 'A100000' }, { id: null, name: 'A200000' }] }])
    expect(made.versions.map((version) => [version.choices, version.price])).toEqual([[['A50000'], '500.00'], [['A100000'], '1000.00'], [['A200000'], '2000.00']])
    expect(amountsOf(made, 'INR')).toEqual(['50000', '100000', '200000'])
  })

  it('has no choice at all for a single amount, and keeps the version a matching price already had', () => {
    const many = withAmounts(priced('500'), ['50000', '100000'], 'INR', 'Amount', label)
    const stored = { ...many, versions: many.versions.map((version, i) => ({ ...version, id: `ver-${i}` })) }
    const one = withAmounts(stored, ['100000'], 'INR', 'Amount', label)

    expect(one.options).toEqual([])
    expect(one.versions).toHaveLength(1)
    expect(one.versions[0]).toMatchObject({ id: 'ver-1', choices: [], price: '1000.00' })
  })

  it('reads a free or unpriced version as no amount', () => {
    expect(amountsOf(priced('0'), 'INR')).toEqual([])
    expect(amountsOf(priced(''), 'INR')).toEqual([])
  })

  it('saves as the product’s own kind, with its amounts as its versions’ prices', () => {
    const draft = withDetails(withAmounts(priced(''), ['50000', '100000'], 'INR', 'Amount', label), 'giftCard', { expiryMonths: 12 })
    const input = inputOf(draft, 'INR', 'merchant', true)

    expect(input.productType).toBe('gift_card')
    expect(input.options).toEqual([{ name: 'Amount', values: [{ name: 'A50000' }, { name: 'A100000' }] }])
    expect(input.versions.map((version) => version.prices)).toEqual([[{ currency: 'INR', amount: '50000' }], [{ currency: 'INR', amount: '100000' }]])
  })
})
