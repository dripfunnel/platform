import { describe, expect, it } from 'vitest'
import { ShopUnauthorized } from '#engine/modules/catalog/index'
import { shopifyApi } from './api'

const credentials = { clientId: '0123456789abcdef0123456789abcdef', clientSecret: 'shpss_test' }
const now = new Date('2026-10-06T09:00:00Z')

const signed = async (params: Record<string, string>) => {
  const message = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(credentials.clientSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const hmac = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))].map((b) => b.toString(16).padStart(2, '0')).join('')
  return new URLSearchParams({ ...params, hmac })
}

describe('shopifyApi', () => {
  it('asks for read-only product and inventory access, coming back to our callback with the state', () => {
    const url = new URL(shopifyApi(credentials).authorizeUrl('kesari.myshopify.com', 'abc', 'https://hooks.example/shopify/callback'))
    expect(url.origin).toBe('https://kesari.myshopify.com')
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: credentials.clientId, scope: 'read_products,read_inventory', redirect_uri: 'https://hooks.example/shopify/callback', state: 'abc' })
  })

  it('accepts only Shopify’s own signature on a recent callback', async () => {
    const api = shopifyApi(credentials)
    const params = { code: 'c1', shop: 'kesari.myshopify.com', state: 'abc', timestamp: String(now.getTime() / 1000) }
    expect(await api.verifyCallback(await signed(params), now)).toBe(true)
    const forged = await signed(params)
    forged.set('shop', 'other.myshopify.com')
    expect(await api.verifyCallback(forged, now)).toBe(false)
    expect(await api.verifyCallback(await signed({ ...params, timestamp: String(now.getTime() / 1000 - 7200) }), now)).toBe(false)
  })

  it('exchanges the code for a token, and reads products into the engine’s shape', async () => {
    const asked: { url: string; body: string; token: string | null }[] = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push({ url: String(input), body: String(init?.body), token: new Headers(init?.headers).get('x-shopify-access-token') })
      if (String(input).endsWith('/access_token')) return Response.json({ access_token: 'shpat_1', scope: 'read_products' })
      return Response.json({
        data: {
          products: {
            nodes: [
              {
                id: 'gid://shopify/Product/1',
                handle: 'tee',
                title: 'Tee',
                descriptionHtml: '<p>Soft</p>',
                status: 'ACTIVE',
                options: [{ name: 'Size', position: 1 }],
                media: { nodes: [{ image: { url: 'https://cdn.shopify.com/a.jpg', altText: 'Front' } }, {}] },
                variants: { nodes: [{ sku: 'TEE-S', barcode: '', price: '499.00', compareAtPrice: null, inventoryQuantity: 4, selectedOptions: [{ name: 'Size', value: 'S' }], inventoryItem: { unitCost: { amount: '200.0' }, measurement: { weight: { unit: 'KILOGRAMS', value: 0.18 } } } }] },
              },
            ],
            pageInfo: { hasNextPage: true, endCursor: 'c2' },
          },
        },
      })
    }) as typeof fetch
    const api = shopifyApi(credentials, fetchImpl)
    expect(await api.exchange('kesari.myshopify.com', 'c1')).toBe('shpat_1')
    const page = await api.products('kesari.myshopify.com', 'shpat_1', { after: null, first: 25 })
    expect(page.next).toBe('c2')
    expect(page.products[0]).toEqual({
      id: 'gid://shopify/Product/1',
      handle: 'tee',
      title: 'Tee',
      descriptionHtml: '<p>Soft</p>',
      status: 'ACTIVE',
      options: ['Size'],
      images: [{ url: 'https://cdn.shopify.com/a.jpg', alt: 'Front' }],
      variants: [{ sku: 'TEE-S', barcode: null, price: '499.00', compareAtPrice: null, cost: '200.0', grams: 180, quantity: 4, values: ['S'] }],
    })
    expect(asked[1]?.url).toBe('https://kesari.myshopify.com/admin/api/2025-07/graphql.json')
    expect(asked[1]?.token).toBe('shpat_1')
    // One past what an import takes, so a product over 100 variants or 20 photos is reported by the check rather than cut short.
    expect(asked[1]?.body).toContain('variants(first: 101)')
    expect(asked[1]?.body).toContain('media(first: 21)')
  })

  it('says a refused token has expired', async () => {
    const api = shopifyApi(credentials, (async () => new Response('', { status: 401 })) as typeof fetch)
    await expect(api.products('kesari.myshopify.com', 'old', { after: null, first: 25 })).rejects.toBeInstanceOf(ShopUnauthorized)
  })
})
