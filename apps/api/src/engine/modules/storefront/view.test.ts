import { describe, expect, it } from 'vitest'
import type { ShopProductRow } from '#db/scoped/shop'
import { productView, type ViewFacts } from './view'

const now = new Date('2026-10-07T09:00:00Z')
const version = (id: string, prices: { currency: string; amount: string; compare_at_amount: string | null }[], over: Partial<ShopProductRow['versions'][number]> = {}) =>
  ({ id, name: null, sku: null, weight_grams: null, track_stock: true, continue_selling: false, prices, choices: [], ...over })
const row = (over: Partial<ShopProductRow> = {}): ShopProductRow => ({
  id: 'p', name: 'Kurta', slug: 'kurta', description: '', product_type: 'physical', created_at: new Date('2026-08-01T00:00:00Z'), seo_title: null, seo_description: null,
  warranty_text: null, returns_text: null, size_chart_id: null, photos: [], manual_badges: [],
  versions: [version('v1', [{ currency: 'INR', amount: '149900', compare_at_amount: '199900' }]), version('v2', [{ currency: 'INR', amount: '99900', compare_at_amount: null }])],
  ...over,
})
const facts = (over: Partial<ViewFacts> = {}): ViewFacts => ({
  currency: 'INR',
  market: { currency: 'INR', price_adjustment_bps: 0 },
  pricing: { pricingCurrency: 'INR', currencies: [{ currency: 'USD', mode: 'convert', rounding: 'ends-99' }], perEuro: new Map([['INR', '90'], ['USD', '1.08']]) },
  stock: new Map([['v1', { version_id: 'v1', available: 3, low: true }], ['v2', { version_id: 'v2', available: 0, low: true }]]),
  badges: [],
  now,
  ...over,
})

describe('a product as a shopper is told it', () => {
  it('prices from its cheapest version, with each version’s own price, compare-at and stock', () => {
    const view = productView(row(), facts())
    expect([view.price, view.compareAt, view.maxPrice]).toEqual([{ amount: 99900n, currency: 'INR' }, null, { amount: 149900n, currency: 'INR' }])
    expect(view.versions.map((v) => [v.id, v.price?.amount, v.compareAt?.amount ?? null, v.available, v.inStock])).toEqual([['v1', 149900n, 199900n, 3, true], ['v2', 99900n, null, 0, false]])
    expect(view.inStock).toBe(true)
  })

  it('sells a version with no stock when the store keeps selling it, or doesn’t count it', () => {
    const view = productView(row({ versions: [version('v2', [{ currency: 'INR', amount: '1', compare_at_amount: null }], { continue_selling: true }), version('v3', [{ currency: 'INR', amount: '1', compare_at_amount: null }], { track_stock: false })] }), facts())
    expect(view.versions.map((v) => [v.available, v.inStock])).toEqual([[0, true], [null, true]])
  })

  it('converts into another currency at the reference rate and the store’s rounding, and moves a market’s price by its adjustment', () => {
    expect(productView(row(), facts({ currency: 'USD', market: { currency: 'INR', price_adjustment_bps: 0 } })).price).toEqual({ amount: 1199n, currency: 'USD' })
    expect(productView(row(), facts({ market: { currency: 'INR', price_adjustment_bps: 1000 } })).price).toEqual({ amount: 109890n, currency: 'INR' })
    expect(productView(row(), facts({ currency: 'EUR' })).price).toBeNull()
  })

  it('shows only the badges whose rule holds, and none when badges are off', () => {
    const badges = [
      { id: 'b1', label: 'New', tone: 'ok', rule: 'new_30_days' as const },
      { id: 'b2', label: 'Sale', tone: 'peach', rule: 'below_compare_price' as const },
      { id: 'b3', label: 'Few left', tone: 'peach', rule: 'few_left' as const },
      { id: 'b4', label: 'Bestseller', tone: 'ok', rule: 'top_5_this_month' as const },
      { id: 'b5', label: 'Handmade', tone: 'neutral', rule: 'manual' as const },
    ]
    expect(productView(row({ manual_badges: ['b5'] }), facts({ badges })).badges.map((b) => b.label)).toEqual(['Sale', 'Few left', 'Handmade'])
    expect(productView(row({ created_at: new Date('2026-10-01T00:00:00Z') }), facts({ badges })).badges.map((b) => b.label)).toEqual(['New', 'Sale', 'Few left'])
    expect(productView(row(), facts({ badges: null })).badges).toEqual([])
  })
})
