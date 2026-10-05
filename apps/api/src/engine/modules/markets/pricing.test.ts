import { describe, expect, it } from 'vitest'
import { priceInCurrency, priceInMarket, pricesByCurrency, type StorePricing } from './pricing'

const pricing: StorePricing = {
  pricingCurrency: 'INR',
  currencies: [
    { currency: 'USD', mode: 'convert', rounding: 'ends-99' },
    { currency: 'EUR', mode: 'manual', rounding: 'ends-99' },
    { currency: 'JPY', mode: 'convert', rounding: 'none' },
  ],
  perEuro: new Map([['INR', '90'], ['USD', '1.08']]),
}
const kurta = [{ currency: 'INR', amount: '129900', compare_at_amount: '159900' }]

describe('a version’s price in each currency (CATALOG O2, O10–O11)', () => {
  it('converts a converted currency from the pricing price, compare-at too, rounded as the store asks', () => {
    // 1299 INR at 90 per euro and 1.08 USD per euro is 15.59 USD, rounded up to 15.99.
    expect(priceInCurrency(kurta, 'USD', pricing)).toEqual({ currency: 'USD', amount: 1599n, compareAt: 1999n, source: 'converted' })
  })

  it('keeps a typed price as an override, and sells a typed-only currency only once typed', () => {
    expect(priceInCurrency([...kurta, { currency: 'USD', amount: '1499', compare_at_amount: null }], 'USD', pricing)).toEqual({ currency: 'USD', amount: 1499n, compareAt: null, source: 'typed' })
    expect(priceInCurrency(kurta, 'EUR', pricing)).toEqual({ currency: 'EUR', amount: null, compareAt: null, source: null })
    expect(priceInCurrency([...kurta, { currency: 'EUR', amount: '1450', compare_at_amount: null }], 'EUR', pricing).source).toBe('typed')
  })

  it('isn’t for sale where there is no rate to convert at', () => {
    expect(priceInCurrency(kurta, 'JPY', pricing)).toEqual({ currency: 'JPY', amount: null, compareAt: null, source: null })
    expect(pricesByCurrency(kurta, pricing).map((p) => [p.currency, p.source])).toEqual([['INR', 'typed'], ['USD', 'converted'], ['EUR', null], ['JPY', null]])
  })

  it('prices a market in its currency, moved by its adjustment and rounded again', () => {
    expect(priceInMarket(kurta, { currency: 'USD', price_adjustment_bps: 1000 }, pricing)).toEqual({ currency: 'USD', amount: 1799n, compareAt: 2199n, source: 'converted' })
    expect(priceInMarket(kurta, { currency: 'INR', price_adjustment_bps: 1000 }, pricing)).toEqual({ currency: 'INR', amount: 142890n, compareAt: 175890n, source: 'typed' })
    expect(priceInMarket(kurta, { currency: 'INR', price_adjustment_bps: 0 }, pricing).amount).toBe(129900n)
    expect(priceInMarket(kurta, { currency: 'EUR', price_adjustment_bps: 1000 }, pricing).amount).toBeNull()
  })
})
