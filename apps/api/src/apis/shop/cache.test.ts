import { describe, expect, it } from 'vitest'
import type { Shopper } from '#auth/shopCaller'
import { readsCatalogueOnly, shopCacheKey, throughShopCache, type ShopCache } from './cache'

const shopper = (over: Partial<Shopper> = {}): Shopper => ({
  context: { caller: { kind: 'shopper', customerId: null }, partnerId: 'p', storeId: 's1', sellerScope: { kind: 'all' }, subscription: 'active' },
  available: true, catalogVersion: '7', mainLanguage: 'en-IN', pricingCurrency: 'INR', language: 'en-IN', currency: 'INR', marketId: null,
  features: { sizeCharts: true, specs: true, highlights: true, faqs: false, badges: true, related: false, aplus: true, video: false },
  ...over,
})
const post = (query: string, variables: unknown = null, operationName?: string) =>
  new Request('https://kesari.shops.acme.example/shop-api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables, ...(operationName ? { operationName } : {}) }) })

const memory = () => {
  const kept = new Map<string, Response>()
  const cache: ShopCache = {
    match: async (key) => kept.get(key.url)?.clone(),
    put: async (key, response) => {
      kept.set(key.url, response)
    },
  }
  return { cache, kept }
}

describe('the Shop API’s edge cache', () => {
  it('caches only a query of catalogue fields', () => {
    expect(readsCatalogueOnly('{ products { nodes { id } } menu { label } }', null)).toBe(true)
    expect(readsCatalogueOnly('{ health }', null)).toBe(false)
    expect(readsCatalogueOnly('{ store { name } __typename }', null)).toBe(false)
    expect(readsCatalogueOnly('mutation { addToCart }', null)).toBe(false)
    expect(readsCatalogueOnly('{ cart { id } }', null)).toBe(false)
    expect(readsCatalogueOnly('{ ...F } fragment F on Query { store { name } }', null)).toBe(false)
    expect(readsCatalogueOnly('query A { store { name } } query B { cart { id } }', 'B')).toBe(false)
    expect(readsCatalogueOnly('query A { store { name } } query B { cart { id } }', null)).toBe(false)
    expect(readsCatalogueOnly('{ store {', null)).toBe(false)
  })

  it('keys by store, catalogue version, host, language, currency and market, so none of them is ever served another’s answer', async () => {
    const key = async (s: Shopper, host = 'kesari.shops.acme.example', request = post('{ store { name } }')) => (await shopCacheKey(request, s, host))?.url
    const base = await key(shopper())
    expect(base).toMatch(/^https:\/\/shop-cache\.invalid\/s1\/7\/kesari\.shops\.acme\.example\/en-IN\/INR\/-\/[0-9a-f]{64}$/)
    const others = await Promise.all([
      key(shopper({ context: { ...shopper().context, storeId: 's2' } })),
      key(shopper({ catalogVersion: '8' })),
      key(shopper(), 'www.kesari.example'),
      key(shopper({ language: 'hi-IN' })),
      key(shopper({ currency: 'USD' })),
      key(shopper({ marketId: 'm1' })),
      key(shopper(), undefined, post('{ store { name } }', { a: 1 })),
    ])
    expect(new Set([base, ...others]).size).toBe(8)
    expect(await shopCacheKey(post('mutation { x }'), shopper(), 'h')).toBeNull()
  })

  it('serves a clean answer from the cache the second time, and never keeps an error', async () => {
    const { cache, kept } = memory()
    const key = new Request('https://shop-cache.invalid/k')
    let runs = 0
    const ok = () => {
      runs += 1
      return Promise.resolve(new Response(JSON.stringify({ data: { store: { name: 'Kesari' } } }), { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'x=1', 'x-request': 'r1' } }))
    }
    const waits: Promise<void>[] = []
    const first = await throughShopCache(cache, key, ok, (w) => waits.push(w))
    await Promise.all(waits)
    const second = await throughShopCache(cache, key, ok, (w) => waits.push(w))
    expect([first.headers.get('x-shop-cache'), second.headers.get('x-shop-cache'), runs]).toEqual(['miss', 'hit', 1])
    expect([first.headers.get('cache-control'), second.headers.get('cache-control')]).toEqual(['private, no-store', 'private, no-store'])
    expect(await second.json()).toEqual({ data: { store: { name: 'Kesari' } } })
    expect(kept.get(key.url)?.headers.get('cache-control')).toBe('public, max-age=300')
    expect([...(kept.get(key.url)?.headers.keys() ?? [])].sort()).toEqual(['cache-control', 'content-type'])
    const refused = () => Promise.resolve(new Response(JSON.stringify({ errors: [{ message: 'x' }], data: null }), { status: 200 }))
    const errorKey = new Request('https://shop-cache.invalid/e')
    await throughShopCache(cache, errorKey, refused, (w) => waits.push(w))
    expect(kept.has(errorKey.url)).toBe(false)
  })
})
