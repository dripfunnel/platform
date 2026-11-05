import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopCatalogueRecorder } from '#apis/shop/record'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveShopper } from '#auth/shopCaller'
import type { CallerContext, SellerScope } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { rankBestSellers } from '#db/scoped/productRank'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// #1242 part 1: the hourly best-seller ranking (migration 0383) behind the Shop API's BEST_SELLING sort, and the
// storefront's offers behind core's useOffers(): only the store's own, automatic and on now, never a code.

let db: TestDatabase
let t: Tenants
const host = 'store-a1.shop.example'
const otherHost = 'store-b1.shop.example'
const now = new Date('2026-11-04T09:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000)
const products: Record<string, string> = {}
const versions: Record<string, string> = {}

const product = async (storeId: string, slug: string, created: string, over: Record<string, unknown> = {}) => {
  const [p] = await db.sql<{ id: string }[]>`insert into product ${db.sql({ store_id: storeId, name: slug, slug, visibility: 'visible', created_at: new Date(created), ...over })} returning id`
  const [v] = await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, track_stock) values (${storeId}, ${p?.id ?? ''}, ${`S-${slug}-${storeId.slice(0, 4)}`}, 0, false) returning id`
  await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${v?.id ?? ''}, ${storeId}, 'INR', 1000)`
  return { product: p?.id ?? '', version: v?.id ?? '' }
}

let orders = 0
/** A placed order of `units` of each named product; `paid: false` with a card is one that never went through. */
const sold = async (storeId: string, placedAt: Date, lines: [string, number][], o: { state?: 'placed' | 'cancelled'; paid?: boolean; method?: string } = {}) => {
  orders += 1
  const [row] = await db.sql<{ id: string }[]>`
    insert into "order" (store_id, state, payment_state, currency, email, shipping_address, number, placed_at, subtotal_amount, shipping_amount, tax_amount, total_amount, refunded_amount, payment_method, cancelled_at, cancel_reason)
    values (${storeId}, ${o.state ?? 'placed'}, ${o.paid === false ? 'pending' : 'paid'}, 'INR', 'buyer@example.com', ${db.sql.json({ name: 'Buyer', city: 'Pune', country: 'IN' })},
      ${`N${orders}`}, ${placedAt}, 1000, 0, 0, 1000, 0, ${o.method ?? 'stripe'}, ${o.state === 'cancelled' ? placedAt : null}, ${o.state === 'cancelled' ? 'store' : null})
    returning id`
  for (const [position, [slug, quantity]] of lines.entries()) {
    await db.sql`insert into order_line (order_id, store_id, version_id, product_id, name, quantity, unit_amount, line_total_amount, position)
      values (${row?.id ?? ''}, ${storeId}, ${versions[slug] ?? ''}, ${products[slug] ?? ''}, ${slug}, ${quantity}, 1000, ${1000 * quantity}, ${position})`
  }
}

let made = 0
const offer = async (storeId: string, name: string, o: { trigger?: 'automatic' | 'code'; enabled?: boolean; startsAt?: Date; endsAt?: Date; action?: Record<string, unknown>; conditions?: Record<string, unknown>[]; code?: string } = {}) => {
  made += 1
  const [p] = await db.sql<{ id: string }[]>`
    insert into promotion (store_id, name, trigger, enabled, starts_at, ends_at, created_at)
    values (${storeId}, ${name}, ${o.trigger ?? 'automatic'}, ${o.enabled ?? true}, ${o.startsAt ?? null}, ${o.endsAt ?? null}, ${new Date(Date.UTC(2026, 9, 1) + made * 1000)}) returning id`
  const id = p?.id ?? ''
  const { operation, ...args } = o.action ?? { operation: 'order_percentage_discount', percent: 10, cap: null }
  await db.sql`insert into promotion_action (promotion_id, store_id, operation, args, position) values (${id}, ${storeId}, ${String(operation)}, ${db.sql.json(args as Record<string, string>)}, 0)`
  for (const [position, c] of (o.conditions ?? []).entries()) {
    const { operation: op, ...cargs } = c
    await db.sql`insert into promotion_condition (promotion_id, store_id, operation, args, position) values (${id}, ${storeId}, ${String(op)}, ${db.sql.json(cargs as Record<string, string>)}, ${position})`
  }
  if (o.code) await db.sql`insert into promotion_code (promotion_id, store_id, code) values (${id}, ${storeId}, ${o.code})`
  return id
}

let summer = ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set pricing_currency = 'INR', country = 'IN', status = 'active' where id in (${t.storeA1}, ${t.storeB1})`
  await db.sql`update partner set state = 'live' where id in (${t.partnerA}, ${t.partnerB})`
  await db.sql`update market set countries = '["IN"]' where store_id in (${t.storeA1}, ${t.storeB1})`
  for (const [slug, created] of [['kurta', '2026-10-01'], ['shirt', '2026-10-02'], ['dress', '2026-10-03'], ['scarf', '2026-10-04']] as const) {
    const made = await product(t.storeA1, slug, created)
    products[slug] = made.product
    versions[slug] = made.version
  }
  const hidden = await product(t.storeA1, 'hidden', '2026-10-05', { visibility: 'hidden' })
  products['hidden'] = hidden.product
  versions['hidden'] = hidden.version
  const other = await product(t.storeB1, 'saree', '2026-10-01')
  products['saree'] = other.product
  versions['saree'] = other.version
  summer = (await db.sql<{ id: string }[]>`insert into collection (store_id, name, slug, kind, sort) values (${t.storeA1}, 'Summer', 'summer', 'manual', 'best_selling') returning id`)[0]?.id ?? ''
  await db.sql`insert into collection_product (collection_id, product_id, store_id, position, source) values (${summer}, ${products['kurta'] ?? ''}, ${t.storeA1}, 0, 'manual'), (${summer}, ${products['dress'] ?? ''}, ${t.storeA1}, 1, 'manual')`

  // Units in the last 90 days: dress 5, shirt 3 (+ COD), kurta 2; older, cancelled and unpaid orders don't count.
  await sold(t.storeA1, daysAgo(1), [['dress', 4], ['kurta', 2]])
  await sold(t.storeA1, daysAgo(80), [['dress', 1], ['shirt', 1]])
  await sold(t.storeA1, daysAgo(2), [['shirt', 2]], { paid: false, method: 'cod' })
  await sold(t.storeA1, daysAgo(120), [['kurta', 50]])
  await sold(t.storeA1, daysAgo(3), [['kurta', 40]], { state: 'cancelled' })
  await sold(t.storeA1, daysAgo(3), [['scarf', 40]], { paid: false })
  await sold(t.storeA1, daysAgo(3), [['hidden', 9]])
  // Store B's best seller sells more than anything of A's.
  await sold(t.storeB1, daysAgo(1), [['saree', 100]])
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const gql = async (source: string, on = host, at = now) => {
  const found = await resolveShopper(db.sql, new Request(`https://${on}/shop-api`), on, 'shop.example')
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${on}`, activity: activityLog, facts: { requestId: 'r', ip: null, userAgent: null }, allowNewCart: async () => true, now: () => at }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
type Page = { nodes: { slug: string }[]; pageInfo: { endCursor: string | null; hasNextPage: boolean } }
const listed = async (args: string, on = host) => (await gql(`{ products${args} { nodes { slug } pageInfo { endCursor hasNextPage } } }`, on)).data?.['products'] as Page | undefined
const slugs = (page: Page | undefined) => page?.nodes.map((n) => n.slug)

const person = (storeId: string, partnerId: string, sellerScope: SellerScope = { kind: 'all' }): CallerContext => ({ caller: { kind: 'person', userId: '00000000-0000-4000-8000-0000000000aa', sessionId: 's' }, partnerId, storeId, sellerScope, subscription: 'active' })
const shopperOf = (storeId: string, partnerId: string): CallerContext => ({ caller: { kind: 'shopper', customerId: null }, partnerId, storeId, sellerScope: { kind: 'all' }, subscription: 'active' })

describe('the ranking', () => {
  it('orders each store’s products by units on orders that went through in the last 90 days', async () => {
    expect(await withSystemScope(db.sql, (tx) => rankBestSellers(tx, now))).toBe(5)
    const rows = await db.sql<{ store_id: string; product_id: string; units: string; position: number }[]>`select store_id, product_id, units::text, position from product_rank order by store_id = ${t.storeA1} desc, position`
    expect(rows.map((r) => [r.store_id === t.storeA1 ? 'A' : 'B', Object.keys(products).find((k) => products[k] === r.product_id), r.units, r.position])).toEqual([
      ['A', 'hidden', '9', 1],
      ['A', 'dress', '5', 2],
      ['A', 'shirt', '3', 3],
      ['A', 'kurta', '2', 4],
      ['B', 'saree', '100', 1],
    ])
  })

  it('drops a product whose sales fall out of the window at the next run', async () => {
    const units = async () => Object.fromEntries((await db.sql<{ product_id: string; units: string }[]>`select product_id, units::text from product_rank where store_id = ${t.storeA1}`).map((r) => [Object.keys(products).find((k) => products[k] === r.product_id), r.units]))
    // 85 days on, the order 80 days ago is past the window: the dress and the shirt each lose a unit.
    await withSystemScope(db.sql, (tx) => rankBestSellers(tx, new Date(now.getTime() + 85 * 24 * 60 * 60 * 1000)))
    expect(await units()).toEqual({ hidden: '9', dress: '4', shirt: '2', kurta: '2' })
    await withSystemScope(db.sql, (tx) => rankBestSellers(tx, new Date(now.getTime() + 100 * 24 * 60 * 60 * 1000)))
    expect(await units()).toEqual({})
    await withSystemScope(db.sql, (tx) => rankBestSellers(tx, now))
  })

  it('isolation: each caller kind reads only its own store’s ranking, and a shopper never the units', async () => {
    const count = (context: CallerContext) => withScope(db.sql, context, async (tx) => (await tx<{ store_id: string }[]>`select store_id from product_rank`).map((r) => r.store_id))
    expect(new Set(await count(person(t.storeA1, t.partnerA)))).toEqual(new Set([t.storeA1]))
    expect(new Set(await count(person(t.storeB1, t.partnerB)))).toEqual(new Set([t.storeB1]))
    expect(await count(person(t.storeA2, t.partnerA))).toEqual([])
    expect(new Set(await count(shopperOf(t.storeA1, t.partnerA)))).toEqual(new Set([t.storeA1]))
    await expect(withScope(db.sql, shopperOf(t.storeA1, t.partnerA), (tx) => tx`select units from product_rank`)).rejects.toThrow(/permission denied/)
    // A supplier, a partner user and staff read nothing of it: no grant, or a policy that holds none.
    await expect(withScope(db.sql, person(t.storeA1, t.partnerA, { kind: 'seller', sellerId: t.sellerA1First }), (tx) => tx`select product_id from product_rank`)).rejects.toThrow(/permission denied/)
    expect(await withScope(db.sql, { caller: { kind: 'partner-user', partnerUserId: 'pu' }, partnerId: t.partnerA }, (tx) => tx`select product_id from product_rank`).catch(() => [])).toEqual([])
    expect(await withScope(db.sql, { caller: { kind: 'staff', staffId: 'st' } }, (tx) => tx`select product_id from product_rank`).catch(() => [])).toEqual([])
    await expect(withScope(db.sql, person(t.storeA1, t.partnerA), (tx) => tx`update product_rank set position = 1`)).rejects.toThrow(/permission denied/)
  })
})

describe('BEST_SELLING', () => {
  it('lists the store’s visible products by the ranking, unsold ones last, a page at a time', async () => {
    expect(slugs(await listed('(sort: BEST_SELLING)'))).toEqual(['dress', 'shirt', 'kurta', 'scarf'])
    const first = await listed('(sort: BEST_SELLING, first: 2)')
    expect([slugs(first), first?.pageInfo.hasNextPage]).toEqual([['dress', 'shirt'], true])
    // The cursor holds a position, never a number of units.
    expect(Buffer.from(first?.pageInfo.endCursor ?? '', 'base64url').toString()).toMatch(/\|3$/)
    expect(slugs(await listed(`(sort: BEST_SELLING, first: 2, after: "${first?.pageInfo.endCursor ?? ''}")`))).toEqual(['kurta', 'scarf'])
  })

  it('never reaches another store’s ranking, whatever it sold', async () => {
    expect(slugs(await listed('(sort: BEST_SELLING)', otherHost))).toEqual(['saree'])
    expect(slugs(await listed('(sort: BEST_SELLING)'))).not.toContain('saree')
  })

  it('is a collection’s own order when it is set to best selling', async () => {
    expect(slugs(await listed('(collection: "summer")'))).toEqual(['dress', 'kurta'])
  })
})

describe('offers', () => {
  type Offer = { id: string; name: string; description: string | null; endsAt: string | null; appliesTo: string; products: string[]; collections: string[] }
  const offersOf = async (on = host, at = now) => (await gql('{ offers { id name description endsAt appliesTo products collections } }', on, at)).data?.['offers'] as Offer[] | undefined

  beforeAll(async () => {
    await offer(t.storeA1, 'Ten off everything', { endsAt: new Date('2026-11-04T12:00:00Z') })
    await offer(t.storeA1, 'Summer linen', { action: { operation: 'products_percentage_discount', percent: 20, cap: null, targets: { productIds: [products['dress'], products['hidden']], collectionIds: [summer], filterValueIds: [] }, exclude: { giftCards: false, onSale: false } } })
    await offer(t.storeA1, 'Free delivery', { action: { operation: 'free_shipping' } })
    await offer(t.storeA1, 'Code only', { trigger: 'code', code: 'SECRET10' })
    await offer(t.storeA1, 'An automatic offer whose old code stays', { code: 'OLDCODE', endsAt: new Date('2026-11-05T00:00:00Z') })
    await offer(t.storeA1, 'Switched off', { enabled: false })
    await offer(t.storeA1, 'Already over', { endsAt: daysAgo(1) })
    await offer(t.storeA1, 'Not yet', { startsAt: new Date('2026-12-01T00:00:00Z') })
    await offer(t.storeA1, 'VIP only', { conditions: [{ operation: 'customer_group', groupIds: ['00000000-0000-4000-8000-000000000001'] }] })
    await offer(t.storeA1, 'Named shoppers in an any-of', { conditions: [{ operation: 'any_of', conditions: [{ operation: 'first_order' }, { operation: 'specific_customers', customerIds: [t.customerA1] }] }] })
    await offer(t.storeA1, 'First order', { conditions: [{ operation: 'first_order' }] })
    await offer(t.storeB1, 'Store B sale')
  })

  it('lists the store’s automatic offers on now, soonest ending first, with what they apply to', async () => {
    const offers = await offersOf()
    expect(offers?.map((o) => o.name)).toEqual(['Ten off everything', 'An automatic offer whose old code stays', 'Summer linen', 'Free delivery', 'First order'])
    expect(offers?.find((o) => o.name === 'Summer linen')).toMatchObject({ appliesTo: 'PRODUCTS', products: ['dress'], collections: ['summer'], endsAt: null })
    expect(offers?.find((o) => o.name === 'Free delivery')).toMatchObject({ appliesTo: 'SHIPPING', products: [], collections: [] })
    expect(offers?.[0]).toMatchObject({ appliesTo: 'ORDER', endsAt: '2026-11-04T12:00:00.000Z' })
  })

  it('never names a discount code, in any field', async () => {
    const text = JSON.stringify(await offersOf())
    expect(text).not.toContain('SECRET10')
    expect(text).not.toContain('OLDCODE')
    expect(text).not.toContain('Code only')
  })

  it('drops an offer once it ends', async () => {
    expect((await offersOf(host, new Date('2026-11-04T12:00:00Z')))?.map((o) => o.name)).not.toContain('Ten off everything')
  })

  it('isolation: a store sees only its own offers', async () => {
    expect((await offersOf(otherHost))?.map((o) => o.name)).toEqual(['Store B sale'])
    expect((await offersOf())?.map((o) => o.name)).not.toContain('Store B sale')
  })

  it('is recorded into a live build’s snapshot with the best sellers', async () => {
    const recorder = shopCatalogueRecorder(db.sql, 'shop.example', () => now)
    const base = await recorder.base(host)
    expect(base?.failed).toBe(0)
    const offers = base?.answers.find((a) => a.operation === 'Offers')?.data['offers'] as Offer[] | undefined
    expect(offers?.map((o) => o.name)).toContain('Summer linen')
    const best = base?.answers.find((a) => a.operation === 'Listing' && a.variables['sort'] === 'BEST_SELLING')?.data['products'] as Page | undefined
    expect(slugs(best)).toEqual(['dress', 'shirt', 'kurta', 'scarf'])
  })
})
