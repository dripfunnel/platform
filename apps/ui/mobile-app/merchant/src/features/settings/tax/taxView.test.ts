import type { TaxClass, TaxZone } from '../../../api/settingsTax'
import { actionsFor, homeZone, percent, rateOf, ratesAtHome, taxWordsFor } from './taxView'

const cls = (over: Partial<TaxClass> = {}): TaxClass => ({ id: 'c1', name: 'Clothing', isDefault: false, taxCode: null, versions: 0, ...over })
const zones: TaxZone[] = [
  { id: 'z-in-mh', name: 'Maharashtra', countries: ['IN'], regions: ['MH'], rates: [{ taxClassId: 'c1', rateBps: 900 }] },
  { id: 'z-in', name: 'India', countries: ['IN'], regions: [], rates: [{ taxClassId: 'c1', rateBps: 1200 }] },
]

describe('what a country calls its tax', () => {
  it('names GST, sales tax or VAT, and says how stores there usually type prices', () => {
    expect(taxWordsFor('IN')).toEqual({ name: 'gst', usuallyIncluded: true })
    expect(taxWordsFor('US')).toEqual({ name: 'salesTax', usuallyIncluded: false })
    expect(taxWordsFor('CA')).toEqual({ name: 'salesTax', usuallyIncluded: false })
    expect(taxWordsFor('DE')).toEqual({ name: 'vat', usuallyIncluded: true })
  })

  it('leaves a US store’s rates to the shopper’s state, and a store with no country to nothing', () => {
    expect([ratesAtHome('IN'), ratesAtHome('US'), ratesAtHome(null)]).toEqual([true, false, false])
  })
})

describe('rates at home', () => {
  it('reads a category’s rate from the zone for the whole home country, never a region’s', () => {
    expect(homeZone(zones, 'IN')?.id).toBe('z-in')
    expect(rateOf(homeZone(zones, 'IN'), cls())).toBe(1200)
    expect(rateOf(homeZone(zones, 'IN'), cls({ id: 'other' }))).toBeNull()
    expect(homeZone(zones, 'US')).toBeNull()
  })

  it('shows basis points as the percentage they are', () => {
    expect([percent(1200), percent(750), percent(0)]).toEqual(['12%', '7.5%', '0%'])
  })
})

describe('what a category’s menu offers', () => {
  it('lets one that is not the default become it, change its rate at home, and be deleted when no version uses it', () => {
    expect(actionsFor(cls(), 'IN')).toEqual(['default', 'rate', 'delete'])
    expect(actionsFor(cls({ versions: 4 }), 'IN')).toEqual(['default', 'rate'])
  })

  it('never offers deleting the default, nor a rate change to a US store', () => {
    expect(actionsFor(cls({ isDefault: true }), 'IN')).toEqual(['rate'])
    expect(actionsFor(cls({ isDefault: true }), 'US')).toEqual([])
    expect(actionsFor(cls(), 'US')).toEqual(['default', 'delete'])
  })
})
