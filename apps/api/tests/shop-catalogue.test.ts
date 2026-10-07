import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveShopper, type Shopper } from '#auth/shopCaller'
import type { TenantContext } from '#core/tenancy'
import { withScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #306 (SAPI 8), part 1: the Shop API finds its store by the storefront's host or public key and shows only what
// shoppers may see (PLATFORM-PROMPT §5.5; DATA-MODEL §7.11), as app_shop.

let db: TestDatabase
let t: Tenants
const keys: Record<'a1' | 'a2' | 'b1', string> = { a1: '', a2: '', b1: '' }
const ids = { visible: '', hidden: '', pending: '', sample: '', later: '', deleted: '', other: '', shirts: '', secret: '', photo: '', hiddenPhoto: '', invoice: '' }

const product = async (storeId: string, slug: string, over: Record<string, unknown> = {}) => {
  const [row] = await db.sql<{ id: string }[]>`insert into product ${db.sql({ store_id: storeId, name: slug, slug, visibility: 'visible', ...over })} returning id`
  return row?.id ?? ''
}
const asset = async (storeId: string) =>
  (await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum) values (${storeId}, ${`stores/${storeId}/assets/${crypto.randomUUID()}.png`}, 'image', 'image/png', 10, ${'0'.repeat(64)}) returning id`)[0]?.id ?? ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set pricing_currency = 'INR', country = 'IN', status = 'active' where id in (${t.storeA1}, ${t.storeA2}, ${t.storeB1})`
  await db.sql`update partner set state = 'live' where id in (${t.partnerA}, ${t.partnerB})`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values
    (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x'), (${t.partnerA}, 'preview', '*.preview.acme.example', 'live', 'CNAME', 'x'),
    (${t.partnerB}, 'shops', '*.shops.bolt.example', 'waiting', 'CNAME', 'x')`
  await db.sql`insert into custom_domain (store_id, host, status, expected_cname, ownership_token) values (${t.storeA2}, 'www.a2-shop.example', 'live', 'x', 'y')`
  for (const [k, id] of [['a1', t.storeA1], ['a2', t.storeA2], ['b1', t.storeB1]] as const) {
    keys[k] = (await db.sql<{ k: string }[]>`select public_store_key as k from storefront where store_id = ${id}`)[0]?.k ?? ''
  }
  await db.sql`insert into store_language (store_id, language, status, position) values (${t.storeA1}, 'hi-IN', 'active', 1)`
  ids.visible = await product(t.storeA1, 'kurta')
  ids.hidden = await product(t.storeA1, 'hidden-kurta', { visibility: 'hidden' })
  ids.pending = await product(t.storeA1, 'pending-kurta', { seller_id: t.sellerA1First, approval_status: 'pending' })
  ids.sample = await product(t.storeA1, 'sample-kurta', { is_sample: true })
  ids.later = await product(t.storeA1, 'later-kurta', { publish_at: new Date(Date.now() + 86_400_000) })
  ids.deleted = await product(t.storeA1, 'gone-kurta', { deleted_at: new Date() })
  ids.other = await product(t.storeB1, 'their-kurta')
  ids.photo = await asset(t.storeA1)
  ids.hiddenPhoto = await asset(t.storeA1)
  ids.invoice = await asset(t.storeA1)
  await db.sql`insert into product_photo (product_id, store_id, asset_id, position) values (${ids.visible}, ${t.storeA1}, ${ids.photo}, 0), (${ids.hidden}, ${t.storeA1}, ${ids.hiddenPhoto}, 0)`
  await db.sql`insert into translation (store_id, entity, entity_id, field, language, text, source_hash) values
    (${t.storeA1}, 'product', ${ids.hidden}, 'slug', 'hi-IN', 'chhupa-kurta', ${'0'.repeat(32)})`
  ids.shirts = (await db.sql<{ id: string }[]>`insert into collection (store_id, name, slug, kind) values (${t.storeA1}, 'Shirts', 'shirts', 'manual') returning id`)[0]?.id ?? ''
  ids.secret = (await db.sql<{ id: string }[]>`insert into collection (store_id, name, slug, kind, visibility) values (${t.storeA1}, 'Secret', 'secret', 'manual', 'hidden') returning id`)[0]?.id ?? ''
  await db.sql`insert into translation (store_id, entity, entity_id, field, language, text, source_hash) values
    (${t.storeA1}, 'collection', ${ids.shirts}, 'name', 'hi-IN', 'कमीज़', ${'0'.repeat(32)}), (${t.storeA1}, 'collection', ${ids.shirts}, 'slug', 'hi-IN', 'kameez', ${'0'.repeat(32)})`
  await db.sql`insert into collection (store_id, name, slug, kind) values (${t.storeB1}, 'Their shirts', 'shirts', 'manual')`
  const [menu] = await db.sql<{ id: string }[]>`insert into menu (store_id, key, name) values (${t.storeA1}, 'main', 'Main') returning id`
  const [top] = await db.sql<{ id: string }[]>`insert into menu_item (menu_id, store_id, label, kind, collection_id, position) values (${menu?.id ?? ''}, ${t.storeA1}, 'Shirts', 'collection', ${ids.shirts}, 0) returning id`
  const [secret] = await db.sql<{ id: string }[]>`insert into menu_item (menu_id, store_id, label, kind, collection_id, position) values (${menu?.id ?? ''}, ${t.storeA1}, 'Secret', 'collection', ${ids.secret}, 1) returning id`
  await db.sql`insert into menu_item (menu_id, store_id, parent_id, label, kind, url, position) values
    (${menu?.id ?? ''}, ${t.storeA1}, ${top?.id ?? ''}, 'About', 'page', '/about', 0), (${menu?.id ?? ''}, ${t.storeA1}, ${secret?.id ?? ''}, 'Under secret', 'page', '/x', 0)`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const resolve = (host: string, headers: Record<string, string> = {}) => resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers }), host)
const shopperOn = async (host: string, headers: Record<string, string> = {}): Promise<Shopper> => {
  const found = await resolve(host, headers)
  if (found.kind !== 'found') throw new Error(`no store on ${host}`)
  return found.shopper
}
const gql = async (host: string, source: string, headers: Record<string, string> = {}, variables: Record<string, unknown> = {}) => {
  const shopper = await shopperOn(host, headers)
  const contextValue: ShopContext = { sql: db.sql, shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: null, userAgent: null }, allowNewCart: async () => true, now: () => new Date() }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const asShopper = (storeId: string, partnerId = t.partnerA): TenantContext => ({ caller: { kind: 'shopper', customerId: null }, partnerId, storeId, sellerScope: { kind: 'all' }, subscription: 'active' })

describe('finding the store', () => {
  it('takes it from the storefront’s host: its code under the partner’s shops or preview wildcard, or its live domain', async () => {
    expect((await shopperOn('store-a1.shops.acme.example')).context.storeId).toBe(t.storeA1)
    expect((await shopperOn('STORE-A1.preview.acme.example')).context.storeId).toBe(t.storeA1)
    expect((await shopperOn('store-a2.shops.acme.example')).context.storeId).toBe(t.storeA2)
    expect((await shopperOn('www.a2-shop.example')).context.storeId).toBe(t.storeA2)
  })

  it('never serves store X on store Y’s host: a key naming another store is refused, not followed', async () => {
    expect(await resolve('store-a2.shops.acme.example', { 'x-shop-key': keys.a1 })).toEqual({ kind: 'key-mismatch' })
    expect(await resolve('www.a2-shop.example', { 'x-shop-key': 'pk_' + '0'.repeat(32) })).toEqual({ kind: 'key-mismatch' })
    expect((await shopperOn('store-a2.shops.acme.example', { 'x-shop-key': keys.a2 })).context.storeId).toBe(t.storeA2)
  })

  it('takes it from the public key alone on a host no storefront holds', async () => {
    expect((await shopperOn('api.example', { 'x-shop-key': keys.b1 })).context.storeId).toBe(t.storeB1)
    expect(await resolve('api.example')).toEqual({ kind: 'unknown' })
    expect(await resolve('api.example', { 'x-shop-key': 'pk_nope' })).toEqual({ kind: 'unknown' })
    // A closed partner's stores are served by neither host nor key.
    await db.sql`update partner set state = 'closed' where id in (${t.partnerA}, ${t.partnerB})`
    expect(await resolve('api.example', { 'x-shop-key': keys.b1 })).toEqual({ kind: 'unknown' })
    expect(await resolve('www.a2-shop.example')).toEqual({ kind: 'unknown' })
    expect(await resolve('store-a1.shops.acme.example')).toEqual({ kind: 'unknown' })
    await db.sql`update partner set state = 'live' where id in (${t.partnerA}, ${t.partnerB})`
    expect((await shopperOn('www.a2-shop.example')).context.storeId).toBe(t.storeA2)
  })

  it('knows no store on another partner’s wildcard, a wildcard not yet checked, or a code no store has', async () => {
    expect(await resolve('store-b1.shops.acme.example')).toEqual({ kind: 'unknown' })
    expect(await resolve('store-b1.shops.bolt.example')).toEqual({ kind: 'unknown' })
    expect(await resolve('nobody.shops.acme.example')).toEqual({ kind: 'unknown' })
    expect(await resolve('shops.acme.example')).toEqual({ kind: 'unknown' })
  })

  it('reads in a language and currency the store offers, falling back to its own for any other', async () => {
    expect(await shopperOn('store-a1.shops.acme.example', { 'x-shop-language': 'hi-IN', 'x-shop-currency': 'usd' })).toMatchObject({ language: 'hi-IN', currency: 'INR', marketId: null })
    expect(await shopperOn('store-a1.shops.acme.example', { 'x-shop-language': 'fr-FR' })).toMatchObject({ language: 'en-US' })
  })

  it('answers a suspended store’s catalogue as unavailable, while a past-due one keeps selling', async () => {
    await db.sql`update store set status = 'suspended', suspended_at = now(), suspended_reason = 'unpaid', suspended_previous_status = 'active' where id = ${t.storeA2}`
    expect((await gql('store-a2.shops.acme.example', '{ store { name } }')).code).toBe('STORE_UNAVAILABLE')
    await db.sql`update store set status = 'past_due', suspended_at = null, suspended_reason = null, suspended_previous_status = null where id = ${t.storeA2}`
    expect((await gql('store-a2.shops.acme.example', '{ store { name } }')).data?.['store']).toEqual({ name: 'Store A2' })
    await db.sql`update store set status = 'active' where id = ${t.storeA2}`
  })
})

describe('the catalogue a shopper reads', () => {
  it('shows the store’s public facts, never another store’s', async () => {
    const { data } = await gql('store-a1.shops.acme.example', '{ store { name pricingCurrency mainLanguage languages currencies { code } markets { name primary currency } language currency } }')
    expect(data?.['store']).toEqual({ name: 'Store A1', pricingCurrency: 'INR', mainLanguage: 'en-US', languages: ['en-US', 'hi-IN'], currencies: [], markets: [{ name: 'Home', primary: true, currency: 'INR' }], language: 'en-US', currency: 'INR' })
  })

  it('lists visible collections a page at a time, at most 50, and finds one by its web address in the shopper’s language', async () => {
    const list = await gql('store-a1.shops.acme.example', '{ collections(first: 500) { nodes { name slug } pageInfo { hasNextPage } } }')
    expect(list.data?.['collections']).toEqual({ nodes: [{ name: 'Shirts', slug: 'shirts' }], pageInfo: { hasNextPage: false } })
    expect((await gql('store-a1.shops.acme.example', '{ collections(after: "nope") { nodes { id } } }')).code).toBe('INVALID_CURSOR')
    const hindi = { 'x-shop-language': 'hi-IN' }
    expect((await gql('store-a1.shops.acme.example', '{ collection(slug: "kameez") { name slug } }', hindi)).data?.['collection']).toEqual({ name: 'कमीज़', slug: 'kameez' })
    expect((await gql('store-a1.shops.acme.example', '{ collection(slug: "shirts") { name } }', hindi)).data?.['collection']).toEqual({ name: 'कमीज़' })
    expect((await gql('store-a1.shops.acme.example', '{ collection(slug: "secret") { name } }')).data?.['collection']).toBeNull()
  })

  it('builds the menu, leaving out a link to a hidden collection with everything under it', async () => {
    const { data } = await gql('store-a1.shops.acme.example', '{ menu { label kind collectionSlug children { label kind url } } }', { 'x-shop-language': 'hi-IN' })
    expect(data?.['menu']).toEqual([{ label: 'Shirts', kind: 'collection', collectionSlug: 'kameez', children: [{ label: 'About', kind: 'page', url: '/about' }] }])
  })

  it('serves at most 300 menu items, however many the store has', async () => {
    const [menu] = await db.sql<{ id: string }[]>`select id from menu where store_id = ${t.storeA1} and key = 'main'`
    await db.sql`insert into menu_item (menu_id, store_id, label, kind, url, position) select ${menu?.id ?? ''}, ${t.storeA1}, 'Page ' || n, 'page', '/p' || n, 10 + n from generate_series(1, 305) n`
    try {
      const { data } = await gql('store-a1.shops.acme.example', '{ menu { label children { label } } }')
      const served = (data?.['menu'] as { children: unknown[] }[]).reduce((sum, item) => sum + 1 + item.children.length, 0)
      expect(served).toBeLessThanOrEqual(300)
    } finally {
      await db.sql`delete from menu_item where store_id = ${t.storeA1} and url like '/p%'`
    }
  })
})

describe('isolation (DATA-MODEL §7.11)', () => {
  const count = (context: TenantContext, table: string) => withScope(db.sql, context, async (tx) => Number((await tx.unsafe<{ n: string }[]>(`select count(*)::text as n from ${table}`))[0]?.n))

  it('reaches only visible, approved, published, real products of its own store, and their children', async () => {
    expect(await withScope(db.sql, asShopper(t.storeA1), async (tx) => (await tx<{ id: string }[]>`select id from product`).map((r) => r.id))).toEqual([ids.visible])
    expect(await count(asShopper(t.storeA1), 'product_photo')).toBe(1)
    expect(await count(asShopper(t.storeA1), 'translation')).toBe(2)
    expect(await count(asShopper(t.storeA1), 'collection')).toBe(1)
    expect(await count(asShopper(t.storeB1, t.partnerB), 'collection')).toBe(1)
    expect(await count(asShopper(t.storeB1, t.partnerB), 'product_photo')).toBe(0)
  })

  it('reads a file only while something shoppers see shows it: never a hidden product’s photo or an unreferenced file', async () => {
    const files = await withScope(db.sql, asShopper(t.storeA1), async (tx) => (await tx<{ id: string }[]>`select id from asset`).map((r) => r.id))
    expect(files).toEqual([ids.photo])
    expect(await count(asShopper(t.storeA2), 'asset')).toBe(0)
  })

  it('never selects a supplier id, a cost, a draft story, a credential or the order counter', async () => {
    for (const [table, column] of [['product', 'seller_id'], ['product_version', 'cost_amount'], ['product_story', 'draft'], ['store', 'next_order_number'], ['customer', 'password_hash'], ['product', 'sent_back_reason'], ['activity_log', 'ip'], ['activity_log', 'actor_id'], ['activity_log', 'changes']] as const) {
      await expect(withScope(db.sql, asShopper(t.storeA1), (tx) => tx.unsafe(`select ${column} from ${table}`))).rejects.toThrow(/permission denied/)
    }
    for (const table of ['seller', 'stock_level', 'invoice_settings', 'delivery_postal_code', 'storefront', 'membership']) {
      await expect(withScope(db.sql, asShopper(t.storeA1), (tx) => tx.unsafe(`select 1 from ${table}`))).rejects.toThrow(/permission denied/)
    }
  })

  it('never learns of a hidden product through a market’s exclusions', async () => {
    const [market] = await db.sql<{ id: string }[]>`insert into market (store_id, name, currency, language, status, countries) values (${t.storeA1}, 'Gulf', 'INR', 'en-IN', 'active', '["AE"]') returning id`
    await db.sql`insert into market_excluded_product (market_id, product_id, store_id) values (${market?.id ?? ''}, ${ids.visible}, ${t.storeA1}), (${market?.id ?? ''}, ${ids.hidden}, ${t.storeA1})`
    const seen = await withScope(db.sql, asShopper(t.storeA1), async (tx) => (await tx<{ product_id: string }[]>`select product_id from market_excluded_product`).map((r) => r.product_id))
    expect(seen).toEqual([ids.visible])
  })

  it('reads option and choice name translations only of options a visible product carries', async () => {
    await db.sql`insert into product_option (product_id, store_id, name, position) values (${ids.visible}, ${t.storeA1}, 'Size', 0), (${ids.hidden}, ${t.storeA1}, 'Limited Edition Gold', 0)`
    await db.sql`insert into translation (store_id, entity, entity_id, field, language, text, source_hash) values
      (${t.storeA1}, 'option_name', 'size', 'name', 'hi-IN', 'साइज़', ${'0'.repeat(32)}), (${t.storeA1}, 'option_name', 'limited edition gold', 'name', 'hi-IN', 'सोना', ${'0'.repeat(32)})`
    try {
      const seen = await withScope(db.sql, asShopper(t.storeA1), async (tx) => (await tx<{ entity_id: string }[]>`select entity_id from translation where entity = 'option_name'`).map((r) => r.entity_id))
      expect(seen).toEqual(['size'])
    } finally {
      await db.sql`delete from translation where entity = 'option_name' and store_id = ${t.storeA1}`
      await db.sql`delete from product_option where product_id in (${ids.visible}, ${ids.hidden})`
    }
  })

  it('writes nothing in the catalogue', async () => {
    await expect(withScope(db.sql, asShopper(t.storeA1), (tx) => tx`update product set name = 'x' where id = ${ids.visible}`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, asShopper(t.storeA1), (tx) => tx`insert into collection (store_id, name, slug, kind) values (${t.storeA1}, 'x', 'x', 'manual')`)).rejects.toThrow(/permission denied/)
  })

  it('stays in shop scope: app_shop under another scope reads nothing', async () => {
    const rows = await db.sql.begin(async (tx) => {
      await tx.unsafe('set local role app_shop')
      await tx`select set_config('app.scope', 'store', true), set_config('app.store_id', ${t.storeA1}, true), set_config('app.seller_id', '', true)`
      return tx`select id from product`
    })
    expect(rows).toHaveLength(0)
  })

  it('moves the store’s catalogue version on each change a storefront shows, and only that store’s', async () => {
    const version = async (storeId: string) => (await db.sql<{ v: string }[]>`select catalog_version::text as v from storefront where store_id = ${storeId}`)[0]?.v
    const [a1, b1] = [await version(t.storeA1), await version(t.storeB1)]
    await db.sql`update product set name = 'Kurta' where id = ${ids.visible}`
    expect(Number(await version(t.storeA1))).toBe(Number(a1) + 1)
    expect(await version(t.storeB1)).toBe(b1)
    await db.sql`update store set name = 'Store A1' where id = ${t.storeA1}`
    expect(Number(await version(t.storeA1))).toBe(Number(a1) + 2)
    // A section switched off is a change a storefront shows.
    await db.sql`insert into store_feature (store_id, key, enabled) values (${t.storeA1}, 'faqs', true)`
    expect(Number(await version(t.storeA1))).toBe(Number(a1) + 3)
    // The country the store's address shows.
    await db.sql`update store set country = 'AE' where id = ${t.storeA1}`
    expect(Number(await version(t.storeA1))).toBe(Number(a1) + 4)
  })

  it('gives a store converting prices a new version when the reference rate is republished, and only such a store', async () => {
    const seen = async () => (await shopperOn('store-a1.shops.acme.example')).catalogVersion
    const plain = await seen()
    await db.sql`insert into exchange_rate (currency, per_euro, source, published_on, fetched_at) values ('USD', '1.08', 'ecb', '2026-10-06', now()) on conflict (currency) do update set published_on = '2026-10-06'`
    expect(await seen()).toBe(plain)
    await db.sql`insert into store_currency (store_id, currency, mode, rounding, status, position) values (${t.storeA1}, 'USD', 'convert', 'none', 'active', 9) on conflict (store_id, currency) do update set mode = 'convert', status = 'active'`
    const converting = await seen()
    expect(converting).not.toBe(plain)
    await db.sql`update exchange_rate set published_on = '2026-10-07', per_euro = '1.09' where currency = 'USD'`
    expect(await seen()).not.toBe(converting)
    expect((await shopperOn('api.example', { 'x-shop-key': keys.b1 })).catalogVersion).not.toContain('.')
  })
})
