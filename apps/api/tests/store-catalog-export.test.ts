import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { deleteExpiredCatalogExports, failDeadCatalogExports, selectCatalogExport } from '#db/scoped/catalogExports'
import { withScope, withSystemScope } from '#db/scoped/index'
import { buildCatalogExport } from '#engine/modules/catalog/index'
import type { TenantContext } from '#core/tenancy'
import { catalogExportDeliverer } from '#jobs/queues/deliverers/catalogExport'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #301 (SAPI 16, part 1): product and stock exports as jobs (CATALOG K8–K11; FIRST-RELEASE §13).

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-06T09:00:00Z')
type Who = 'owner' | 'staff' | 'supplier' | 'otherSupplier' | 'bOwner'
const people: Record<Who, string> = { owner: '', staff: '', supplier: '', otherSupplier: '', bOwner: '' }
const cookies: Record<Who, string> = { owner: '', staff: '', supplier: '', otherSupplier: '', bOwner: '' }

const user = async (partnerId: string, email: string, name: string) =>
  (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`)[0]?.id ?? ''

const subscribe = async (storeId: string, partnerId: string) => {
  const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${`Plan ${storeId.slice(0, 6)}`}, 'live') returning id`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${partnerId}, 1, 'products', 50)`
  await db.sql`update store set plan_id = ${plan?.id ?? ''}, pricing_currency = 'INR' where id = ${storeId}`
  await db.sql`delete from store_subscription where store_id = ${storeId}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${storeId}, ${partnerId}, ${plan?.id ?? ''}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})`
}

const sellerOf: Partial<Record<Who, () => string>> = { supplier: () => t.sellerA1First, otherSupplier: () => t.sellerA1Second }

/** Acting as `who`'s person, but through a read-only support session (ACCESS §8), at the resolver itself. */
const asSupport = (context: StoreContext): StoreContext => {
  if (context.standing.kind !== 'acting') return context
  const { caller } = context.standing
  return { ...context, standing: { ...context.standing, caller: { ...caller, context: { ...caller.context, caller: { kind: 'support', supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: 'read' } } } } }
}

const gql = async (source: string, who: Who, variables: Record<string, unknown> = {}, storeId = who === 'bOwner' ? t.storeB1 : t.storeA1, through: (c: StoreContext) => StoreContext = (c) => c) => {
  const partnerId = who === 'bOwner' ? t.partnerB : t.partnerA
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const seller = sellerOf[who]?.()
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeId, ...(seller ? { [supplierHeader]: seller } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, now, activityLog, facts)
  const contextValue: StoreContext = through({ standing, partnerId, sql: db.sql, activity: activityLog, facts, now: () => now })
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, errors: result.errors }
}

const create = async (who: Who, input: Record<string, unknown>) => {
  const result = await gql('mutation S($input: ProductInput!) { saveProduct(input: $input) { id } }', who, { input })
  expect(result.errors).toBeUndefined()
  return (result.data?.['saveProduct'] as { id: string }).id
}
const inr = (amount: string, compareAtAmount?: string) => ({ currency: 'INR', amount, ...(compareAtAmount ? { compareAtAmount } : {}) })

type Job = { id: string; kind: string; state: string; rows: number | null; truncated: boolean; csv: string | null; expiresAt: string | null }
const ask = async (who: Who, kind: 'products' | 'stock', filter?: Record<string, unknown>) => {
  const result = await gql('mutation E($k: CatalogExportKind!, $f: CatalogExportFilterInput) { requestCatalogExport(kind: $k, filter: $f) }', who, { k: kind, f: filter })
  return { id: result.data?.['requestCatalogExport'] as string | undefined, code: result.code }
}
const job = async (who: Who, id: string) => (await gql('query J($id: ID!) { catalogExport(id: $id) { id kind state rows truncated csv expiresAt } }', who, { id })).data?.['catalogExport'] as Job | null
const relay = () => relayDue(db.sql, { 'export.catalog': catalogExportDeliverer(db.sql, () => now) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
const exported = async (who: Who, kind: 'products' | 'stock', filter?: Record<string, unknown>) => {
  const { id } = await ask(who, kind, filter)
  expect(id).toBeDefined()
  await relay()
  const done = await job(who, id ?? '')
  expect(done?.state).toBe('done')
  return { ...done, lines: (done?.csv ?? '').split('\n') }
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update seller set access_level = 'vendor-catalogue' where id in (${t.sellerA1First}, ${t.sellerA1Second})`
  people.owner = await user(t.partnerA, 'owner@a.example', 'Olivia')
  people.staff = await user(t.partnerA, 'staff@a.example', 'Sam')
  people.supplier = await user(t.partnerA, 'anand@a.example', 'Anand')
  people.otherSupplier = await user(t.partnerA, 'bhatia@a.example', 'Bhatia')
  people.bOwner = await user(t.partnerB, 'owner@b.example', 'Bea')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.staff}, ${t.storeA1}, 'staff', 'active'), (${people.bOwner}, ${t.storeB1}, 'owner', 'active')`
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${people.supplier}, ${t.storeA1}, ${t.sellerA1First}, 'supplier-admin', 'active'), (${people.otherSupplier}, ${t.storeA1}, ${t.sellerA1Second}, 'supplier-admin', 'active')`
  await subscribe(t.storeA1, t.partnerA)
  await subscribe(t.storeB1, t.partnerB)
  for (const who of Object.keys(cookies) as Who[]) {
    cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: who === 'bOwner' ? t.partnerB : t.partnerA }, now))
  }

  const kurta = await create('owner', {
    name: 'Kurta',
    description: '=cotton, handloomed',
    options: [{ name: 'Size', values: [{ name: 'S' }, { name: 'M' }] }],
    versions: [
      { choices: ['S'], sku: 'KU-S', weightGrams: 300, prices: [inr('129950', '149900')], cost: { amount: '60000', currency: 'INR' } },
      { choices: ['M'], sku: 'KU-M', prices: [inr('129950')] },
    ],
  })
  await create('owner', { name: 'Hidden lamp', visible: false, options: [], versions: [{ choices: [], sku: 'LAMP', prices: [inr('5000')] }] })
  await create('supplier', { name: 'Supplier mug', options: [], versions: [{ choices: [], sku: 'MUG', prices: [inr('20000')] }] })
  await create('otherSupplier', { name: 'Other bowl', options: [], versions: [{ choices: [], sku: 'BOWL', prices: [inr('30000')] }] })
  await create('bOwner', { name: 'B thing', options: [], versions: [{ choices: [], sku: 'KU-S', prices: [inr('100')] }] })

  // Hindi and a manually priced USD, as Store info and the product form would leave them.
  await db.sql`insert into store_language (store_id, language, status, position) values (${t.storeA1}, 'hi-IN', 'active', 1) on conflict do nothing`
  await db.sql`insert into translation (store_id, entity, entity_id, field, language, text, source_hash) values (${t.storeA1}, 'product', ${kurta}, 'name', 'hi-IN', 'कुर्ता', ${'0'.repeat(32)})`
  const small = (await db.sql<{ id: string }[]>`select id from product_version where product_id = ${kurta} and sku = 'KU-S'`)[0]?.id ?? ''
  await db.sql`insert into version_price (version_id, store_id, currency, amount, source) values (${small}, ${t.storeA1}, 'USD', 1599, 'manual')`
  const home = (await db.sql<{ id: string }[]>`select id from warehouse where store_id = ${t.storeA1} and seller_id is null and is_default and deleted_at is null`)[0]?.id
    ?? ''
  const shop = (await db.sql<{ id: string }[]>`insert into warehouse (store_id, name) values (${t.storeA1}, 'Shop floor') returning id`)[0]?.id ?? ''
  await db.sql`insert into stock_level (version_id, warehouse_id, store_id, on_hand, reserved) values (${small}, ${home}, ${t.storeA1}, 7, 2), (${small}, ${shop}, ${t.storeA1}, 3, 0)`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('product exports', () => {
  it('build after the request, one row a version with prices in units, translations and manual currencies as columns', async () => {
    const { id } = await ask('owner', 'products')
    expect((await job('owner', id ?? ''))?.state).toBe('queued')
    await relay()
    const done = await job('owner', id ?? '')
    const lines = (done?.csv ?? '').split('\n')
    expect(lines[0]).toBe('handle,name,description,type,visible,option1 name,option1 value,option2 name,option2 value,option3 name,option3 value,sku,barcode,price,compare at price,cost,weight grams,stock,name:hi-IN,description:hi-IN,price:USD')
    expect(lines).toContain(`kurta,Kurta,"'=cotton, handloomed",physical,yes,Size,S,,,,,KU-S,,1299.50,1499.00,600.00,300,7,कुर्ता,,15.99`)
    expect(lines).toContain('kurta,,,,,,M,,,,,KU-M,,1299.50,,,,0,,,')
    // The merchant side's file holds its suppliers' products, never another store's.
    expect(done?.csv).toContain('MUG')
    expect(done?.csv).toContain('BOWL')
    expect(done?.csv).not.toContain('B thing')
    expect(done?.rows).toBe(lines.length - 1)
    expect(done?.truncated).toBe(false)
  })

  it('export the list’s filter: hidden only, the store’s own, a search', async () => {
    const hidden = await exported('owner', 'products', { filter: 'hidden' })
    expect(hidden.lines.slice(1).map((l) => l.split(',')[0])).toEqual(['hidden-lamp'])
    const own = await exported('owner', 'products', { supplier: 'own' })
    expect(own.csv).not.toContain('MUG')
    expect(own.csv).toContain('LAMP')
    const searched = await exported('staff', 'products', { search: 'kurta' })
    expect(searched.rows).toBe(2)
    expect((await ask('owner', 'products', { filter: 'loudest' })).code).toBe('INVALID_INPUT')
    // The search text can be a name, so the log says only that one was used (LOGGING §4.1).
    const logged = await db.sql<{ after: string }[]>`select c->>'after' as after from activity_log, jsonb_array_elements(changes) c where action = 'catalog.exported' and actor_id = ${people.staff}`
    expect(logged[0]?.after).toContain('"search":"searched"')
  })

  it('give a supplier its own rows only, whatever supplier it names', async () => {
    const mine = await exported('supplier', 'products', { supplier: t.sellerA1Second })
    expect(mine.lines.slice(1).map((l) => l.split(',')[1])).toEqual(['Supplier mug'])
    expect(mine.csv).not.toContain('KU-S')
    expect(mine.csv).not.toContain('BOWL')
  })
})

describe('an export’s size', () => {
  const ownerScope = (): TenantContext => ({ caller: { kind: 'person', userId: people.owner, sessionId: '' }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' }, subscription: 'active' })

  it('stops at its cap with whole products, and says where it was cut, for both files', async () => {
    const { id: products } = await ask('owner', 'products')
    const { id: stock } = await ask('owner', 'stock')
    const built = await withScope(db.sql, ownerScope(), async (tx) => {
      const job = (id: string | undefined) => selectCatalogExport(tx, t.storeA1, id ?? '').then((j) => j ?? Promise.reject(new Error('no job')))
      return { products: await buildCatalogExport(tx, await job(products), 2), stock: await buildCatalogExport(tx, await job(stock), 1) }
    })
    expect(built.products).toMatchObject({ rows: 2, truncated: true })
    const lines = built.products.csv.split('\n')
    // Header, two rows, the note: newest first, and never half a product.
    expect(lines).toHaveLength(4)
    expect(lines.at(-1)).toBe('Only the first 2 rows are included; narrow the filter to see the rest.')
    const cut = await withScope(db.sql, ownerScope(), async (tx) => buildCatalogExport(tx, (await selectCatalogExport(tx, t.storeA1, products ?? '')) ?? Promise.reject(new Error('no job')), 4))
    // At four rows the next product is Kurta, whose two versions would make five: it's left out whole.
    expect(cut.csv).not.toContain('KU-S')
    expect(cut.rows).toBeLessThanOrEqual(4)
    expect(built.stock).toMatchObject({ rows: 1, truncated: true })
    expect(built.stock.csv.split('\n').at(-1)).toBe('Only the first 1 rows are included; narrow the filter to see the rest.')
  })
})

describe('stock exports', () => {
  it('list every count in every location the caller reads, and none of another supplier’s', async () => {
    const all = await exported('owner', 'stock', { search: 'kurta' })
    expect(all.lines).toEqual(['product,version,options,sku,location,on hand,reserved', 'Kurta,,S,KU-S,Main location,7,2', 'Kurta,,S,KU-S,Shop floor,3,0'])
    const supplier = await exported('supplier', 'stock')
    expect(supplier.csv).not.toContain('KU-S')
  })
})

describe('who reads an export', () => {
  it('reads one back only as the person who asked, in the store it was asked in', async () => {
    const { id } = await ask('supplier', 'products')
    await relay()
    for (const who of ['otherSupplier', 'owner', 'staff', 'bOwner'] as const) expect(await job(who, id ?? ''), who).toBeNull()
    // Another store's owner sent in with this store's header is refused before anything is read.
    expect((await gql('{ catalogExports { id } }', 'bOwner', {}, t.storeA1)).code).toBe('FORBIDDEN')
    const recent = (await gql('{ catalogExports { id kind state } }', 'supplier')).data?.['catalogExports'] as { id: string }[]
    expect(recent.map((r) => r.id)).toContain(id)
    const mine = (await gql('{ catalogExports { id } }', 'otherSupplier')).data?.['catalogExports'] as { id: string }[]
    expect(mine.map((r) => r.id)).not.toContain(id)
    // Row security agrees: in the other supplier's scope the row isn't there at all.
    expect(await db.sql`select seller_id from catalog_export where id = ${id ?? ''}`).toEqual([{ seller_id: t.sellerA1First }])
  })

  it('is a read: allowed while the store is read-only, never for a read-only support session', async () => {
    await db.sql`update store_subscription set status = 'cancelled' where store_id = ${t.storeA1}`
    try {
      expect((await ask('owner', 'products')).code).toBeUndefined()
    } finally {
      await db.sql`update store_subscription set status = 'active' where store_id = ${t.storeA1}`
    }
    const refused = await gql('mutation { requestCatalogExport(kind: products) }', 'owner', {}, t.storeA1, asSupport)
    expect(refused.code).toBe('FORBIDDEN')
  })

  it('says expired after its hour, failed when the relay gives up, and is purged', async () => {
    const { id } = await ask('owner', 'products')
    await db.sql`update outbox set failed_at = ${now} where kind = 'export.catalog' and payload->>'jobId' = ${id ?? ''}`
    await withSystemScope(db.sql, (tx) => failDeadCatalogExports(tx, now, new Date(now.getTime() + 1000)))
    expect((await job('owner', id ?? ''))?.state).toBe('failed')
    const done = await exported('owner', 'products')
    await db.sql`update catalog_export set expires_at = ${new Date(now.getTime() - 1000)} where id = ${done.id ?? ''}`
    expect(await job('owner', done.id ?? '')).toMatchObject({ state: 'expired', csv: null })
    expect(await withSystemScope(db.sql, (tx) => deleteExpiredCatalogExports(tx, now))).toBeGreaterThan(0)
    expect(await db.sql`select 1 from catalog_export where id = ${done.id ?? ''}`).toEqual([])
  })
})
