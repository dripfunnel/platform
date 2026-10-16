import type { ShippingSettings } from '../../../api/settingsShipping'
import { draftOf, inputOf, rebase, same, type Draft } from './shippingDraft'

const settings = (over: Partial<ShippingSettings> = {}): ShippingSettings => ({
  revision: 4,
  savedAt: null,
  currency: 'INR',
  courierRate: false,
  flatRate: true,
  flatAmount: '4900',
  pickup: false,
  pickupHours: null,
  pickupAddress: null,
  freeMode: 'never',
  freeThresholdAmount: null,
  areaMode: 'everywhere',
  areaFileName: null,
  areaCount: 0,
  areaSample: [],
  labelSizes: ['a6', 'a4'],
  couriers: [{ provider: 'shiprocket', status: 'pricing', offered: true, pickupMode: 'scheduled', labelSize: 'a6', trackingEmails: true, lastTestedAt: null, lastTestResult: null }],
  ...over,
})

describe('the shipping draft', () => {
  it('shows the stored minor units as the amount a person types', () => {
    expect(draftOf(settings({ flatAmount: '4950', freeMode: 'over', freeThresholdAmount: '99900' }))).toMatchObject({ flat: '49.50', threshold: '999.00' })
    expect(draftOf(settings({ currency: 'JPY', flatAmount: '500' })).flat).toBe('500')
    expect(draftOf(settings({ flatAmount: null })).flat).toBe('')
  })

  it('sends the flat rate and the free-over threshold as minor-unit digit strings', () => {
    const draft: Draft = { ...draftOf(settings()), flat: '49.5', freeMode: 'over', threshold: '999' }

    expect(inputOf(draft, settings())).toEqual({
      courierRate: false,
      flatRate: true,
      flatAmount: '4950',
      pickup: false,
      pickupHours: null,
      freeMode: 'over',
      freeThresholdAmount: '99900',
      areaMode: 'everywhere',
    })
  })

  it('takes a comma keyboard’s decimal and a currency with no minor unit', () => {
    expect(inputOf({ ...draftOf(settings()), flat: '49,50' }, settings())).toMatchObject({ flatAmount: '4950' })
    expect(inputOf({ ...draftOf(settings({ currency: 'JPY' })), flat: '500' }, settings({ currency: 'JPY' }))).toMatchObject({ flatAmount: '500' })
  })

  it('never sends a threshold unless delivery is free over one', () => {
    const draft: Draft = { ...draftOf(settings()), freeMode: 'always', threshold: '999' }

    expect(inputOf(draft, settings())).toMatchObject({ freeMode: 'always', freeThresholdAmount: null })
  })

  it('refuses an amount that is not money, more decimals than the currency has, or a thousands separator', () => {
    const base = draftOf(settings())

    expect(inputOf({ ...base, flat: '4x' }, settings())).toBe('amount')
    expect(inputOf({ ...base, flat: '49.555' }, settings())).toBe('amount')
    expect(inputOf({ ...base, flat: '1,000' }, settings())).toBe('amount')
    expect(inputOf({ ...base, freeMode: 'over', threshold: 'abc' }, settings())).toBe('amount')
  })

  it('names the first rule a save breaks, in the order the API has them', () => {
    const base = draftOf(settings())

    expect(inputOf({ ...base, flatRate: false }, settings())).toBe('method')
    expect(inputOf({ ...base, courierRate: true }, settings({ couriers: [] }))).toBe('courier')
    expect(inputOf({ ...base, flat: '' }, settings())).toBe('flat')
    expect(inputOf({ ...base, freeMode: 'over', threshold: '' }, settings())).toBe('threshold')
    expect(inputOf({ ...base, pickup: true, hours: ' ' }, settings())).toBe('hours')
    expect(inputOf({ ...base, areaMode: 'list' }, settings())).toBe('list')
  })

  it('keeps what was edited when the server’s settings are read again, and takes the rest from the server', () => {
    const before = draftOf(settings())
    const edited: Draft = { ...before, flat: '60' }
    const after = draftOf(settings({ pickup: true, pickupHours: 'Mon–Sat', flatAmount: '4900' }))

    const next = rebase(edited, before, after)

    expect(next).toMatchObject({ flat: '60', pickup: true, hours: 'Mon–Sat' })
    expect(same(before, draftOf(settings()))).toBe(true)
    expect(same(edited, before)).toBe(false)
  })
})
