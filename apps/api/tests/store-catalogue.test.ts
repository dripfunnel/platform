import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { handleAssets } from '#apis/store/assets'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #293 (SAPI 3, part 1): products through the Store API, the merchant side over the store's
// catalogue and a supplier over its own products only (ACCESS §7.1, §11; CATALOG-DESIGN §3).

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-05T09:00:00Z')
type Who = 'owner' | 'staff' | 'supplier' | 'otherSupplier' | 'bOwner'
const people: Record<Who, string> = { owner: '', staff: '', supplier: '', otherSupplier: '', bOwner: '' }
const cookies: Record<Who, string> = { owner: '', staff: '', supplier: '', otherSupplier: '', bOwner: '' }
let smallStorePlan = ''

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
  smallStorePlan = await subscribe(t.storeA2, t.partnerA, 2)
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

// The ASSETS bucket, in memory: what a put stored is what a get returns.
const bucket = new Map<string, Uint8Array>()
const r2 = {
  put: async (key: string, value: Uint8Array) => void bucket.set(key, value),
  get: async (key: string) => {
    const value = bucket.get(key)
    return value ? { body: new Response(value.slice()).body as ReadableStream } : null
  },
}

const contextFor = async (who: Who, storeId: string) => {
  const partnerId = who === 'bOwner' ? t.partnerB : t.partnerA
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const seller = sellerOf[who]?.()
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeId, ...(seller ? { [supplierHeader]: seller } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, now, activityLog, facts)
  return { standing, partnerId, sql: db.sql, activity: activityLog, facts, now: () => now } satisfies StoreContext
}

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0x80, 0, 0, 1, 0xe0, 8, 6, 0, 0, 0])

const upload = async (who: Who, body: Uint8Array<ArrayBuffer> = png, storeId = who === 'bOwner' ? t.storeB1 : t.storeA1) => {
  const response = await handleAssets(new Request('https://store.example/api/assets', { method: 'POST', body }), await contextFor(who, storeId), r2)
  const answer = (await response.json()) as { ok: boolean; code?: string; asset?: { id: string; width: number; height: number } }
  return { status: response.status, ...answer }
}

const fetchAsset = async (who: Who, id: string) => (await handleAssets(new Request(`https://store.example/api/assets/${id}`), await contextFor(who, who === 'bOwner' ? t.storeB1 : t.storeA1), r2)).status

const save = `mutation Save($id: ID, $revision: Int, $input: ProductInput!) { saveProduct(id: $id, revision: $revision, input: $input) { id slug revision } }`
const price = (amount: string, compareAtAmount?: string) => ({ currency: 'INR', amount, ...(compareAtAmount ? { compareAtAmount } : {}) })
const simple = (name: string, extra: Record<string, unknown> = {}) => ({ name, options: [], versions: [{ choices: [], prices: [price('129900')] }], ...extra })

const create = async (who: Who, input: Record<string, unknown>, storeId?: string) => {
  const result = await gql(save, who, { input }, storeId)
  return { saved: result.data?.['saveProduct'] as { id: string; slug: string; revision: number } | undefined, code: result.code }
}

type Detail = {
  id: string
  name: string
  slug: string
  visible: boolean
  revision: number
  shared: boolean
  supplier: { id: string; name: string } | null
  options: { id: string; name: string; values: { id: string; name: string }[] }[]
  versions: { id: string; choices: string[]; sku: string | null; prices: { currency: string; amount: string; compareAtAmount: string | null }[] }[]
}
const detail = async (who: Who, id: string): Promise<Detail | null> =>
  (await gql(`query P($id: ID!) { product(id: $id) { id name slug visible revision shared supplier { id name } options { id name values { id name } } versions { id choices sku prices { currency amount compareAtAmount } } } }`, who, { id })).data?.['product'] as Detail | null

const listed = async (who: Who, args = '') =>
  ((await gql(`{ products${args} { nodes { id name visible supplier { name } versionCount buyable minPrice { amount currency } } } }`, who)).data?.['products'] as { nodes: { id: string; name: string; supplier: { name: string } | null; minPrice: { amount: string } | null }[] }).nodes

describe('the merchant side', () => {
  it('creates a simple product with one hidden version and lists it with its price', async () => {
    const { saved } = await create('owner', simple('Cotton shirt'))
    expect(saved).toMatchObject({ slug: 'cotton-shirt', revision: 1 })
    const product = await detail('owner', saved?.id ?? '')
    expect(product).toMatchObject({ name: 'Cotton shirt', visible: true, shared: false, supplier: null, options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '129900', compareAtAmount: null }] }] })
    const nodes = await listed('owner')
    expect(nodes.find((n) => n.id === saved?.id)).toMatchObject({ name: 'Cotton shirt', minPrice: { amount: '129900' } })
    const [entry] = await db.sql<{ action: string; actor_id: string }[]>`select action, actor_id from activity_log where target_id = ${saved?.id ?? ''}`
    expect(entry).toEqual({ action: 'product.created', actor_id: people.owner })
  })

  it('makes every combination a version and keeps each version’s choices', async () => {
    const options = [
      { name: 'Size', values: [{ name: 'S' }, { name: 'M' }] },
      { name: 'Colour', values: [{ name: 'Red' }, { name: 'Blue' }] },
    ]
    const versions = ['S', 'M'].flatMap((size) => ['Red', 'Blue'].map((colour) => ({ choices: [size, colour], sku: `TEE-${size}-${colour}`, prices: [price('99900')] })))
    const { saved } = await create('owner', { name: 'Tee', options, versions })
    const product = await detail('owner', saved?.id ?? '')
    expect(product?.options.map((o) => [o.name, o.values.map((v) => v.name)])).toEqual([['Size', ['S', 'M']], ['Colour', ['Red', 'Blue']]])
    expect(product?.versions.map((v) => v.choices)).toEqual([['S', 'Red'], ['S', 'Blue'], ['M', 'Red'], ['M', 'Blue']])
  })

  it('saves at the revision it read, removes a dropped version, and keeps the price history', async () => {
    const { saved } = await create('owner', { name: 'Mug', options: [{ name: 'Size', values: [{ name: 'Small' }, { name: 'Large' }] }], versions: [{ choices: ['Small'], prices: [price('50000')] }, { choices: ['Large'], prices: [price('70000')] }] })
    const before = await detail('owner', saved?.id ?? '')
    const small = before?.versions[0]
    const option = before?.options[0]
    const input = { name: 'Mug', options: [{ id: option?.id, name: 'Size', values: [{ id: option?.values[0]?.id, name: 'Small' }] }], versions: [{ id: small?.id, choices: ['Small'], prices: [price('55000', '60000')] }] }
    const updated = await gql(save, 'owner', { id: saved?.id, revision: 1, input })
    expect(updated.data?.['saveProduct']).toMatchObject({ revision: 2 })
    const after = await detail('owner', saved?.id ?? '')
    expect(after?.versions.map((v) => [v.id, v.prices[0]?.amount, v.prices[0]?.compareAtAmount])).toEqual([[small?.id, '55000', '60000']])
    const history = await db.sql<{ amount: string; open: boolean }[]>`select amount::text, to_at is null as open from price_history where version_id = ${small?.id ?? ''} order by from_at, open`
    expect(history).toEqual([{ amount: '50000', open: false }, { amount: '55000', open: true }])
    const stale = await gql(save, 'owner', { id: saved?.id, revision: 1, input })
    expect(stale.code).toBe('STALE_REVISION')
    expect(stale.errors?.[0]?.extensions['revision']).toBe(2)
  })

  it('suffixes a web address already taken, and frees it when the product is deleted', async () => {
    const first = await create('owner', simple('Linen towel'))
    const second = await create('owner', simple('Linen towel'))
    expect([first.saved?.slug, second.saved?.slug]).toEqual(['linen-towel', 'linen-towel-2'])
    expect((await gql(`mutation D($ids: [ID!]!) { deleteProducts(ids: $ids) }`, 'owner', { ids: [first.saved?.id] })).data?.['deleteProducts']).toBe(1)
    expect(await detail('owner', first.saved?.id ?? '')).toBeNull()
    expect((await listed('owner')).some((n) => n.id === first.saved?.id)).toBe(false)
    expect((await create('owner', simple('Linen towel'))).saved?.slug).toBe('linen-towel')
  })

  it('keeps a live address through a rename, and changes it only when asked', async () => {
    const { saved } = await create('owner', simple('Wool hat'))
    const renamed = await gql(save, 'owner', { id: saved?.id, revision: 1, input: simple('Warm wool hat') })
    expect(renamed.data?.['saveProduct']).toMatchObject({ slug: 'wool-hat' })
    const moved = await gql(save, 'owner', { id: saved?.id, revision: 2, input: simple('Warm wool hat', { slug: 'warm-wool-hat' }) })
    expect(moved.data?.['saveProduct']).toMatchObject({ slug: 'warm-wool-hat' })
  })

  it('logs a bulk delete and a bulk hide as one entry per product', async () => {
    const ids = [(await create('owner', simple('Bulk one'))).saved?.id, (await create('owner', simple('Bulk two'))).saved?.id]
    await gql(`mutation U($ids: [ID!]!) { updateProducts(ids: $ids, patch: { visible: false }) }`, 'owner', { ids })
    expect((await gql(`mutation D($ids: [ID!]!) { deleteProducts(ids: $ids) }`, 'owner', { ids })).data?.['deleteProducts']).toBe(2)
    const entries = await db.sql<{ action: string; target_label: string }[]>`select action, target_label from activity_log where target_id = any(${`{${ids.join(',')}}`}::text[]) and action in ('product.deleted', 'product.hidden') order by action, target_label`
    expect(entries).toEqual([
      { action: 'product.deleted', target_label: 'Bulk one' },
      { action: 'product.deleted', target_label: 'Bulk two' },
      { action: 'product.hidden', target_label: 'Bulk one' },
      { action: 'product.hidden', target_label: 'Bulk two' },
    ])
  })

  it('duplicates into a hidden copy with its prices and no product codes', async () => {
    const { saved } = await create('owner', simple('Silk scarf', { versions: [{ choices: [], sku: 'SCARF-1', prices: [price('250000')] }] }))
    const copy = (await gql(`mutation C($id: ID!) { duplicateProduct(id: $id) { id slug } }`, 'owner', { id: saved?.id })).data?.['duplicateProduct'] as { id: string; slug: string }
    expect(copy.slug).toBe('silk-scarf-2')
    expect(await detail('owner', copy.id)).toMatchObject({ visible: false, versions: [{ sku: null, prices: [{ amount: '250000' }] }] })
  })

  it('shows and hides in bulk, and counts each chip', async () => {
    const { saved } = await create('owner', simple('Bulk candle'))
    expect((await gql(`mutation U($ids: [ID!]!) { updateProducts(ids: $ids, patch: { visible: false }) }`, 'owner', { ids: [saved?.id] })).data?.['updateProducts']).toBe(1)
    expect((await detail('owner', saved?.id ?? ''))?.visible).toBe(false)
    expect((await gql(`mutation U($ids: [ID!]!) { updateProducts(ids: $ids, patch: { visible: true }) }`, 'owner', { ids: [saved?.id] })).data?.['updateProducts']).toBe(1)
    await gql(`mutation U($ids: [ID!]!) { updateProducts(ids: $ids, patch: { visible: false }) }`, 'owner', { ids: [saved?.id] })
    const counts = (await gql('{ productCounts { all visible hidden } }', 'owner')).data?.['productCounts'] as { all: number; visible: number; hidden: number }
    expect(counts.all).toBe(counts.visible + counts.hidden)
    expect(counts.hidden).toBeGreaterThanOrEqual(2)
  })

  it('never shows a product the plan paused or that waits for approval, in bulk or one at a time', async () => {
    const paused = (await create('owner', simple('Paused vase', { visible: false }))).saved
    const pending = (await create('owner', simple('Pending vase', { visible: false }))).saved
    await db.sql`update product set hidden_by = 'plan' where id = ${paused?.id ?? ''}`
    await db.sql`update product set approval_status = 'pending' where id = ${pending?.id ?? ''}`
    const show = await gql(`mutation U($ids: [ID!]!) { updateProducts(ids: $ids, patch: { visible: true }) }`, 'owner', { ids: [paused?.id, pending?.id] })
    expect(show.data?.['updateProducts']).toBe(0)
    for (const held of [paused, pending]) {
      expect((await detail('owner', held?.id ?? ''))?.visible).toBe(false)
      const resaved = await gql(save, 'owner', { id: held?.id, revision: held?.revision, input: { ...simple('Held again'), visible: true } })
      expect(resaved.code).toBe('NOT_SHOWABLE')
    }
    // Hiding is always allowed, and a held product saves while it stays hidden.
    expect((await gql(save, 'owner', { id: paused?.id, revision: paused?.revision, input: simple('Still paused') })).code).toBeUndefined()
  })

  it('refuses what the engine’s rules refuse, by code', async () => {
    expect((await create('owner', simple(''))).code).toBe('NAME_REQUIRED')
    expect((await create('owner', simple('No price', { versions: [{ choices: [], prices: [{ currency: 'USD', amount: '100' }] }] }))).code).toBe('PRICE_REQUIRED')
    expect((await create('owner', simple('Knife', { category: 'weapons' }))).code).toBe('CATEGORY_REFUSED')
    await create('owner', simple('Coded', { versions: [{ choices: [], sku: 'UNIQUE-1', prices: [price('100')] }] }))
    expect((await create('owner', simple('Coded again', { versions: [{ choices: [], sku: 'UNIQUE-1', prices: [price('100')] }] }))).code).toBe('DUPLICATE_SKU')
  })

  it('lets Staff read the catalogue but not write it', async () => {
    expect((await listed('staff')).length).toBeGreaterThan(0)
    expect((await create('staff', simple('Staff product'))).code).toBe('FORBIDDEN')
  })

  it('holds a store to its plan’s product limit and names the plan that unlocks more', async () => {
    const [bigger] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${t.partnerA}, 'Bigger', 'live') returning id`
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${bigger?.id ?? ''}, ${t.partnerA}, 1, 'products', 500)`
    const owner2 = await user(t.partnerA, 'owner2@a.example', 'Owner Two')
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${owner2}, ${t.storeA2}, 'owner', 'active')`
    const cookie = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: owner2, partnerId: t.partnerA }, now))
    const asOwner2 = async (name: string) => {
      const facts = { requestId: 'r', ip: null, userAgent: null }
      const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers: { cookie: `${storeCookieName}=${cookie}`, [storeHeader]: t.storeA2 } }), t.partnerA, now, activityLog, facts)
      const result = await graphql({ schema: storeSchema as GraphQLSchema, source: save, contextValue: { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now: () => now } satisfies StoreContext, variableValues: { input: simple(name) } })
      return result.errors?.[0]?.extensions ?? null
    }
    expect(await asOwner2('One')).toBeNull()
    expect(await asOwner2('Two')).toBeNull()
    expect(await asOwner2('Three')).toMatchObject({ code: 'PLAN_LIMIT', key: 'products', limit: 2, unlockedBy: { id: bigger?.id } })
    expect(smallStorePlan).not.toBe('')
  })
})

describe('a supplier', () => {
  let merchantProduct = ''
  let supplierProduct = ''
  let otherSupplierProduct = ''

  beforeAll(async () => {
    merchantProduct = (await create('owner', simple('Merchant own'))).saved?.id ?? ''
    supplierProduct = (await create('supplier', simple('Anand kurta'))).saved?.id ?? ''
    otherSupplierProduct = (await create('otherSupplier', simple('Bhatia shawl'))).saved?.id ?? ''
  })

  it('creates its own product, visible while the store needs no approval, owned by its seller', async () => {
    expect(supplierProduct).not.toBe('')
    const [row] = await db.sql<{ seller_id: string; visibility: string }[]>`select seller_id, visibility from product where id = ${supplierProduct}`
    expect(row).toEqual({ seller_id: t.sellerA1First, visibility: 'visible' })
    const [version] = await db.sql<{ seller_id: string }[]>`select seller_id from product_version where product_id = ${supplierProduct}`
    expect(version?.seller_id).toBe(t.sellerA1First)
  })

  it('pages products made in the same instant one at a time, every one once', async () => {
    // One statement gives all three the same now(), the case a millisecond cursor would skip.
    const made = (await db.sql<{ id: string }[]>`insert into product (store_id, name, slug) select ${t.storeB1}, 'Same instant ' || g, 'same-instant-' || g from generate_series(1, 3) g returning id`).map((r) => r.id)
    const seen: string[] = []
    let after: string | undefined
    for (let page = 0; page < 10; page += 1) {
      const answer = (await gql('query L($after: String) { products(first: 1, after: $after, search: "Same instant") { nodes { id } pageInfo { hasNextPage endCursor } } }', 'bOwner', { after })).data?.['products'] as { nodes: { id: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
      seen.push(...answer.nodes.map((n) => n.id))
      if (!answer.pageInfo.hasNextPage) break
      after = answer.pageInfo.endCursor ?? undefined
    }
    expect(seen.sort()).toEqual([...made].sort())
    await db.sql`delete from product where store_id = ${t.storeB1} and slug like 'same-instant-%'`
  })

  it('lists, counts and opens only its own products', async () => {
    expect((await listed('supplier')).map((n) => n.id)).toEqual([supplierProduct])
    expect((await gql('{ productCounts { all } }', 'supplier')).data?.['productCounts']).toEqual({ all: 1 })
    expect(await detail('supplier', merchantProduct)).toBeNull()
    expect(await detail('supplier', otherSupplierProduct)).toBeNull()
    expect(await detail('supplier', supplierProduct)).toMatchObject({ shared: true, supplier: { id: t.sellerA1First } })
    // Its supplier filter is its own scope: asking for another's gives nothing more.
    expect((await listed('supplier', `(supplier: "${t.sellerA1Second}")`)).map((n) => n.id)).toEqual([supplierProduct])
  })

  it('gets an address that says nothing of the merchant’s or another supplier’s products', async () => {
    await create('owner', simple('Secret launch'))
    const clash = await create('supplier', simple('Secret launch'))
    const fresh = await create('supplier', simple('Never used name'))
    // Both carry a random ending, so a taken address looks the same as a free one.
    expect(clash.saved?.slug).toMatch(/^secret-launch-[a-z2-9]{6}$/)
    expect(fresh.saved?.slug).toMatch(/^never-used-name-[a-z2-9]{6}$/)
  })

  it('uses a product code the merchant or another supplier uses without being told it exists', async () => {
    await create('owner', simple('Merchant coded', { versions: [{ choices: [], sku: 'SHARED-CODE', prices: [price('100')] }] }))
    await create('otherSupplier', simple('Other coded', { versions: [{ choices: [], sku: 'SHARED-CODE-2', prices: [price('100')] }] }))
    for (const sku of ['SHARED-CODE', 'SHARED-CODE-2']) {
      const made = await create('supplier', simple(`Supplier ${sku}`, { versions: [{ choices: [], sku, prices: [price('100')] }] }))
      expect(made.code).toBeUndefined()
    }
    // Its own codes are still its own to keep unique.
    expect((await create('supplier', simple('Supplier again', { versions: [{ choices: [], sku: 'SHARED-CODE', prices: [price('100')] }] }))).code).toBe('DUPLICATE_SKU')
  })

  it('hears only that the store is full at the plan’s limit, never the plan or what unlocks more', async () => {
    const [seller] = await db.sql<{ id: string }[]>`insert into seller (store_id, name, access_level, status) values (${t.storeA2}, 'Small supplier', 'vendor-catalogue', 'active') returning id`
    const person = await user(t.partnerA, 'small.supplier@a.example', 'Small')
    await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${person}, ${t.storeA2}, ${seller?.id ?? ''}, 'supplier-admin', 'active')`
    const cookie = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: person, partnerId: t.partnerA }, now))
    const facts = { requestId: 'r', ip: null, userAgent: null }
    const headers = { cookie: `${storeCookieName}=${cookie}`, [storeHeader]: t.storeA2, [supplierHeader]: seller?.id ?? '' }
    const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, now, activityLog, facts)
    let refusal: Record<string, unknown> | null = null
    for (const name of ['S1', 'S2', 'S3']) {
      const result = await graphql({ schema: storeSchema as GraphQLSchema, source: save, contextValue: { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now: () => now } satisfies StoreContext, variableValues: { input: simple(name) } })
      refusal = result.errors?.[0]?.extensions ?? refusal
    }
    expect(refusal).toEqual({ code: 'PLAN_LIMIT' })
  })

  it('can’t edit, duplicate or delete what isn’t its own, and can’t set visibility at all', async () => {
    const input = simple('Taken over')
    for (const id of [merchantProduct, otherSupplierProduct]) {
      expect((await gql(save, 'supplier', { id, revision: 1, input })).code).toBe('NOT_FOUND')
      expect((await gql(`mutation C($id: ID!) { duplicateProduct(id: $id) { id } }`, 'supplier', { id })).code).toBe('NOT_FOUND')
      expect((await gql(`mutation D($ids: [ID!]!) { deleteProducts(ids: $ids) }`, 'supplier', { ids: [id] })).data?.['deleteProducts']).toBe(0)
    }
    expect((await create('supplier', simple('Shown', { visible: true }))).code).toBe('SUPPLIER_FIELD')
    expect((await gql(`mutation U($ids: [ID!]!) { updateProducts(ids: $ids, patch: { visible: false }) }`, 'supplier', { ids: [supplierProduct] })).code).toBe('FORBIDDEN')
    expect(await detail('owner', merchantProduct)).toMatchObject({ name: 'Merchant own' })
  })

  it('is seen by the merchant as a shared record named for its supplier', async () => {
    expect(await detail('owner', supplierProduct)).toMatchObject({ shared: true, supplier: { id: t.sellerA1First, name: 'Anand Textiles' } })
    const nodes = await listed('owner', `(supplier: "${t.sellerA1First}")`)
    expect(nodes.map((n) => n.id)).toContain(supplierProduct)
    expect(new Set(nodes.map((n) => n.supplier?.name))).toEqual(new Set(['Anand Textiles']))
    expect((await listed('owner', '(supplier: "own")')).some((n) => n.id === supplierProduct)).toBe(false)
  })
})

describe('photos, video and files', () => {
  it('stores an upload under the store, reads it back to its own side only, and refuses what isn’t a photo or video', async () => {
    const mine = await upload('owner')
    expect(mine).toMatchObject({ status: 200, ok: true, asset: { width: 640, height: 480 } })
    const [row] = await db.sql<{ seller_id: string | null; r2_key: string; bytes: number }[]>`select seller_id, r2_key, bytes from asset where id = ${mine.asset?.id ?? ''}`
    expect(row?.seller_id).toBeNull()
    expect(row?.r2_key.startsWith(`stores/${t.storeA1}/assets/`)).toBe(true)
    expect(bucket.get(row?.r2_key ?? '')?.byteLength).toBe(png.byteLength)
    expect(await fetchAsset('owner', mine.asset?.id ?? '')).toBe(200)
    expect(await fetchAsset('supplier', mine.asset?.id ?? '')).toBe(404)
    expect(await fetchAsset('bOwner', mine.asset?.id ?? '')).toBe(404)
    expect(await upload('owner', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toMatchObject({ status: 415, code: 'UNSUPPORTED_TYPE' })
    expect(await upload('owner', new Uint8Array())).toMatchObject({ status: 400, code: 'EMPTY' })
    expect(await upload('staff')).toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })

  it('links photos in order, one to a version, and shows them with the product', async () => {
    const [a, b] = [await upload('owner'), await upload('owner')]
    const options = [{ name: 'Colour', values: [{ name: 'Red' }, { name: 'Blue' }] }]
    const versions = [{ choices: ['Red'], prices: [price('100')] }, { choices: ['Blue'], prices: [price('100')] }]
    const { saved } = await create('owner', { name: 'Photographed', description: 'Soft.', options, versions, photos: [{ assetId: a.asset?.id, alt: 'Front' }, { assetId: b.asset?.id, version: 1 }], video: { url: 'https://www.youtube.com/watch?v=x' } })
    const shown = (await gql(`query P($id: ID!) { product(id: $id) { versions { id } photos { assetId url alt versionId width } video { url uploaded } } }`, 'owner', { id: saved?.id })).data?.['product'] as { versions: { id: string }[]; photos: { assetId: string; url: string; alt: string | null; versionId: string | null; width: number }[]; video: { url: string; uploaded: boolean } }
    expect(shown.photos).toEqual([
      { assetId: a.asset?.id, url: `/api/assets/${a.asset?.id}`, alt: 'Front', versionId: null, width: 640 },
      { assetId: b.asset?.id, url: `/api/assets/${b.asset?.id}`, alt: null, versionId: shown.versions[1]?.id, width: 640 },
    ])
    expect(shown.video).toEqual({ url: 'https://www.youtube.com/watch?v=x', uploaded: false })
    const nodes = (await gql('{ products(filter: "missing_info") { nodes { id } } }', 'owner')).data?.['products'] as { nodes: { id: string }[] }
    expect(nodes.nodes.some((n) => n.id === saved?.id)).toBe(false)
    const copy = (await gql(`mutation C($id: ID!) { duplicateProduct(id: $id) { id } }`, 'owner', { id: saved?.id })).data?.['duplicateProduct'] as { id: string }
    const copied = (await gql(`query P($id: ID!) { product(id: $id) { photos { assetId } } }`, 'owner', { id: copy.id })).data?.['product'] as { photos: { assetId: string }[] }
    expect(copied.photos.map((p) => p.assetId)).toEqual([a.asset?.id, b.asset?.id])

    // Dropping Blue without sending photos keeps its photo as the product's own, never on a version that's gone.
    const versionsNow = [{ id: shown.versions[0]?.id, choices: ['Red'], prices: [price('100')] }]
    const kept = await gql(save, 'owner', { id: saved?.id, revision: saved?.revision, input: { name: 'Photographed', description: 'Soft.', options: [{ name: 'Colour', values: [{ name: 'Red' }] }], versions: versionsNow } })
    expect(kept.code).toBeUndefined()
    const after = (await gql(`query P($id: ID!) { product(id: $id) { versions { id } photos { assetId versionId } } }`, 'owner', { id: saved?.id })).data?.['product'] as { versions: { id: string }[]; photos: { assetId: string; versionId: string | null }[] }
    expect(after.versions).toHaveLength(1)
    expect(after.photos).toEqual([
      { assetId: a.asset?.id, versionId: null },
      { assetId: b.asset?.id, versionId: null },
    ])
  })

  it('counts and lists a product with no photo or no description as missing info', async () => {
    const { saved } = await create('owner', simple('Bare product'))
    const nodes = (await gql('{ products(filter: "missing_info") { nodes { id } } }', 'owner')).data?.['products'] as { nodes: { id: string }[] }
    expect(nodes.nodes.some((n) => n.id === saved?.id)).toBe(true)
    expect(((await gql('{ productCounts { missingInfo } }', 'owner')).data?.['productCounts'] as { missingInfo: number }).missingInfo).toBeGreaterThan(0)
  })

  it('keeps a supplier to its own files, and gives it the merchant’s photo on its product', async () => {
    const merchantFile = await upload('owner')
    const supplierFile = await upload('supplier')
    const [row] = await db.sql<{ seller_id: string }[]>`select seller_id from asset where id = ${supplierFile.asset?.id ?? ''}`
    expect(row?.seller_id).toBe(t.sellerA1First)
    expect(await fetchAsset('owner', supplierFile.asset?.id ?? '')).toBe(200)
    expect((await create('supplier', simple('Stolen photo', { photos: [{ assetId: merchantFile.asset?.id }] }))).code).toBe('FILE_REFUSED')
    const theirs = await create('supplier', simple('Supplier product', { photos: [{ assetId: supplierFile.asset?.id }] }))
    // The merchant adds a photo of its own to the supplier's product: the supplier now reads that file.
    const added = await upload('owner')
    const input = simple('Supplier product', { photos: [{ assetId: supplierFile.asset?.id }, { assetId: added.asset?.id }] })
    expect((await gql(save, 'owner', { id: theirs.saved?.id, revision: 1, input })).data?.['saveProduct']).toMatchObject({ revision: 2 })
    expect(await fetchAsset('supplier', added.asset?.id ?? '')).toBe(200)
    // A file in use on the supplier's product stays theirs: the merchant can't move it to its own.
    expect((await create('owner', simple('Merchant reuse', { photos: [{ assetId: added.asset?.id }] }))).code).toBe('FILE_REFUSED')
    expect(await fetchAsset('otherSupplier', added.asset?.id ?? '')).toBe(404)
  })

  it('links a photo only to an image and a video only to a video', async () => {
    const image = await upload('owner')
    const video = new Uint8Array(1024)
    video.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
    const film = await upload('owner', video)
    expect(film).toMatchObject({ status: 200, asset: { width: null } })
    expect((await create('owner', simple('Video as photo', { photos: [{ assetId: film.asset?.id }] }))).code).toBe('FILE_REFUSED')
    expect((await create('owner', simple('Photo as video', { video: { assetId: image.asset?.id } }))).code).toBe('FILE_REFUSED')
    expect((await create('owner', simple('Right kinds', { photos: [{ assetId: image.asset?.id }], video: { assetId: film.asset?.id } }))).code).toBeUndefined()
  })

  it('takes a video just under its cap', async () => {
    const big = new Uint8Array(29 * 1024 * 1024)
    big.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32])
    const response = await handleAssets(new Request('https://store.example/api/assets', { method: 'POST', body: big, headers: { 'content-length': String(big.byteLength) } }), await contextFor('owner', t.storeA1), r2)
    expect(response.status).toBe(200)
  })

  it('refuses an upload while the store is read-only but still shows its files', async () => {
    const kept = await upload('owner')
    const [before] = await db.sql<{ status: string }[]>`select status from store where id = ${t.storeA1}`
    await db.sql`update store set status = 'past_due' where id = ${t.storeA1}`
    try {
      expect(await upload('owner')).toMatchObject({ status: 403, code: 'READ_ONLY' })
      expect(await fetchAsset('owner', kept.asset?.id ?? '')).toBe(200)
    } finally {
      await db.sql`update store set status = ${before?.status ?? 'active'} where id = ${t.storeA1}`
    }
  })

  it('stops a supplier reading its upload once the merchant’s own product takes it', async () => {
    const loose = await upload('supplier')
    expect(await fetchAsset('supplier', loose.asset?.id ?? '')).toBe(200)
    expect((await create('owner', simple('Merchant takes it', { photos: [{ assetId: loose.asset?.id }] }))).code).toBeUndefined()
    expect(await fetchAsset('supplier', loose.asset?.id ?? '')).toBe(404)
  })

  it('refuses another store’s file by id as if it weren’t there', async () => {
    const theirs = await upload('bOwner')
    expect((await create('owner', simple('Cross-store photo', { photos: [{ assetId: theirs.asset?.id }] }))).code).toBe('FILE_REFUSED')
  })
})

describe('another store', () => {
  it('sees, counts and changes nothing of this store’s catalogue', async () => {
    const { saved } = await create('owner', simple('Store A only'))
    expect(await detail('bOwner', saved?.id ?? '')).toBeNull()
    expect(await listed('bOwner')).toEqual([])
    expect((await gql('{ productCounts { all } }', 'bOwner')).data?.['productCounts']).toEqual({ all: 0 })
    expect((await gql(save, 'bOwner', { id: saved?.id, revision: 1, input: simple('Hijack') })).code).toBe('NOT_FOUND')
    expect((await gql(`mutation D($ids: [ID!]!) { deleteProducts(ids: $ids) }`, 'bOwner', { ids: [saved?.id] })).data?.['deleteProducts']).toBe(0)
    expect((await gql(`mutation U($ids: [ID!]!) { updateProducts(ids: $ids, patch: { visible: false }) }`, 'bOwner', { ids: [saved?.id] })).data?.['updateProducts']).toBe(0)
    expect((await gql('{ products { nodes { id } } }', 'bOwner', {}, t.storeA1)).code).toBe('FORBIDDEN')
  })
})
