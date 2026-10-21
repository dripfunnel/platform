// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Provided, shopAnswering } from '../../test/shop'
import { useProduct, type ProductPage } from './product'

const usd = (amount: number) => ({ amount: String(amount), currency: 'USD' })
const product = (extra: Record<string, unknown>) => ({ id: 'p1', name: 'Gift card', slug: 'gift-card', description: null, highlights: [], inStock: true, price: usd(2500), compareAt: null, maxPrice: null, badges: [], photos: [], video: null, options: [], versions: [{ id: 'v1', name: null, choices: [], price: usd(2500), compareAt: null, inStock: true, available: null }], specs: [], faqs: [], compliance: [], returns: null, warranty: null, seoTitle: null, seoDescription: null, related: [], ...extra })

let seen: ProductPage | null = null
const Probe = () => {
  seen = useProduct()
  return null
}
const kindOf = async (extra: Record<string, unknown>) => {
  history.replaceState(null, '', '/products/gift-card/')
  shopAnswering(() => ({ data: { product: product(extra), store: { marketId: 'm', markets: [{ id: 'm', countries: ['US'] }] } } }))
  render(
    <Provided>
      <Probe />
    </Provided>,
  )
  await act(async () => undefined)
  const kind = seen?.product?.kind
  cleanup()
  vi.unstubAllGlobals()
  return kind
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
})

describe('a product’s kind', () => {
  it('says what a gift card, a download and a service tell the shopper, and a physical product is plain', async () => {
    expect(await kindOf({ productType: 'gift_card', giftCard: { expiryMonths: 12 } })).toEqual({ kind: 'gift_card', expiryMonths: 12 })
    expect(await kindOf({ productType: 'digital', download: { days: 30, limit: 5 } })).toEqual({ kind: 'digital', downloadDays: 30, downloadLimit: 5 })
    expect(await kindOf({ productType: 'service', service: { duration: '60 minutes', location: 'At our studio' } })).toEqual({ kind: 'service', duration: '60 minutes', location: 'At our studio' })
    expect(await kindOf({ productType: 'physical' })).toEqual({ kind: 'physical' })
    expect(await kindOf({})).toEqual({ kind: 'physical' })
  })
})
