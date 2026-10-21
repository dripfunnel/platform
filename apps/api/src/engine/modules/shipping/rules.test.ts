import { describe, expect, it } from 'vitest'
import { cleanShipping, deliveryOptions, normalisePostal, type OptionFacts } from './rules'

const inr = (amount: bigint) => ({ amount, currency: 'INR' })

describe('a shipping save', () => {
  const base = { courierRate: false, flatRate: true, flatAmount: '4900', pickup: false, freeMode: 'never', areaMode: 'everywhere' }

  it('reads money in the pricing currency and keeps several methods on at once (#337)', () => {
    expect(cleanShipping({ ...base, pickup: true, pickupHours: ' Mon–Sat, 10 am – 6 pm ', freeMode: 'over', freeThresholdAmount: '99900' }, 'INR')).toEqual({
      courierEnabled: false, flatEnabled: true, flatAmount: 4900n, pickupEnabled: true, pickupHours: 'Mon–Sat, 10 am – 6 pm', freeMode: 'over', freeThresholdAmount: 99900n, areaMode: 'everywhere',
    })
  })

  it('refuses a save offering nothing, a flat rate without an amount, pickup without hours and free over nothing', () => {
    expect(cleanShipping({ ...base, flatRate: false }, 'INR')).toBe('NO_METHOD')
    expect(cleanShipping({ ...base, flatAmount: '' }, 'INR')).toBe('INVALID_INPUT')
    expect(cleanShipping({ ...base, flatAmount: '-1' }, 'INR')).toBe('INVALID_INPUT')
    expect(cleanShipping({ ...base, pickup: true, pickupHours: '  ' }, 'INR')).toBe('INVALID_INPUT')
    expect(cleanShipping({ ...base, freeMode: 'over', freeThresholdAmount: '0' }, 'INR')).toBe('INVALID_INPUT')
    expect(cleanShipping({ ...base, freeMode: 'sometimes' }, 'INR')).toBe('INVALID_INPUT')
    expect(cleanShipping({ ...base, areaMode: 'radius' }, 'INR')).toBe('INVALID_INPUT')
  })

  it('keeps a flat amount while the flat rate is off, as the courier’s fallback', () => {
    expect(cleanShipping({ ...base, courierRate: true, flatRate: false }, 'INR')).toMatchObject({ flatEnabled: false, flatAmount: 4900n })
  })
})

describe('a postcode', () => {
  it('reads a PIN code and a ZIP, ZIP+4 by its first five', () => {
    expect(normalisePostal('IN', ' 302 001 ')).toBe('302001')
    expect(normalisePostal('US', '43215-1234')).toBe('43215')
    expect(normalisePostal('GB', 'sw1a 1aa')).toBe('SW1A1AA')
  })

  it('refuses what can’t be one', () => {
    expect(normalisePostal('IN', '02001')).toBeNull()
    expect(normalisePostal('US', 'ABCDE')).toBeNull()
    expect(normalisePostal('GB', 'ABC')).toBeNull()
  })
})

describe('the options a shopper is offered', () => {
  const facts = (over: Partial<OptionFacts> = {}): OptionFacts => ({
    currency: 'INR',
    settings: { courierEnabled: true, flatEnabled: false, pickupEnabled: true, pickupHours: 'Mon–Sat', freeMode: 'never' },
    deliverable: true,
    courier: { provider: 'shiprocket', amount: inr(8500n), service: 'Delhivery Surface', minDays: 3, maxDays: 5 },
    flat: inr(4900n),
    threshold: null,
    subtotal: inr(120000n),
    ...over,
  })

  it('lists the courier’s rate, then collection in person', () => {
    expect(deliveryOptions(facts()).map((o) => [o.id, o.amount.amount, o.service, o.hours])).toEqual([
      ['courier', 8500n, 'Delhivery Surface', null],
      ['pickup', 0n, null, 'Mon–Sat'],
    ])
  })

  it('falls back to the flat rate when no courier quoted, even with the flat rate off', () => {
    expect(deliveryOptions(facts({ courier: null })).map((o) => [o.id, o.amount.amount])).toEqual([['flat', 4900n], ['pickup', 0n]])
    expect(deliveryOptions(facts({ courier: null, flat: null })).map((o) => o.id)).toEqual(['pickup'])
  })

  it('offers only collection outside the delivery area', () => {
    expect(deliveryOptions(facts({ deliverable: false })).map((o) => o.id)).toEqual(['pickup'])
  })

  it('ships free over the threshold from the threshold itself, keeping what it would have cost', () => {
    const settings = { ...facts().settings, flatEnabled: true, freeMode: 'over' as const }
    const at = deliveryOptions(facts({ settings, threshold: inr(120000n) }))
    expect(at.map((o) => [o.id, o.amount.amount, o.before?.amount])).toEqual([['courier', 0n, 8500n], ['flat', 0n, 4900n], ['pickup', 0n, undefined]])
    expect(deliveryOptions(facts({ settings, threshold: inr(120001n) }))[0]?.amount.amount).toBe(8500n)
    expect(deliveryOptions(facts({ settings: { ...settings, freeMode: 'always' } }))[1]?.amount.amount).toBe(0n)
  })
})
