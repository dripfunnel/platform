import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveShopper } from '#auth/shopCaller'
import type { TenantContext } from '#core/tenancy'
import { pgArray, withScope } from '#db/scoped/index'
import { encodeValueCursor } from '#core/cursor'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #306 (SAPI 8), part 2: products, a product page and search, priced and stocked by the engine for the shopper's
// currency and market (PLATFORM-PROMPT §5.5; CATALOG facts 25–26, 42, H, T2).

let db: TestDatabase
let t: Tenants
const host = 'store-a1.shops.acme.example'
const ids = { kurta: '', red: '', blue: '', shirt: '', dress: '', hidden: '', hiddenVersion: '', other: '', otherVersion: '', summer: '', cotton: '', linen: '', colour: '', usa: '' }

const product = async (storeId: string, slug: string, created: string, over: Record<string, unknown> = {}) =>
  (await db.sql<{ id: string }[]>`insert into product ${db.sql({ store_id: storeId, name: slug[0]?.toUpperCase() + slug.slice(1), slug, visibility: 'visible', created_at: new Date(created), ...over })} returning id`)[0]?.id ?? ''
const version = async (storeId: string, productId: string, inr: string, compare: string | null, position: number, stock: number | null) => {
  const [v] = await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, track_stock) values (${storeId}, ${productId}, ${`S-${crypto.randomUUID().slice(0, 8)}`}, ${position}, ${stock !== null}) returning id`
  await db.sql`insert into version_price (version_id, store_id, currency, amount, compare_at_amount) values (${v?.id ?? ''}, ${storeId}, 'INR', ${inr}, ${compare})`
  if (stock !== null) {
    await db.sql`insert into stock_level (version_id, warehouse_id, store_id, on_hand) select ${v?.id ?? ''}, w.id, ${storeId}, ${stock} from warehouse w where w.store_id = ${storeId} and w.is_default`
  }
  return v?.id ?? ''
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set pricing_currency = 'INR', country = 'IN', status = 'active' where id in (${t.storeA1}, ${t.storeB1})`
  await db.sql`update partner set state = 'live' where id in (${t.partnerA}, ${t.partnerB})`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerB}, 'shops', '*.shops.bolt.example', 'live', 'CNAME', 'x')`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x')`
  await db.sql`update market set countries = '["IN"]' where store_id = ${t.storeA1}`
  await db.sql`insert into store_currency (store_id, currency, mode, rounding, status, position) values (${t.storeA1}, 'USD', 'convert', 'ends-99', 'active', 0)`
  await db.sql`insert into store_language (store_id, language, status, position) values (${t.storeA1}, 'hi-IN', 'active', 1)`
  await db.sql`insert into exchange_rate (currency, per_euro, source, published_on, fetched_at) values ('INR', '90', 'ecb', '2026-10-06', now()), ('USD', '1.08', 'ecb', '2026-10-06', now())`
  ids.usa = (await db.sql<{ id: string }[]>`insert into market (store_id, name, countries, currency, language) values (${t.storeA1}, 'USA', '["US"]', 'USD', 'en-US') returning id`)[0]?.id ?? ''

  ids.kurta = await product(t.storeA1, 'kurta', '2026-10-05T00:00:00Z', { description: 'Hand block printed.' })
  ids.red = await version(t.storeA1, ids.kurta, '149900', '199900', 0, 3)
  ids.blue = await version(t.storeA1, ids.kurta, '99900', null, 1, 0)
  ids.shirt = await product(t.storeA1, 'shirt', '2026-09-01T00:00:00Z')
  await version(t.storeA1, ids.shirt, '79900', null, 0, 10)
  await db.sql`insert into product_market_rule (product_id, store_id, mode, countries) values (${ids.shirt}, ${t.storeA1}, 'only', '["US"]')`
  ids.dress = await product(t.storeA1, 'dress', '2026-08-01T00:00:00Z')
  await version(t.storeA1, ids.dress, '299900', null, 0, null)
  ids.hidden = await product(t.storeA1, 'hidden-kurta', '2026-10-06T00:00:00Z', { visibility: 'hidden' })
  ids.hiddenVersion = await version(t.storeA1, ids.hidden, '100', null, 0, 5)
  ids.other = await product(t.storeB1, 'kurta', '2026-10-05T00:00:00Z')
  ids.otherVersion = await version(t.storeB1, ids.other, '100', null, 0, 5)

  await db.sql`insert into translation (store_id, entity, entity_id, field, language, text, source_hash) values
    (${t.storeA1}, 'product', ${ids.kurta}, 'name', 'hi-IN', 'कुर्ता', ${'0'.repeat(32)}), (${t.storeA1}, 'product', ${ids.kurta}, 'slug', 'hi-IN', 'kurta-hi', ${'0'.repeat(32)})`
  ids.colour = (await db.sql<{ id: string }[]>`insert into product_option (product_id, store_id, name, position) values (${ids.kurta}, ${t.storeA1}, 'Colour', 0) returning id`)[0]?.id ?? ''
  const [red] = await db.sql<{ id: string }[]>`insert into product_option_value (option_id, store_id, name, position) values (${ids.colour}, ${t.storeA1}, 'Red', 0) returning id`
  await db.sql`insert into product_version_option_value (version_id, option_id, value_id, store_id) values (${ids.red}, ${ids.colour}, ${red?.id ?? ''}, ${t.storeA1})`
  const [fabric] = await db.sql<{ id: string }[]>`insert into filter (store_id, name, position) values (${t.storeA1}, 'Fabric', 0) returning id`
  ids.cotton = (await db.sql<{ id: string }[]>`insert into filter_value (filter_id, store_id, name, position) values (${fabric?.id ?? ''}, ${t.storeA1}, 'Cotton', 0) returning id`)[0]?.id ?? ''
  ids.linen = (await db.sql<{ id: string }[]>`insert into filter_value (filter_id, store_id, name, position) values (${fabric?.id ?? ''}, ${t.storeA1}, 'Linen', 1) returning id`)[0]?.id ?? ''
  await db.sql`insert into product_filter_value (product_id, filter_value_id, store_id) values (${ids.kurta}, ${ids.cotton}, ${t.storeA1}), (${ids.shirt}, ${ids.linen}, ${t.storeA1}), (${ids.dress}, ${ids.linen}, ${t.storeA1})`
  ids.summer = (await db.sql<{ id: string }[]>`insert into collection (store_id, name, slug, kind) values (${t.storeA1}, 'Summer', 'summer', 'manual') returning id`)[0]?.id ?? ''
  await db.sql`insert into collection_product (collection_id, product_id, store_id, position, source) values (${ids.summer}, ${ids.shirt}, ${t.storeA1}, 0, 'manual'), (${ids.summer}, ${ids.dress}, ${t.storeA1}, 1, 'manual'), (${ids.summer}, ${ids.kurta}, ${t.storeA1}, 2, 'manual')`
  const [handmade] = await db.sql<{ id: string }[]>`insert into badge (store_id, label, tone, rule, position) values
    (${t.storeA1}, 'Sale', 'peach', 'below_compare_price', 0), (${t.storeA1}, 'Few left', 'peach', 'few_left', 1), (${t.storeA1}, 'Handmade', 'neutral', 'manual', 2) returning id`
  await db.sql`insert into product_badge (product_id, badge_id, store_id) select ${ids.kurta}, id, ${t.storeA1} from badge where store_id = ${t.storeA1} and rule = 'manual'`
  expect(handmade).toBeDefined()
  await db.sql`insert into product_spec (product_id, store_id, name, value, position) values (${ids.kurta}, ${t.storeA1}, 'Fabric', 'Cotton', 0)`
  await db.sql`insert into product_faq (product_id, store_id, question, answer, position) values (${ids.kurta}, ${t.storeA1}, 'Washable?', 'By hand.', 0)`
  await db.sql`insert into product_compliance (product_id, store_id, region, field, value) values (${ids.kurta}, ${t.storeA1}, 'IN', 'origin', 'India')`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const gql = async (source: string, headers: Record<string, string> = {}, variables: Record<string, unknown> = {}, on = host) => {
  const found = await resolveShopper(db.sql, new Request(`https://${on}/shop-api`, { headers }), on)
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${on}`, activity: activityLog, facts: { requestId: 'r', ip: null, userAgent: null }, now: () => new Date('2026-10-07T09:00:00Z') }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, errors: result.errors }
}
type Listing = { nodes: { slug: string; price: { amount: string; currency: string } | null; inStock: boolean; badges: { label: string }[] }[]; pageInfo: { endCursor: string | null; hasNextPage: boolean }; facets?: { name: string; values: { name: string; count: number }[] }[] }
const list = async (args: string, headers: Record<string, string> = {}) => {
  const result = await gql(`{ products${args} { nodes { slug price { amount currency } inStock badges { label } } pageInfo { endCursor hasNextPage } facets { name values { name count } } } }`, headers)
  return { listing: result.data?.['products'] as Listing | undefined, code: result.code }
}
const slugs = (l: Listing | undefined) => l?.nodes.map((n) => n.slug)

describe('products', () => {
  it('lists the market’s products newest first, leaving out what it doesn’t sell and what shoppers can’t see', async () => {
    const { listing } = await list('')
    expect(slugs(listing)).toEqual(['kurta', 'dress'])
    expect(listing?.nodes[0]).toEqual({ slug: 'kurta', price: { amount: '99900', currency: 'INR' }, inStock: true, badges: [{ label: 'Sale' }, { label: 'Few left' }, { label: 'Handmade' }] })
  })

  it('sorts by price either way and by name, a page at a time, with a cursor that never crosses sorts', async () => {
    expect(slugs((await list('(sort: PRICE_HIGH)')).listing)).toEqual(['dress', 'kurta'])
    expect(slugs((await list('(sort: NAME)')).listing)).toEqual(['dress', 'kurta'])
    const first = (await list('(sort: PRICE_LOW, first: 1)')).listing
    expect([slugs(first), first?.pageInfo.hasNextPage]).toEqual([['kurta'], true])
    const second = (await list(`(sort: PRICE_LOW, first: 1, after: "${first?.pageInfo.endCursor ?? ''}")`)).listing
    expect([slugs(second), second?.pageInfo.hasNextPage]).toEqual([['dress'], false])
    expect((await list(`(sort: NAME, after: "${first?.pageInfo.endCursor ?? ''}")`)).code).toBe('INVALID_CURSOR')
    expect((await list('(sort: COLLECTION)')).code).toBe('INVALID_INPUT')
  })

  it('pages newest first through its own cursor, and refuses a tampered cursor value as INVALID_CURSOR, never a database error', async () => {
    const first = (await list('(first: 1)')).listing
    expect(slugs((await list(`(first: 1, after: "${first?.pageInfo.endCursor ?? ''}")`)).listing)).toEqual(['dress'])
    const forged = (sort: string, value: string) => encodeValueCursor({ sort, value, id: ids.kurta })
    for (const [sort, arg, value] of [['price_low', 'PRICE_LOW', 'abc'], ['price_high', 'PRICE_HIGH', '99999999999999999999'], ['newest', 'NEWEST', '2026-02-30 00:00:00+00'], ['newest', 'NEWEST', 'yesterday'], ['name', 'NAME', 'x\u0000']] as const) {
      expect((await list(`(sort: ${arg}, after: ${JSON.stringify(forged(sort, value))})`)).code).toBe('INVALID_CURSOR')
    }
    expect((await list(`(collection: "summer", sort: COLLECTION, after: ${JSON.stringify(forged('collection', '1.5'))})`)).code).toBe('INVALID_CURSOR')
  })

  it('lists a collection in its own order, and another market’s products at its prices in its currency', async () => {
    expect(slugs((await list('(collection: "summer")')).listing)).toEqual(['dress', 'kurta'])
    const usa = (await list('(collection: "summer")', { 'x-shop-market': ids.usa })).listing
    expect(slugs(usa)).toEqual(['shirt', 'dress', 'kurta'])
    expect(usa?.nodes.map((n) => n.price?.currency)).toEqual(['USD', 'USD', 'USD'])
    expect(usa?.nodes[0]?.price?.amount).toMatch(/99$/)
    expect(slugs((await list('(collection: "nowhere")')).listing)).toEqual([])
  })

  it('narrows by filter choices and counts each value before the choice', async () => {
    const { listing } = await list(`(filters: ["${ids.cotton}"])`)
    expect(slugs(listing)).toEqual(['kurta'])
    expect(listing?.facets).toEqual([{ name: 'Fabric', values: [{ name: 'Cotton', count: 1 }, { name: 'Linen', count: 1 }] }])
    expect(slugs((await list(`(filters: ["${ids.cotton}", "${ids.linen}"])`)).listing)).toEqual(['kurta', 'dress'])
    expect((await list('(filters: ["nope"])')).code).toBe('INVALID_INPUT')
  })

  it('searches by words, in the shopper’s language too', async () => {
    const found = await gql('{ search(query: "kurta") { nodes { slug } } }')
    expect(found.data?.['search']).toEqual({ nodes: [{ slug: 'kurta' }] })
    expect((await gql('{ search(query: "कुर्ता") { nodes { name: slug } } }', { 'x-shop-language': 'hi-IN' })).data?.['search']).toEqual({ nodes: [{ name: 'kurta-hi' }] })
    // A blank search is refused, never the whole catalogue (#441's review).
    for (const query of ['', '   ']) expect((await gql(`{ search(query: "${query}") { nodes { slug } } }`)).errors?.[0]?.extensions['code']).toBe('INVALID_INPUT')
  })
})

describe('a product page', () => {
  const page = `query P($slug: String!) { product(slug: $slug) {
    name price { amount } compareAt { amount } inStock soldHere badges { label }
    options { name values { name } } versions { price { amount } compareAt { amount } available inStock choices { optionId } }
    specs { name value } faqs { question } highlights compliance { region field value } filters { filter value } photos { image { url } }
  } }`

  it('shows each version’s price, compare-at and stock, and the sections the store has switched on', async () => {
    const result = await gql(page, {}, { slug: 'kurta' })
    expect(result.data?.['product']).toMatchObject({
      name: 'Kurta',
      price: { amount: '99900' },
      compareAt: null,
      inStock: true,
      soldHere: true,
      options: [{ name: 'Colour', values: [{ name: 'Red' }] }],
      versions: [
        { price: { amount: '149900' }, compareAt: { amount: '199900' }, available: 3, inStock: true, choices: [{ optionId: ids.colour }] },
        { price: { amount: '99900' }, compareAt: null, available: 0, inStock: false, choices: [] },
      ],
      specs: [{ name: 'Fabric', value: 'Cotton' }],
      faqs: [],
      filters: [{ filter: 'Fabric', value: 'Cotton' }],
    })
    await db.sql`insert into store_feature (store_id, key, enabled) values (${t.storeA1}, 'faqs', true), (${t.storeA1}, 'specs', false)`
    expect((await gql(page, {}, { slug: 'kurta' })).data?.['product']).toMatchObject({ faqs: [{ question: 'Washable?' }], specs: [] })
  })

  it('shows related and compared products only where the market sells them, at most ten', async () => {
    await db.sql`insert into store_feature (store_id, key, enabled) values (${t.storeA1}, 'related', true) on conflict (store_id, key) do update set enabled = true`
    await db.sql`insert into product_related (product_id, related_product_id, store_id, position) values (${ids.kurta}, ${ids.shirt}, ${t.storeA1}, 0), (${ids.kurta}, ${ids.dress}, ${t.storeA1}, 1)`
    await db.sql`insert into product_story (product_id, store_id, draft, live, published_at) values
      (${ids.kurta}, ${t.storeA1}, '[]', ${db.sql.json([{ id: 'm1', kind: 'compare', title: null, productIds: [ids.shirt, ids.dress] }])}, now())`
    const result = await gql('{ product(slug: "kurta") { related { slug } story { kind products { slug } } } }')
    expect(result.data?.['product']).toEqual({ related: [{ slug: 'dress' }], story: [{ kind: 'compare', products: [{ slug: 'dress' }] }] })
    const usa = await gql('{ product(slug: "kurta") { related { slug } } }', { 'x-shop-market': ids.usa })
    expect(usa.data?.['product']).toEqual({ related: [{ slug: 'shirt' }, { slug: 'dress' }] })
  })

  it('finds it by its web address in the shopper’s language, and says when the market can’t sell it', async () => {
    expect((await gql('{ product(slug: "kurta-hi") { name } }', { 'x-shop-language': 'hi-IN' })).data?.['product']).toEqual({ name: 'कुर्ता' })
    expect((await gql('{ product(slug: "shirt") { soldHere } }')).data?.['product']).toEqual({ soldHere: false })
    expect((await gql('{ product(slug: "dress") { soldHere } }')).data?.['product']).toEqual({ soldHere: false })
    expect((await gql('{ product(slug: "hidden-kurta") { name } }')).data?.['product']).toBeNull()
  })
})

describe('stock a storefront may read (migration 0065)', () => {
  const shopper = (storeId: string, partnerId: string): TenantContext => ({ caller: { kind: 'shopper', customerId: null }, partnerId, storeId, sellerScope: { kind: 'all' }, subscription: 'active' })
  const stock = (context: TenantContext, versionIds: string[]) => withScope(db.sql, context, (tx) => tx<{ version_id: string; available: number }[]>`select version_id, available from shop_stock(${pgArray(versionIds)}::uuid[])`)

  it('answers for its own store’s visible versions only: never a hidden product’s, nor another store’s', async () => {
    expect(await stock(shopper(t.storeA1, t.partnerA), [ids.red, ids.hiddenVersion, ids.otherVersion])).toEqual([{ version_id: ids.red, available: 3 }])
    expect(await stock(shopper(t.storeB1, t.partnerB), [ids.red])).toEqual([])
  })

  it('answers nothing outside shop scope, and only app_shop may call it', async () => {
    const merchant: TenantContext = { caller: { kind: 'person', userId: 'u', sessionId: 's' }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' }, subscription: 'active' }
    await expect(withScope(db.sql, merchant, (tx) => tx`select * from shop_stock(${pgArray([ids.red])}::uuid[])`)).rejects.toThrow(/permission denied/)
  })
})

describe('limits and isolation (#441’s review)', () => {
  const theirs = 'store-b1.shops.bolt.example'

  it('caps a page at 50, a search at 100 characters and filter choices at 50, and reads % and _ as themselves', async () => {
    const many = await Promise.all(Array.from({ length: 51 }, (_, i) => product(t.storeB1, `bulk-${i}`, '2026-10-01T00:00:00Z')))
    await Promise.all(many.map((id, i) => version(t.storeB1, id, String(1000 + i), null, 0, null)))
    const page = (await gql('{ products(first: 500) { nodes { slug } pageInfo { hasNextPage } } }', {}, {}, theirs)).data?.['products'] as { nodes: unknown[]; pageInfo: { hasNextPage: boolean } }
    expect([page.nodes.length, page.pageInfo.hasNextPage]).toEqual([50, true])
    expect((await list(`(search: "${'x'.repeat(101)}")`)).code).toBe('INVALID_INPUT')
    expect((await list(`(filters: [${Array.from({ length: 51 }, () => `"${crypto.randomUUID()}"`).join(', ')}])`)).code).toBe('INVALID_INPUT')
    expect(slugs((await list('(search: "%")')).listing)).toEqual([])
    expect(slugs((await list('(search: "_")')).listing)).toEqual([])
  })

  it('refuses a tampered cursor on every sort, after or before', async () => {
    const forged = (sort: string, value: string) => JSON.stringify(encodeValueCursor({ sort, value, id: ids.kurta }))
    for (const [sort, arg] of [['newest', 'NEWEST'], ['price_low', 'PRICE_LOW'], ['price_high', 'PRICE_HIGH'], ['name', 'NAME']] as const) {
      const bad = sort === 'name' ? 'x\u0000' : 'nope'
      expect((await list(`(sort: ${arg}, after: ${forged(sort, bad)})`)).code).toBe('INVALID_CURSOR')
      expect((await list(`(sort: ${arg}, before: ${forged(sort, bad)})`)).code).toBe('INVALID_CURSOR')
    }
  })

  it('shows another store’s shopper only that store’s product of the same address, and none of this store’s filters, collections or markets', async () => {
    const page = await gql(`{ product(slug: "kurta") { id } products(filters: ["${ids.cotton}"]) { nodes { slug } facets { name } } }`, {}, {}, theirs)
    expect(page.data?.['product']).toEqual({ id: ids.other })
    expect(page.data?.['products']).toEqual({ nodes: [], facets: [] })
    expect(((await gql('{ products(collection: "summer") { nodes { slug } } }', {}, {}, theirs)).data?.['products'] as { nodes: unknown[] }).nodes).toEqual([])
    expect((await gql('{ store { marketId currency } }', { 'x-shop-market': ids.usa }, {}, theirs)).data?.['store']).toEqual({ marketId: null, currency: 'INR' })
  })
})
