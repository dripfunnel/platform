import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { ownsWarehouse } from '#db/scoped/fulfilment'
import { defaultWarehousesOf } from '#db/scoped/refunds'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Bug #1353: a supplier with no location of its own counts its own versions in the store's default location, by name only
// (DATA-MODEL §7.4); the merchant's and another supplier's numbers stay out of its reach.

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-05T09:00:00Z')
type Who = 'owner' | 'supplier' | 'otherSupplier' | 'bOwner'
const people: Record<Who, string> = { owner: '', supplier: '', otherSupplier: '', bOwner: '' }
const cookies: Record<Who, string> = { owner: '', supplier: '', otherSupplier: '', bOwner: '' }

const user = async (partnerId: string, email: string, name: string) =>
  (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`)[0]?.id ?? ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update seller set access_level = 'vendor-catalogue' where id in (${t.sellerA1First}, ${t.sellerA1Second})`
  const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${t.partnerA}, 'Full', 'live') returning id`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${t.partnerA}, 1, 'products', 100)`
  await db.sql`update store set plan_id = ${plan?.id ?? ''}, pricing_currency = 'INR' where id = ${t.storeA1}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${t.storeA1}, ${t.partnerA}, ${plan?.id ?? ''}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})`
  people.owner = await user(t.partnerA, 'owner@a.example', 'Olivia')
  people.supplier = await user(t.partnerA, 'anand@a.example', 'Anand')
  people.otherSupplier = await user(t.partnerA, 'bhatia@a.example', 'Bhatia')
  people.bOwner = await user(t.partnerB, 'owner@b.example', 'Bea')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.bOwner}, ${t.storeB1}, 'owner', 'active')`
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${people.supplier}, ${t.storeA1}, ${t.sellerA1First}, 'supplier-admin', 'active'), (${people.otherSupplier}, ${t.storeA1}, ${t.sellerA1Second}, 'supplier-admin', 'active')`
  for (const who of Object.keys(cookies) as Who[]) {
    cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: who === 'bOwner' ? t.partnerB : t.partnerA }, now))
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const sellerOf: Partial<Record<Who, () => string>> = { supplier: () => t.sellerA1First, otherSupplier: () => t.sellerA1Second }

const gql = async (source: string, who: Who, variables: Record<string, unknown> = {}) => {
  const partnerId = who === 'bOwner' ? t.partnerB : t.partnerA
  const storeId = who === 'bOwner' ? t.storeB1 : t.storeA1
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const seller = sellerOf[who]?.()
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeId, ...(seller ? { [supplierHeader]: seller } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: activityLog, facts, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

interface Place {
  id: string
  name: string
  isDefault: boolean
  supplierId: string | null
  units: number
  revision: number
  address: { line1: string | null; city: string | null }
}
const places = async (who: Who) => ((await gql('{ warehouses { nodes { id name isDefault supplierId units revision address { line1 city } } } }', who)).data?.['warehouses'] as { nodes: Place[] } | undefined)?.nodes ?? []
const saveWarehouse = async (who: Who, input: Record<string, unknown>, id?: string, revision?: number) => {
  const result = await gql('mutation W($id: ID, $revision: Int, $input: WarehouseInput!) { saveWarehouse(id: $id, revision: $revision, input: $input) }', who, { id, revision, input })
  return { id: result.data?.['saveWarehouse'] as string | undefined, code: result.code }
}
const product = async (who: Who, name: string) => {
  const input = { name, options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }] }
  const saved = await gql('mutation S($input: ProductInput!) { saveProduct(input: $input) { id } }', who, { input })
  const id = (saved.data?.['saveProduct'] as { id: string } | undefined)?.id ?? ''
  const read = await gql('query P($id: ID!) { product(id: $id) { versions { id } } }', who, { id })
  return { id, version: (read.data?.['product'] as { versions: { id: string }[] } | null)?.versions[0]?.id ?? '' }
}
const setStock = async (who: Who, entries: { versionId: string; warehouseId: string; quantity: number }[]) => {
  const result = await gql('mutation S($entries: [StockQuantityInput!]!) { setStock(entries: $entries) { versionId quantity } }', who, { entries })
  return { set: result.data?.['setStock'] as { versionId: string; quantity: number }[] | undefined, code: result.code }
}
const adjust = async (who: Who, versionId: string, warehouseId: string, delta: number, reason: string) => {
  const result = await gql('mutation A($v: ID!, $w: ID!, $d: Int!, $r: String!) { adjustStock(versionId: $v, warehouseId: $w, delta: $d, reason: $r) }', who, { v: versionId, w: warehouseId, d: delta, r: reason })
  return { quantity: result.data?.['adjustStock'] as number | undefined, code: result.code }
}
const threshold = async (who: Who, v: string, w: string, n: number) =>
  (await gql('mutation T($v: ID!, $w: ID!, $n: Int) { setLowStockThreshold(versionId: $v, warehouseId: $w, threshold: $n) }', who, { v, w, n })).code
type Level = { warehouseId: string; warehouseName: string; isDefault: boolean; onHand: number }
const levels = async (who: Who, productId: string): Promise<Level[]> =>
  (((await gql('query L($p: ID!) { productStock(productId: $p) { nodes { levels { warehouseId warehouseName isDefault onHand } } } }', who, { p: productId })).data?.['productStock'] as { nodes: { levels: Level[] }[] } | undefined)?.nodes ?? []).flatMap((v) => v.levels)
type Moved = { delta: number; reason: string; actorName: string | null; warehouseName: string }
const history = async (who: Who, productId: string): Promise<Moved[]> =>
  ((await gql('query H($p: ID!) { stockHistory(productId: $p) { nodes { delta reason actorName warehouseName } } }', who, { p: productId })).data?.['stockHistory'] as { nodes: Moved[] } | undefined)?.nodes ?? []

let main = ''
let theirs = { id: '', version: '' }
let merchants = { id: '', version: '' }

describe('A supplier with no location of its own (#1353)', () => {
  beforeAll(async () => {
    main = (await places('owner')).find((w) => w.supplierId === null && w.isDefault)?.id ?? ''
    await saveWarehouse('owner', { name: 'Main location', address: { line1: '1 High St', city: 'Pune' } }, main, 1)
    merchants = await product('owner', 'Store kurta')
    await setStock('owner', [{ versionId: merchants.version, warehouseId: main, quantity: 50 }])
    theirs = await product('supplier', 'Anand kurta')
  })

  it('is offered the store’s default location by name, never its address or the merchant’s count', async () => {
    for (const who of ['supplier', 'otherSupplier'] as const) {
      expect(await places(who), who).toMatchObject([{ id: main, name: 'Main location', isDefault: true, supplierId: null, units: 0, address: { line1: null, city: null } }])
    }
    expect((await places('owner')).find((w) => w.id === main)).toMatchObject({ units: 50, address: { line1: '1 High St', city: 'Pune' } })
  })

  it('counts its own versions there, which the merchant side reads, with the supplier in the history', async () => {
    expect((await setStock('supplier', [{ versionId: theirs.version, warehouseId: main, quantity: 7 }])).code).toBeUndefined()
    expect((await adjust('supplier', theirs.version, main, 2, 'received')).quantity).toBe(9)
    expect((await levels('supplier', theirs.id)).map((l) => [l.warehouseName, l.isDefault, l.onHand])).toEqual([['Main location', true, 9]])
    expect((await levels('owner', theirs.id)).map((l) => l.onHand)).toEqual([9])
    expect((await history('supplier', theirs.id)).map((m) => [m.reason, m.delta, m.actorName, m.warehouseName])).toEqual([
      ['received', 2, 'Anand', 'Main location'],
      ['starting', 7, 'Anand', 'Main location'],
    ])
    expect((await history('owner', theirs.id)).map((m) => m.actorName)).toEqual(['Anand', 'Anand'])
    expect(await db.sql`select 1 from activity_log where store_id = ${t.storeA1} and actor_id = ${people.supplier} and action = 'stock.adjusted'`).not.toHaveLength(0)
  })

  it('shows the supplier only its own units there, and the merchant side the whole', async () => {
    expect((await places('supplier')).find((w) => w.id === main)?.units).toBe(9)
    expect((await places('owner')).find((w) => w.id === main)?.units).toBe(59)
    expect((await places('otherSupplier')).find((w) => w.id === main)?.units).toBe(0)
  })

  it('keeps every other count out of reach', async () => {
    expect(await levels('supplier', merchants.id)).toEqual([])
    expect(await levels('otherSupplier', theirs.id)).toEqual([])
    expect(await history('otherSupplier', theirs.id)).toEqual([])
    expect((await adjust('supplier', merchants.version, main, 1, 'received')).code).toBe('NOT_FOUND')
    expect((await adjust('otherSupplier', theirs.version, main, 1, 'received')).code).toBe('NOT_FOUND')
    expect((await adjust('owner', theirs.version, main, 1, 'received')).code).toBe('NOT_FOUND')
    expect((await adjust('bOwner', theirs.version, main, 1, 'received')).code).toBe('NOT_FOUND')
    expect((await saveWarehouse('supplier', { name: 'Renamed' }, main, 2)).code).toBe('NOT_FOUND')
    expect(await db.sql`select on_hand from stock_level where version_id = ${merchants.version}`).toMatchObject([{ on_hand: 50 }])
  })

  it('sets its own low-stock threshold there, and the merchant side never does', async () => {
    expect(await threshold('supplier', theirs.version, main, 4)).toBeUndefined()
    expect(await threshold('owner', theirs.version, main, 1)).toBe('NOT_FOUND')
  })

  it('ships from the store’s location and takes returns back to it, as they hold its stock there', async () => {
    const sellers = [t.sellerA1First, t.sellerA1Second]
    const owns = (seller: string | null) => withSystemScope(db.sql, (tx) => ownsWarehouse(tx, t.storeA1, seller, main))
    const homes = () => withSystemScope(db.sql, (tx) => defaultWarehousesOf(tx, t.storeA1, [null, ...sellers]))
    expect([await owns(null), await owns(sellers[0] ?? ''), await owns(sellers[1] ?? '')]).toEqual([true, true, true])
    expect([...(await homes()).entries()]).toEqual([[null, main], [sellers[0], main], [sellers[1], main]])
  })

  it('keeps the stock where it was counted when it adds a location of its own, which becomes its default', async () => {
    const own = (await saveWarehouse('supplier', { name: 'Anand godown' })).id ?? ''
    expect((await places('supplier')).map((w) => [w.name, w.isDefault])).toEqual([['Main location', false], ['Anand godown', true]])
    const second = await product('supplier', 'Anand shawl')
    expect((await setStock('supplier', [{ versionId: second.version, warehouseId: own, quantity: 3 }])).code).toBeUndefined()
    // A version with nothing in the store's location is counted in its own; what is there stays and can still change.
    expect((await adjust('supplier', second.version, main, 1, 'received')).code).toBe('NOT_FOUND')
    expect((await adjust('supplier', theirs.version, main, -1, 'damaged')).quantity).toBe(8)
    expect((await levels('supplier', theirs.id)).map((l) => [l.warehouseName, l.onHand])).toEqual([['Main location', 8]])
  })

  it('then ships and takes returns at its own default, shipping from the store’s only where it still holds stock', async () => {
    const own = (await places('supplier')).find((w) => w.supplierId !== null)?.id ?? ''
    const homes = await withSystemScope(db.sql, (tx) => defaultWarehousesOf(tx, t.storeA1, [null, t.sellerA1First, t.sellerA1Second]))
    expect([homes.get(null), homes.get(t.sellerA1First), homes.get(t.sellerA1Second)]).toEqual([main, own, main])
    expect(await withSystemScope(db.sql, (tx) => ownsWarehouse(tx, t.storeA1, t.sellerA1First, own))).toBe(true)
    expect(await withSystemScope(db.sql, (tx) => ownsWarehouse(tx, t.storeA1, t.sellerA1First, main))).toBe(true)
    // Nor another supplier's location, whatever the store's default does.
    expect(await withSystemScope(db.sql, (tx) => ownsWarehouse(tx, t.storeA1, t.sellerA1Second, own))).toBe(false)
  })

  it('leaves a supplier that adds nothing on the store’s location', async () => {
    expect(await places('otherSupplier')).toMatchObject([{ id: main, isDefault: true }])
  })
})
