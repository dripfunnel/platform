import { describe, expect, it } from 'vitest'
import { cleanMarket } from './rules'

const market = { name: 'USA', countries: ['US'], currency: 'USD', language: 'en-US' }

describe('a market’s own delivery charge (SAPI 23)', () => {
  it('is money in the market’s currency, or nothing to charge the store’s', () => {
    expect(cleanMarket({ ...market, deliveryAmount: '499' })).toMatchObject({ deliveryAmount: '499' })
    expect(cleanMarket({ ...market, deliveryAmount: '0' })).toMatchObject({ deliveryAmount: '0' })
    expect(cleanMarket({ ...market, deliveryAmount: ' ' })).toMatchObject({ deliveryAmount: null })
    expect(cleanMarket(market)).toMatchObject({ deliveryAmount: null })
  })

  it('refuses one that isn’t whole minor units', () => {
    for (const bad of ['4.99', '-1', 'abc', '1e3']) expect(cleanMarket({ ...market, deliveryAmount: bad })).toBe('INVALID_INPUT')
  })
})
