import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveShopper } from '#auth/shopCaller'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Bug #1476: a version hidden ("Hide it for now") or removed ("We don't make this") in the merchant portal is not offered on the
// live site: not in the choices, not buyable, and not in the product's price (DATA-MODEL §7).

let db: TestDatabase
let t: Tenants
const host = 'store-a1.shop.example'
const ids = { visible: '', hidden: '', removed: '', capVisible: '', capOther: '', ghostHidden: '' }

const product = async (slug: string) =>
  (await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${t.storeA1}, ${slug}, ${slug}, 'visible') returning id`)[0]?.id ?? ''
const version = async (productId: string, name: string, price: number, position: number, over: { visibility?: string; deleted?: boolean } = {}) => {
  const [v] = await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, name, sku, position, visibility, deleted_at)
    values (${t.storeA1}, ${productId}, ${name}, ${`S-${crypto.randomUUID().slice(0, 8)}`}, ${position}, ${over.visibility ?? 'visible'}, ${over.deleted ? new Date() : null}) returning id`
  await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${v?.id ?? ''}, ${t.storeA1}, 'INR', ${price})`
  return v?.id ?? ''
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set pricing_currency = 'INR', country = 'IN', status = 'active' where id = ${t.storeA1}`
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  await db.sql`update market set countries = '["IN"]' where store_id = ${t.storeA1}`

  const tee = await product('tee')
  ids.visible = await version(tee, 'M', 50000, 0)
  ids.hidden = await version(tee, 'S', 10000, 1, { visibility: 'hidden' })
  ids.removed = await version(tee, 'L', 5000, 2, { deleted: true })
  // A Size option whose values S, M and L each belong to one of those versions.
  const [size] = await db.sql<{ id: string }[]>`insert into product_option (product_id, store_id, name, position) values (${tee}, ${t.storeA1}, 'Size', 0) returning id`
  for (const [position, [name, versionId]] of [['M', ids.visible], ['S', ids.hidden], ['L', ids.removed]].entries()) {
    const [value] = await db.sql<{ id: string }[]>`insert into product_option_value (option_id, store_id, name, position) values (${size?.id ?? ''}, ${t.storeA1}, ${name ?? ''}, ${position}) returning id`
    await db.sql`insert into product_version_option_value (version_id, option_id, value_id, store_id) values (${versionId ?? ''}, ${size?.id ?? ''}, ${value?.id ?? ''}, ${t.storeA1})`
  }
  const cap = await product('cap')
  ids.capVisible = await version(cap, 'One size', 20000, 0)
  ids.capOther = await version(cap, 'Kids', 30000, 1)
  const ghost = await product('ghost')
  ids.ghostHidden = await version(ghost, 'Only', 1000, 0, { visibility: 'hidden' })
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const gql = async (source: string) => {
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`), host, 'shop.example')
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.4', userAgent: null }, allowNewCart: async () => true, now: () => new Date() }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const listed = async (args = '') => {
  const page = (await gql(`{ products${args} { nodes { slug price { amount } } priceBounds { min { amount } max { amount } } } }`)).data?.['products'] as {
    nodes: { slug: string; price: { amount: string } | null }[]
    priceBounds: { min: { amount: string }; max: { amount: string } } | null
  }
  return { slugs: page.nodes.map((n) => n.slug), prices: page.nodes.map((n) => n.price?.amount), bounds: page.priceBounds }
}

describe('a hidden version and a removed one', () => {
  it('are not on the product page, and the product’s price is the visible version’s', async () => {
    const page = (await gql('{ product(slug: "tee") { price { amount } versions { price { amount } } } }')).data?.['product'] as { price: { amount: string }; versions: { price: { amount: string } }[] }
    expect(page.versions.map((v) => v.price.amount)).toEqual(['50000'])
    expect(page.price.amount).toBe('50000')
  })

  it('leave the size they were the only one of out of the product’s choices', async () => {
    const page = (await gql('{ product(slug: "tee") { options { name values { name } } } }')).data?.['product'] as { options: { name: string; values: { name: string }[] }[] }
    expect(page.options).toEqual([{ name: 'Size', values: [{ name: 'M' }] }])
  })

  it('do not set the listing’s price, its price sort, its price range or its bounds', async () => {
    expect((await listed('(sort: PRICE_LOW)')).slugs).toEqual(['cap', 'tee'])
    expect((await listed('(sort: PRICE_LOW)')).prices).toEqual(['20000', '50000'])
    expect((await listed('(minPrice: "1000", maxPrice: "6000")')).slugs).toEqual([])
    expect((await listed('(minPrice: "40000", maxPrice: "60000")')).slugs).toEqual(['tee'])
    expect((await listed()).bounds).toEqual({ min: { amount: '20000' }, max: { amount: '50000' } })
  })

  it('cannot be added to a cart', async () => {
    expect((await gql(`mutation { addToCart(versionId: "${ids.visible}", quantity: 1) { cartToken } }`)).code).toBeUndefined()
    for (const versionId of [ids.hidden, ids.removed]) expect((await gql(`mutation { addToCart(versionId: "${versionId}", quantity: 1) { cartToken } }`)).code).toBe('UNAVAILABLE')
  })

  it('leave a product with no visible version unlisted and not buyable, as before', async () => {
    expect((await listed()).slugs).not.toContain('ghost')
    expect((await gql(`mutation { addToCart(versionId: "${ids.ghostHidden}", quantity: 1) { cartToken } }`)).code).toBe('UNAVAILABLE')
  })
})
