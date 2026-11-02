import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { recordedShopClient } from './recorded'

const nodes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }))
const client = recordedShopClient([
  { operation: 'Product', variables: { slug: 'linen-shirt' }, data: { product: { id: 'p1', name: 'Linen shirt' } } },
  { operation: 'Listing', variables: { sort: 'NEWEST', first: 24 }, data: { products: { nodes: nodes(24), pageInfo: { hasNextPage: true } } } },
])

describe('recordedShopClient', () => {
  it('answers a recorded question, whatever empty variables the asker adds', async () => {
    const answer = await client.query('query Product($slug: String!) { product(slug: $slug) { id name } }', z.object({ product: z.object({ name: z.string() }) }), { slug: 'linen-shirt', after: null })
    expect(answer.product.name).toBe('Linen shirt')
  })

  it('answers a smaller list from a longer recorded one', async () => {
    const answer = await client.request<{ products: { nodes: unknown[]; pageInfo: unknown } }>('query Listing($sort: ShopProductSort, $first: Int) { products { nodes { id } } }', { sort: 'NEWEST', first: 8 })
    expect(answer.products.nodes).toHaveLength(8)
    expect(answer.products.pageInfo).toBeNull()
  })

  it('refuses a question the snapshot holds no answer to', async () => {
    await expect(client.request('query Product($slug: String!) { product(slug: $slug) { id } }', { slug: 'other' })).rejects.toMatchObject({ code: 'NOT_RECORDED' })
    await expect(client.request('query Listing { products { nodes { id } } }', { sort: 'NEWEST', first: 30 })).rejects.toMatchObject({ code: 'NOT_RECORDED' })
    await expect(client.request('{ health }')).rejects.toMatchObject({ code: 'NOT_RECORDED' })
  })
})
