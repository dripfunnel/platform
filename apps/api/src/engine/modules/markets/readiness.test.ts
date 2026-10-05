import { describe, expect, it } from 'vitest'
import { missingFor } from './readiness'

const kurta = { productType: 'physical', priced: true, hasCompareAt: false, compliance: new Set<string>() }

describe('ready to sell per market (CATALOG T2, fact 45)', () => {
  it('asks a US market for fibre, origin and care, and an Indian one for origin and an MRP', () => {
    expect(missingFor(kurta, ['US'])).toEqual(['fibre', 'origin', 'care'])
    expect(missingFor(kurta, ['IN'])).toEqual(['origin', 'compare'])
    expect(missingFor({ ...kurta, hasCompareAt: true, compliance: new Set(['ALL:origin']) }, ['IN'])).toEqual([])
  })

  it('takes a detail filed for the country or for every country, and asks each country of a market', () => {
    const filed = { ...kurta, compliance: new Set(['US:fibre', 'ALL:origin', 'US:care']) }
    expect(missingFor(filed, ['US'])).toEqual([])
    expect(missingFor(filed, ['US', 'IN'])).toEqual(['compare'])
    expect(missingFor(filed, ['DE', 'FR'])).toEqual([])
  })

  it('needs a price everywhere but for a gift card, and asks nothing more of what isn’t physical', () => {
    expect(missingFor({ ...kurta, priced: false }, ['DE'])).toEqual(['price'])
    expect(missingFor({ ...kurta, productType: 'digital', priced: false }, ['US'])).toEqual(['price'])
    expect(missingFor({ ...kurta, productType: 'gift_card', priced: false }, ['US'])).toEqual([])
  })
})
