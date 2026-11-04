import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CallerContext, SellerScope, TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { rankBestSellers } from '#db/scoped/productRank'
import { selectStoreSummary } from '#db/scoped/storeSummary'
import { buildStoreSummary, freshSummary, storeLookups, summaryMaxAgeMs, type StoreSummary } from '#saas/ai-designer/summary'
import type { KeptSummary } from '#saas/studio/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// #1242 part 2: the studio AI's store summary and read-only lookups. One store's rows only, no personal data, a city only
// with 5 orders, each lookup one query, and the summary kept beside the studio for 10 minutes.

let db: TestDatabase
let t: Tenants
let sent: string[] = []
let counted: postgres.Sql
const now = new Date('2026-11-04T09:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000)
const ids: Record<string, string> = {}

const person = (storeId: string, partnerId: string, sellerScope: SellerScope = { kind: 'all' }): TenantContext => ({ caller: { kind: 'person', userId: '00000000-0000-4000-8000-0000000000aa', sessionId: 's' }, partnerId, storeId, sellerScope, subscription: 'active' })
const shopper = (storeId: string, partnerId: string): CallerContext => ({ caller: { kind: 'shopper', customerId: null }, partnerId, storeId, sellerScope: { kind: 'all' }, subscription: 'active' })

const product = async (storeId: string, slug: string, name: string, amount: number, created: string) => {
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility, created_at, description) values (${storeId}, ${name}, ${slug}, 'visible', ${new Date(created)}, ${`About ${name}.`}) returning id`
  const [v] = await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, track_stock) values (${storeId}, ${p?.id ?? ''}, ${`S-${slug}-${storeId.slice(0, 4)}`}, 0, false) returning id`
  await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${v?.id ?? ''}, ${storeId}, 'INR', ${amount})`
  ids[`${slug}@${storeId}`] = p?.id ?? ''
  ids[`${slug}@${storeId}:v`] = v?.id ?? ''
  return p?.id ?? ''
}

let orders = 0
/** A shopper's order: their name, email, phone and address are on it, and must never reach the AI. */
const order = async (storeId: string, slug: string, quantity: number, city: string, who: { name: string; email: string; phone: string; street: string }) => {
  orders += 1
  const [o] = await db.sql<{ id: string }[]>`
    insert into "order" (store_id, state, payment_state, currency, email, phone, shipping_address, number, placed_at, subtotal_amount, shipping_amount, tax_amount, total_amount, refunded_amount, payment_method)
    values (${storeId}, 'placed', 'paid', 'INR', ${who.email}, ${who.phone}, ${db.sql.json({ name: who.name, line1: who.street, city, postal: '411001', country: 'IN', phone: who.phone })},
      ${`ORD-77${orders}`}, ${daysAgo(2)}, 1000, 0, 0, 1000, 0, 'stripe')
    returning id`
  await db.sql`insert into order_line (order_id, store_id, version_id, product_id, name, quantity, unit_amount, line_total_amount, position)
    values (${o?.id ?? ''}, ${storeId}, ${ids[`${slug}@${storeId}:v`] ?? ''}, ${ids[`${slug}@${storeId}`] ?? ''}, ${slug}, ${quantity}, 1000, ${1000 * quantity}, 0)`
}

const priya = { name: 'Priya Sharma', email: 'priya.sharma@example.com', phone: '+919811100001', street: '14 MG Road' }
const arjun = { name: 'Arjun Mehta', email: 'arjun.mehta@example.com', phone: '+919811100002', street: '7 Laxmi Lane' }
const shoppers = [priya, arjun]

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  counted = postgres(db.url, { max: 1, fetch_types: false, debug: (_c, query) => void sent.push(query.replaceAll(/\s+/g, ' ').trim()) })
  await db.sql`update store set pricing_currency = 'INR', country = 'IN', status = 'active' where id in (${t.storeA1}, ${t.storeB1})`
  await db.sql`update store set address = ${db.sql.json({ city: 'Pune', street: '1 Shop Street' })} where id = ${t.storeA1}`
  await db.sql`update store set address = ${db.sql.json({ city: 'Mumbai', street: '2 Other Street' })} where id = ${t.storeB1}`
  const [logo] = await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum) values (${t.storeA1}, ${`stores/${t.storeA1}/assets/${crypto.randomUUID()}.png`}, 'image', 'image/png', 10, ${'0'.repeat(64)}) returning id`
  await db.sql`insert into storefront_brand (store_id, logo_asset_id, tagline, voice, primary_colour) values (${t.storeA1}, ${logo?.id ?? ''}, 'Linen for warm days', 'warm', '#224466')`
  await product(t.storeA1, 'linen-shirt', 'Linen shirt', 149900, '2026-10-01')
  await product(t.storeA1, 'cotton-kurta', 'Cotton kurta', 99900, '2026-10-02')
  await product(t.storeA1, 'silk-scarf', 'Silk scarf', 59900, '2026-10-03')
  await product(t.storeB1, 'b-saree', 'Store B saree', 500000, '2026-10-01')
  const summer = (await db.sql<{ id: string }[]>`insert into collection (store_id, name, slug, kind) values (${t.storeA1}, 'Summer', 'summer', 'manual') returning id`)[0]?.id ?? ''
  await db.sql`insert into collection_product (collection_id, product_id, store_id, position, source) values (${summer}, ${ids[`linen-shirt@${t.storeA1}`] ?? ''}, ${t.storeA1}, 0, 'manual')`
  await db.sql`insert into collection (store_id, name, slug, kind) values (${t.storeB1}, 'Store B festive', 'b-festive', 'manual')`
  const photo = async (storeId: string, slug: string, bytes: number) => {
    const [a] = await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum) values (${storeId}, ${`stores/${storeId}/assets/${crypto.randomUUID()}.png`}, 'image', 'image/png', ${bytes}, ${'0'.repeat(64)}) returning id`
    await db.sql`insert into product_photo (product_id, store_id, asset_id, position) values (${ids[`${slug}@${storeId}`] ?? ''}, ${storeId}, ${a?.id ?? ''}, 0)`
    return a?.id ?? ''
  }
  ids['photo'] = await photo(t.storeA1, 'linen-shirt', 10)
  ids['bphoto'] = await photo(t.storeB1, 'b-saree', 10)

  // Pune: 5 shoppers (named); Nashik: 4 shoppers, and Thane 5 orders from one shopper (both left out). Store B's Delhi
  // sells more than any of A's.
  const someone = (i: number) => (i === 0 ? priya : i === 1 ? arjun : { name: `Shopper ${i}`, email: `shopper${i}@example.com`, phone: `+91981110010${i}`, street: `${i} Park Street` })
  for (let i = 0; i < 5; i += 1) await order(t.storeA1, 'linen-shirt', 2, i % 2 ? 'pune' : ' Pune ', someone(i))
  for (let i = 0; i < 4; i += 1) await order(t.storeA1, 'cotton-kurta', 1, 'Nashik', someone(i))
  for (let i = 0; i < 5; i += 1) await order(t.storeA1, 'cotton-kurta', 1, 'Thane', priya)
  for (let i = 0; i < 6; i += 1) await order(t.storeB1, 'b-saree', 10, 'Delhi', { name: 'Store B buyer', email: 'b@example.com', phone: '+919811100009', street: 'B street' })
  await withSystemScope(db.sql, (tx) => rankBestSellers(tx, now))

  const offer = async (storeId: string, name: string, trigger: 'automatic' | 'code', code?: string) => {
    const [p] = await db.sql<{ id: string }[]>`insert into promotion (store_id, name, trigger, enabled) values (${storeId}, ${name}, ${trigger}, true) returning id`
    await db.sql`insert into promotion_action (promotion_id, store_id, operation, args, position) values (${p?.id ?? ''}, ${storeId}, 'free_shipping', '{}', 0)`
    if (code) await db.sql`insert into promotion_code (promotion_id, store_id, code) values (${p?.id ?? ''}, ${storeId}, ${code})`
  }
  await offer(t.storeA1, 'Free delivery this week', 'automatic')
  await offer(t.storeA1, 'Secret code offer', 'code', 'HUSH20')
  await offer(t.storeB1, 'Store B offer', 'automatic')
}, 60_000)

afterAll(async () => {
  await counted?.end()
  await db?.drop()
})

const summaryA = () => buildStoreSummary(db.sql, person(t.storeA1, t.partnerA), now)

describe('the store summary', () => {
  it('holds the store’s settings, brand, collections, best sellers, top collections, cities and offers', async () => {
    const s = await summaryA()
    expect(s).toMatchObject({ name: 'Store A1', city: 'Pune', currency: 'INR', products: 3, collectionCount: 1, collections: [{ name: 'Summer', slug: 'summer', products: 1, image: false }] })
    expect(s.brand).toMatchObject({ tagline: 'Linen for warm days', voice: 'warm', colours: ['#224466'] })
    expect(s.bestSellers).toEqual([
      { name: 'Linen shirt', slug: 'linen-shirt', price: 'INR 1499.00', unitsSold: 10 },
      { name: 'Cotton kurta', slug: 'cotton-kurta', price: 'INR 999.00', unitsSold: 9 },
    ])
    expect(s.topCollections).toEqual([{ name: 'Summer', slug: 'summer', unitsSold: 10 }])
    expect(s.offers).toEqual([{ name: 'Free delivery this week', endsAt: null, appliesTo: 'shipping' }])
    expect(s.newest.map((p) => p.slug)).toEqual(['silk-scarf', 'cotton-kurta', 'linen-shirt'])
  })

  it('names a city only with at least 5 shoppers’ orders behind it: 5 in Pune; 4 in Nashik and one repeat shopper in Thane left out', async () => {
    expect((await summaryA()).topCities).toEqual([{ city: 'Pune', orders: 5 }])
  })

  it('holds no personal data, no single order and no code', async () => {
    const text = JSON.stringify(await summaryA())
    for (const who of shoppers) for (const value of Object.values(who)) expect(text).not.toContain(value)
    for (const value of ['411001', 'ORD-77', 'HUSH20', 'Secret code offer', 'priya', '@example.com', '+91']) expect(text).not.toContain(value)
  })

  it('is one statement', async () => {
    sent = []
    await withScope(counted, person(t.storeA1, t.partnerA), (tx) => selectStoreSummary(tx, t.storeA1, now))
    expect(sent.filter((q) => !['begin', 'commit'].includes(q) && !q.includes('set_config'))).toHaveLength(1)
  })

  it('isolation: each store’s summary holds none of another’s rows, and no other caller kind reads one', async () => {
    const a = JSON.stringify(await summaryA())
    const b = JSON.stringify(await buildStoreSummary(db.sql, person(t.storeB1, t.partnerB), now))
    for (const other of ['Store B saree', 'b-saree', 'Store B festive', 'Delhi', 'Store B offer']) expect(a).not.toContain(other)
    for (const own of ['Linen shirt', 'Summer', 'Pune', 'Free delivery this week']) expect(b).not.toContain(own)
    // A merchant of A2 (same partner) asking with A1's id gets nothing: RLS holds the acting store.
    const crossed = await withScope(db.sql, person(t.storeA2, t.partnerA), (tx) => selectStoreSummary(tx, t.storeA1, now))
    expect(crossed === null || (crossed.products === 0 && crossed.best_sellers.length === 0 && crossed.cities.length === 0 && crossed.offers.length === 0)).toBe(true)
    // A supplier and a shopper are refused by the grants (orders, offers, the ranking's units).
    await expect(withScope(db.sql, person(t.storeA1, t.partnerA, { kind: 'seller', sellerId: t.sellerA1First }), (tx) => selectStoreSummary(tx, t.storeA1, now))).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, shopper(t.storeA1, t.partnerA), (tx) => selectStoreSummary(tx, t.storeA1, now))).rejects.toThrow(/permission denied/)
    // A partner user and staff reach no store's catalogue or sales.
    for (const context of [{ caller: { kind: 'partner-user', partnerUserId: 'pu' }, partnerId: t.partnerA } as CallerContext, { caller: { kind: 'staff', staffId: 'st' } } as CallerContext]) {
      const row = await withScope(db.sql, context, (tx) => selectStoreSummary(tx, t.storeA1, now)).catch(() => null)
      expect(row === null || (row.products === 0 && row.best_sellers.length === 0 && row.cities.length === 0 && row.offers.length === 0 && row.collections.length === 0)).toBe(true)
    }
  })
})

describe('the lookups', () => {
  const statements = async (work: () => Promise<unknown>) => {
    sent = []
    await work()
    return sent.filter((q) => !['begin', 'commit'].includes(q) && !q.includes('set_config')).length
  }
  const read: string[] = []
  const lookupsFor = (summary: StoreSummary, context = person(t.storeA1, t.partnerA)) =>
    storeLookups({ sql: counted, context, summary, readAsset: async (key) => (read.push(key), { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mime: 'image/png' }) })

  it('answer from the summary first: collections, best sellers and offers ask nothing', async () => {
    const lookups = lookupsFor(await summaryA())
    expect(await statements(() => lookups.run('list_collections', {}))).toBe(0)
    expect(await statements(() => lookups.run('best_sellers', { limit: 24 }))).toBe(0)
    expect(await statements(() => lookups.run('active_offers', {}))).toBe(0)
    expect(JSON.parse((await lookups.run('active_offers', {}))?.content ?? '[]')).toEqual([{ name: 'Free delivery this week', endsAt: null, appliesTo: 'shipping' }])
  })

  it('ask the database in one query each for what the summary doesn’t hold', async () => {
    const lookups = lookupsFor(await summaryA())
    expect(await statements(() => lookups.run('find_products', { collection: 'summer', sort: 'best-selling' }))).toBe(1)
    expect(await statements(() => lookups.run('product_photos', { product: 'linen-shirt' }))).toBe(1)
    const many = lookupsFor({ ...(await summaryA()), collectionCount: 99 })
    expect(await statements(() => many.run('list_collections', {}))).toBe(1)
  })

  it('find products by collection and sort, with photo asset ids, and never another store’s', async () => {
    const lookups = lookupsFor(await summaryA())
    const found = JSON.parse((await lookups.run('find_products', { sort: 'best-selling', limit: 24 }))?.content ?? '[]') as { slug: string; photoAssetIds: string[]; bestSellerRank: number | null; price: string }[]
    expect(found.map((p) => p.slug)).toEqual(['linen-shirt', 'cotton-kurta', 'silk-scarf'])
    expect(found[0]).toMatchObject({ photoAssetIds: [ids['photo']], bestSellerRank: 1, price: 'INR 1499.00' })
    expect(JSON.parse((await lookups.run('find_products', { collection: 'b-festive' }))?.content ?? '[]')).toEqual([])
    // Store A's lookups with store B's slug find nothing, and read no file.
    read.length = 0
    expect((await lookups.run('product_photos', { product: 'b-saree' }))?.images).toEqual([])
    expect(read).toEqual([])
  })

  it('show a product’s photos as images, and refuse a malformed slug', async () => {
    const lookups = lookupsFor(await summaryA())
    read.length = 0
    const photos = await lookups.run('product_photos', { product: 'linen-shirt' })
    expect(photos?.images).toEqual([{ mediaType: 'image/png', base64: 'iVBORw==' }])
    expect(photos?.content).toContain(ids['photo'])
    expect(read).toHaveLength(1)
    expect(await lookups.run('product_photos', { product: '../etc' })).toBeNull()
    expect(await lookups.run('find_products', { collection: 'a b' })).toBeNull()
  })

  it('hold no personal data', async () => {
    const lookups = lookupsFor(await summaryA())
    const all = await Promise.all([lookups.run('list_collections', {}), lookups.run('find_products', { limit: 24 }), lookups.run('best_sellers', {}), lookups.run('active_offers', {})])
    const text = JSON.stringify(all)
    for (const who of shoppers) for (const value of Object.values(who)) expect(text).not.toContain(value)
    expect(text).not.toContain('HUSH20')
  })
})

describe('the summary kept beside the studio', () => {
  const studioOf = () => {
    const kept = new Map<string, KeptSummary>()
    return { kept, studio: { summary: async (storeId: string) => kept.get(storeId) ?? null, keepSummary: async (storeId: string, value: KeptSummary) => void kept.set(storeId, value) } }
  }

  it('is reused for 10 minutes, then rebuilt at the next change', async () => {
    const { studio, kept } = studioOf()
    let built = 0
    const build = async () => ((built += 1), summaryA())
    await freshSummary(studio, t.storeA1, now, build)
    await freshSummary(studio, t.storeA1, new Date(now.getTime() + summaryMaxAgeMs - 1), build)
    expect(built).toBe(1)
    expect(kept.get(t.storeA1)?.builtAt).toBe(now.getTime())
    await freshSummary(studio, t.storeA1, new Date(now.getTime() + summaryMaxAgeMs), build)
    expect(built).toBe(2)
    expect(kept.get(t.storeA1)?.builtAt).toBe(now.getTime() + summaryMaxAgeMs)
  })

  it('rebuilds a kept value that doesn’t read as a summary', async () => {
    const { studio, kept } = studioOf()
    kept.set(t.storeA1, { builtAt: now.getTime(), text: '{"name":1}' })
    expect((await freshSummary(studio, t.storeA1, now, summaryA)).name).toBe('Store A1')
  })
})
