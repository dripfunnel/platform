import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { encodeValueCursor } from '#core/cursor'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #298 (SUI 4), what the Products list needs of the API: its sorts, ready to sell per market (CATALOG T2),
// and the bulk "Add to collection" and "Change tax category" (FIRST-RELEASE §11, CatList).

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-05T09:00:00Z')
type Who = 'owner' | 'staff' | 'supplier' | 'otherSupplier' | 'bOwner'
const people: Record<Who, string> = { owner: '', staff: '', supplier: '', otherSupplier: '', bOwner: '' }
const cookies: Record<Who, string> = { owner: '', staff: '', supplier: '', otherSupplier: '', bOwner: '' }

const user = async (partnerId: string, email: string, name: string) => {
  const [row] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`
  return row?.id ?? ''
}

const subscribe = async (storeId: string, partnerId: string, products: number) => {
  const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${`Plan ${products}`}, 'live') returning id`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${partnerId}, 1, 'products', ${products})`
  await db.sql`update store set plan_id = ${plan?.id ?? ''}, pricing_currency = 'INR' where id = ${storeId}`
  await db.sql`delete from store_subscription where store_id = ${storeId}`
  await db.sql`
    insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${storeId}, ${partnerId}, ${plan?.id ?? ''}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})
  `
  return plan?.id ?? ''
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update seller set access_level = 'vendor-catalogue' where id in (${t.sellerA1First}, ${t.sellerA1Second})`
  people.owner = await user(t.partnerA, 'owner@a.example', 'Olivia Owner')
  people.staff = await user(t.partnerA, 'staff@a.example', 'Sam Staff')
  people.supplier = await user(t.partnerA, 'anand@a.example', 'Anand')
  people.otherSupplier = await user(t.partnerA, 'bhatia@a.example', 'Bhatia')
  people.bOwner = await user(t.partnerB, 'owner@b.example', 'Bea Owner')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.staff}, ${t.storeA1}, 'staff', 'active'), (${people.bOwner}, ${t.storeB1}, 'owner', 'active')`
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${people.supplier}, ${t.storeA1}, ${t.sellerA1First}, 'supplier-admin', 'active'), (${people.otherSupplier}, ${t.storeA1}, ${t.sellerA1Second}, 'supplier-admin', 'active')`
  await subscribe(t.storeA1, t.partnerA, 50)
  await subscribe(t.storeB1, t.partnerB, 50)
  for (const who of Object.keys(cookies) as Who[]) {
    cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: who === 'bOwner' ? t.partnerB : t.partnerA }, now))
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const sellerOf: Partial<Record<Who, () => string>> = { supplier: () => t.sellerA1First, otherSupplier: () => t.sellerA1Second }

const gql = async (source: string, who: Who, variables: Record<string, unknown> = {}, storeId = who === 'bOwner' ? t.storeB1 : t.storeA1) => {
  const partnerId = who === 'bOwner' ? t.partnerB : t.partnerA
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const seller = sellerOf[who]?.()
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeId, ...(seller ? { [supplierHeader]: seller } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: activityLog, facts, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, errors: result.errors }
}


const save = `mutation Save($id: ID, $revision: Int, $input: ProductInput!) { saveProduct(id: $id, revision: $revision, input: $input) { id slug revision } }`
const price = (amount: string, compareAtAmount?: string) => ({ currency: 'INR', amount, ...(compareAtAmount ? { compareAtAmount } : {}) })

const create = async (who: Who, input: Record<string, unknown>, storeId?: string) => {
  const result = await gql(save, who, { input }, storeId)
  return { saved: result.data?.['saveProduct'] as { id: string; slug: string; revision: number } | undefined, code: result.code }
}


type Row = { id: string; name: string; stock: number; minPrice: { amount: string } | null; readiness: { marketName: string; ready: boolean; missing: string[] }[] | null }
type PageInfo = { hasNextPage: boolean; hasPreviousPage: boolean; startCursor: string; endCursor: string }
const page = async (who: Who, args: string) => {
  const result = await gql(`{ products(${args}) { nodes { id name stock minPrice { amount } readiness { marketName ready missing } } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } } }`, who)
  return { rows: (result.data?.['products'] as { nodes: Row[] } | undefined)?.nodes ?? [], pageInfo: (result.data?.['products'] as { pageInfo: PageInfo } | undefined)?.pageInfo, code: result.code }
}

describe('the Products list’s sorts', () => {
  beforeAll(async () => {
    for (const [name, amount] of [['Banana mug', '30000'], ['apple bowl', '10000'], ['Cherry vase', '20000'], ['Date plate', '40000']] as const) {
      await create('owner', { name, options: [], versions: [{ choices: [], prices: [price(amount)] }] })
    }
  })

  it('sorts by name whatever the case, by price either way, and pages each sort with its own cursor', async () => {
    const byName = await page('owner', 'search: "a", sort: "name", first: 2')
    expect(byName.rows.map((r) => r.name)).toEqual(['apple bowl', 'Banana mug'])
    const next = await page('owner', `search: "a", sort: "name", first: 2, after: "${byName.pageInfo?.endCursor}"`)
    expect(next.rows.map((r) => r.name)).toEqual(['Cherry vase', 'Date plate'])
    expect((await page('owner', 'search: "a", sort: "price_low"')).rows.map((r) => r.minPrice?.amount)).toEqual(['10000', '20000', '30000', '40000'])
    expect((await page('owner', 'search: "a", sort: "price_high"')).rows.map((r) => r.minPrice?.amount)).toEqual(['40000', '30000', '20000', '10000'])
    // A cursor made for one sort is no use to another.
    expect((await page('owner', `sort: "price_low", after: "${byName.pageInfo?.endCursor}"`)).code).toBe('INVALID_CURSOR')
    expect((await page('owner', 'sort: "loudest"')).code).toBe('INVALID_INPUT')
  })

  it('reads back a page with before on a value cursor, the same rows in the same order', async () => {
    const first = await page('owner', 'search: "a", sort: "name", first: 2')
    const second = await page('owner', `search: "a", sort: "name", first: 2, after: "${first.pageInfo?.endCursor}"`)
    expect(second.pageInfo?.hasPreviousPage).toBe(true)
    const back = await page('owner', `search: "a", sort: "name", first: 2, before: "${second.pageInfo?.startCursor}"`)
    expect(back.rows.map((r) => r.name)).toEqual(['apple bowl', 'Banana mug'])
    const backByPrice = await page('owner', `search: "a", sort: "price_high", first: 2, before: "${(await page('owner', 'search: "a", sort: "price_high", first: 3')).pageInfo?.endCursor}"`)
    expect(backByPrice.rows.map((r) => r.minPrice?.amount)).toEqual(['40000', '30000'])
  })

  it('puts unpriced products last either way, and orders by stock lowest first', async () => {
    const made: Record<string, string> = {}
    for (const [name, amount] of [['Zinc cheap', '10000'], ['Zinc dear', '90000'], ['Zinc unpriced', '50000']] as const) {
      made[name] = (await create('owner', { name, options: [], versions: [{ choices: [], prices: [price(amount)] }] })).saved?.id ?? ''
    }
    expect(Object.values(made)).not.toContain('')
    // A save always prices the store's currency; a product loses that price when the store's currency moves.
    await db.sql`delete from version_price where version_id in (select id from product_version where product_id = ${made['Zinc unpriced'] ?? ''})`
    expect((await page('owner', 'search: "Zinc", sort: "price_low"')).rows.map((r) => r.name)).toEqual(['Zinc cheap', 'Zinc dear', 'Zinc unpriced'])
    expect((await page('owner', 'search: "Zinc", sort: "price_high"')).rows.map((r) => r.name)).toEqual(['Zinc dear', 'Zinc cheap', 'Zinc unpriced'])
    const [shelf] = await db.sql<{ id: string }[]>`insert into warehouse (store_id, name) values (${t.storeA1}, 'Zinc shelf') returning id`
    for (const [name, onHand] of [['Zinc cheap', 7], ['Zinc dear', 2], ['Zinc unpriced', 12]] as const) {
      await db.sql`insert into stock_level (version_id, warehouse_id, store_id, on_hand) select v.id, ${shelf?.id ?? ''}, ${t.storeA1}, ${onHand} from product_version v where v.product_id = ${made[name] ?? ''}`
    }
    expect((await page('owner', 'search: "Zinc", sort: "stock"')).rows.map((r) => [r.name, r.stock])).toEqual([['Zinc dear', 2], ['Zinc cheap', 7], ['Zinc unpriced', 12]])
  })

  it('refuses a well-formed cursor whose value its sort can’t hold, as any bad cursor', async () => {
    const id = '00000000-0000-4000-8000-000000000000'
    for (const [sort, value] of [['stock', 'abc'], ['stock', '99999999999'], ['price_low', '9223372036854775808'], ['price_high', '1.5'], ['price_low', '']] as const) {
      expect({ sort, value, code: (await page('owner', `sort: "${sort}", after: "${encodeValueCursor({ sort, value, id })}"`)).code }).toEqual({ sort, value, code: 'INVALID_CURSOR' })
    }
    expect((await page('owner', `sort: "stock", after: "${encodeValueCursor({ sort: 'stock', value: '3', id })}"`)).code).toBeUndefined()
  })

  it('pages through ties one by one, by id, with nothing skipped or repeated, and a name lowercased as the database does', async () => {
    for (const name of ['Tie one', 'Tie two', 'Tie three', 'İstanbul tie']) await create('owner', { name, options: [], versions: [{ choices: [], prices: [price('55500')] }] })
    for (const sort of ['price_low', 'stock', 'name']) {
      const seen: string[] = []
      let after: string | undefined
      for (let i = 0; i < 6; i++) {
        const got = await page('owner', `search: "tie", sort: "${sort}", first: 1${after ? `, after: "${after}"` : ''}`)
        seen.push(...got.rows.map((r) => r.name))
        if (!got.pageInfo?.hasNextPage) break
        after = got.pageInfo.endCursor
      }
      expect({ sort, seen: [...seen].sort() }).toEqual({ sort, seen: ['Tie one', 'Tie three', 'Tie two', 'İstanbul tie'].sort() })
    }
  })
})

describe('ready to sell per market', () => {
  it('names what each market still needs, and nothing to a supplier, which reads no market', async () => {
    await db.sql`update store set country = 'US' where id = ${t.storeA1}`
    const us = await gql('mutation S($input: MarketInput!) { saveMarket(input: $input) { id } }', 'owner', { input: { name: 'United States', countries: ['US'], currency: 'INR', language: 'en-US' } })
    expect(us.code).toBeUndefined()
    const shirt = (await create('owner', { name: 'Ready shirt', options: [], versions: [{ choices: [], prices: [price('99900')] }] })).saved?.id ?? ''
    const row = async () => (await page('owner', 'search: "Ready shirt"')).rows[0]?.readiness?.find((r) => r.marketName === 'United States')
    expect(await row()).toEqual({ marketName: 'United States', ready: false, missing: ['fibre', 'origin', 'care'] })
    await db.sql`insert into product_compliance (product_id, store_id, region, field, value) values (${shirt}, ${t.storeA1}, 'US', 'fibre', '100% cotton'), (${shirt}, ${t.storeA1}, 'ALL', 'origin', 'India'), (${shirt}, ${t.storeA1}, 'US', 'care', 'Machine wash')`
    expect(await row()).toEqual({ marketName: 'United States', ready: true, missing: [] })
    expect(((await gql('query P($id: ID!) { product(id: $id) { readiness { marketName ready } } }', 'owner', { id: shirt })).data?.['product'] as { readiness: { marketName: string; ready: boolean }[] }).readiness).toContainEqual({ marketName: 'United States', ready: true })
    const own = await create('supplier', { name: 'Supplier lamp', options: [], versions: [{ choices: [], prices: [price('5000')] }] })
    const theirs = await gql('{ products(search: "Supplier lamp") { nodes { name readiness { marketName } } } }', 'supplier')
    expect({ nodes: (theirs.data?.['products'] as { nodes: unknown[] }).nodes, errors: theirs.errors }).toEqual({ nodes: [{ name: 'Supplier lamp', readiness: null }], errors: undefined })
    expect(own.saved).toBeDefined()
  })

  it('asks nothing of a product for a market that doesn’t sell it', async () => {
    const shirt = (await create('owner', { name: 'Excluded shirt', options: [], versions: [{ choices: [], prices: [price('99900')] }] })).saved?.id ?? ''
    const markets = async () => (await page('owner', 'search: "Excluded shirt"')).rows[0]?.readiness?.map((r) => r.marketName)
    expect(await markets()).toContain('United States')
    const [us] = await db.sql<{ id: string }[]>`update market set products = 'some' where store_id = ${t.storeA1} and name = 'United States' returning id`
    await db.sql`insert into market_excluded_product (market_id, product_id, store_id) values (${us?.id ?? ''}, ${shirt}, ${t.storeA1})`
    expect(await markets()).not.toContain('United States')
    // Exclusions count only while the market sells some products.
    await db.sql`update market set products = 'all' where id = ${us?.id ?? ''}`
    expect(await markets()).toContain('United States')
  })
})

describe('bulk actions', () => {
  it('adds products to a hand-picked collection after what it holds, never to an automatic one or from another store', async () => {
    const ids = (await page('owner', 'search: "a", sort: "name"')).rows.map((r) => r.id)
    const [picked] = await db.sql<{ id: string }[]>`insert into collection (store_id, name, slug, kind) values (${t.storeA1}, 'Picked', 'picked', 'manual') returning id`
    const [ruled] = await db.sql<{ id: string }[]>`insert into collection (store_id, name, slug, kind) values (${t.storeA1}, 'Ruled', 'ruled', 'automatic') returning id`
    const add = (collectionId: string | undefined, productIds: string[], who: Who = 'owner') => gql('mutation A($c: ID!, $p: [ID!]!) { addProductsToCollection(collectionId: $c, productIds: $p) }', who, { c: collectionId, p: productIds })
    expect((await add(picked?.id, ids.slice(0, 2))).data?.['addProductsToCollection']).toBe(2)
    expect((await add(picked?.id, ids.slice(1, 4))).data?.['addProductsToCollection']).toBe(4)
    expect(await db.sql`select product_id from collection_product where collection_id = ${picked?.id ?? ''} order by position`).toEqual(ids.slice(0, 4).map((product_id) => ({ product_id })))
    expect((await add(ruled?.id, ids.slice(0, 1))).code).toBe('INVALID_INPUT')
    expect((await add(picked?.id, ids.slice(0, 1), 'staff')).code).toBe('FORBIDDEN')
    expect((await add(picked?.id, ids.slice(0, 1), 'supplier')).code).toBe('FORBIDDEN')
    expect((await add(picked?.id, ids.slice(0, 1), 'bOwner')).code).toBe('NOT_FOUND')
    const [theirs] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug) values (${t.storeB1}, 'B thing', 'b-thing') returning id`
    expect((await add(picked?.id, [theirs?.id ?? ''])).code).toBe('NOT_FOUND')
  })

  it('holds a hand-picked collection to 1,000 products, changing nothing when an add would pass it', async () => {
    const made = await db.sql<{ id: string }[]>`
      insert into product (store_id, name, slug) select ${t.storeA1}, 'Bulk ' || n, 'bulk-' || n from generate_series(1, 1001) n returning id`
    const [full] = await db.sql<{ id: string }[]>`insert into collection (store_id, name, slug, kind) values (${t.storeA1}, 'Nearly full', 'nearly-full', 'manual') returning id`
    await db.sql`insert into collection_product (collection_id, product_id, store_id, position, source)
      select ${full?.id ?? ''}, id, ${t.storeA1}, row_number() over () - 1, 'manual' from product where store_id = ${t.storeA1} and slug like 'bulk-%' and slug <> 'bulk-1000' and slug <> 'bulk-1001'`
    const add = (productIds: string[]) => gql('mutation A($c: ID!, $p: [ID!]!) { addProductsToCollection(collectionId: $c, productIds: $p) }', 'owner', { c: full?.id, p: productIds })
    const held = async () => (await db.sql<{ n: number }[]>`select count(*)::int as n from collection_product where collection_id = ${full?.id ?? ''}`)[0]?.n
    expect(await held()).toBe(999)
    const last = made.map((m) => m.id).slice(-2)
    expect((await add(last)).code).toBe('TOO_MANY_PRODUCTS')
    expect(await held()).toBe(999)
    expect((await add(made.map((m) => m.id))).code).toBe('INVALID_INPUT')
    expect((await add(last.slice(0, 1))).data?.['addProductsToCollection']).toBe(1000)
  })

  it('changes every version’s tax category at once, the merchant side’s only', async () => {
    const ids = (await page('owner', 'search: "a", sort: "name"')).rows.map((r) => r.id).slice(0, 2)
    const [exempt] = await db.sql<{ id: string }[]>`select id from tax_class where store_id = ${t.storeA1} and name = 'Exempt'`
    const set = (taxClassId: string | null | undefined, who: Who = 'owner') => gql('mutation T($ids: [ID!]!, $c: ID) { setProductsTaxClass(ids: $ids, taxClassId: $c) }', who, { ids, c: taxClassId })
    expect((await set(exempt?.id)).data?.['setProductsTaxClass']).toBe(2)
    expect(await db.sql`select distinct tax_class_id from product_version where product_id = any(${`{${ids.join(',')}}`}::uuid[]) and deleted_at is null`).toEqual([{ tax_class_id: exempt?.id }])
    expect((await set(null)).data?.['setProductsTaxClass']).toBe(2)
    expect((await set(exempt?.id, 'supplier')).code).toBe('FORBIDDEN')
    const [theirs] = await db.sql<{ id: string }[]>`select id from tax_class where store_id = ${t.storeB1} limit 1`
    expect((await set(theirs?.id)).code).toBe('NOT_FOUND')
    expect(await db.sql`select 1 from activity_log where action = 'product.tax_class_changed' and store_id = ${t.storeA1}`).toHaveLength(4)
    // Another store's products: none changed, none logged, and a count of nothing.
    const [b] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug) values (${t.storeB1}, 'B pot', 'b-pot') returning id`
    await db.sql`insert into product_version (product_id, store_id, position) values (${b?.id ?? ''}, ${t.storeB1}, 0)`
    expect((await gql('mutation T($ids: [ID!]!, $c: ID) { setProductsTaxClass(ids: $ids, taxClassId: $c) }', 'owner', { ids: [b?.id], c: exempt?.id })).data?.['setProductsTaxClass']).toBe(0)
    expect(await db.sql`select tax_class_id from product_version where product_id = ${b?.id ?? ''}`).toEqual([{ tax_class_id: null }])
    expect(await db.sql`select 1 from activity_log where action = 'product.tax_class_changed' and target_id = ${b?.id ?? ''}`).toHaveLength(0)
    // Nor does another store read this store's readiness.
    const ours = (await page('owner', 'search: "a", sort: "name"')).rows[0]?.id
    expect((await gql('query P($id: ID!) { product(id: $id) { readiness { marketName } } }', 'bOwner', { id: ours })).data?.['product']).toBeNull()
  })
})
