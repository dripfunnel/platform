import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #294 (SAPI 4): stock locations, stock per version and location, and the movement ledger. Each owner
// counts its own; every change is a movement with its reason, who and the result (CATALOG-DESIGN G4).

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-05T09:00:00Z')
type Who = 'owner' | 'manager' | 'staff' | 'supplier' | 'otherSupplier' | 'bOwner'
const people: Record<Who, string> = { owner: '', manager: '', staff: '', supplier: '', otherSupplier: '', bOwner: '' }
const cookies: Record<Who, string> = { owner: '', manager: '', staff: '', supplier: '', otherSupplier: '', bOwner: '' }

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
  people.manager = await user(t.partnerA, 'manager@a.example', 'Mo')
  people.staff = await user(t.partnerA, 'staff@a.example', 'Sam')
  people.supplier = await user(t.partnerA, 'anand@a.example', 'Anand')
  people.otherSupplier = await user(t.partnerA, 'bhatia@a.example', 'Bhatia')
  people.bOwner = await user(t.partnerB, 'owner@b.example', 'Bea')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.manager}, ${t.storeA1}, 'manager', 'active'), (${people.staff}, ${t.storeA1}, 'staff', 'active'), (${people.bOwner}, ${t.storeB1}, 'owner', 'active')`
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
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, errors: result.errors }
}

interface Place {
  id: string
  name: string
  isDefault: boolean
  supplierId: string | null
  units: number
  revision: number
}
const places = async (who: Who) => ((await gql('{ warehouses { nodes { id name isDefault supplierId units revision } } }', who)).data?.['warehouses'] as { nodes: Place[] } | undefined)?.nodes ?? []
const saveWarehouse = async (who: Who, input: Record<string, unknown>, id?: string, revision?: number) => {
  const result = await gql('mutation W($id: ID, $revision: Int, $input: WarehouseInput!) { saveWarehouse(id: $id, revision: $revision, input: $input) }', who, { id, revision, input })
  return { id: result.data?.['saveWarehouse'] as string | undefined, code: result.code }
}
const deleteWarehouse = async (who: Who, id: string) => (await gql('mutation D($id: ID!) { deleteWarehouse(id: $id) }', who, { id })).code

/** A product with `versions` versions; answers its version ids. */
const product = async (who: Who, name: string, versions = 1) => {
  const input =
    versions === 1
      ? { name, options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }] }
      : { name, options: [{ name: 'Size', values: Array.from({ length: versions }, (_, i) => ({ name: `S${i}` })) }], versions: Array.from({ length: versions }, (_, i) => ({ choices: [`S${i}`], prices: [{ currency: 'INR', amount: '100' }] })) }
  const saved = await gql('mutation S($input: ProductInput!) { saveProduct(input: $input) { id } }', who, { input })
  const id = (saved.data?.['saveProduct'] as { id: string } | undefined)?.id ?? ''
  const read = await gql('query P($id: ID!) { product(id: $id) { versions { id } } }', who, { id })
  return { id, versions: ((read.data?.['product'] as { versions: { id: string }[] } | null)?.versions ?? []).map((v) => v.id) }
}
const setStock = async (who: Who, entries: { versionId: string; warehouseId: string; quantity: number }[]) => {
  const result = await gql('mutation S($entries: [StockQuantityInput!]!) { setStock(entries: $entries) { versionId quantity } }', who, { entries })
  return { set: result.data?.['setStock'] as { versionId: string; quantity: number }[] | undefined, code: result.code }
}
const adjust = async (who: Who, versionId: string, warehouseId: string, delta: number, reason: string) => {
  const result = await gql('mutation A($v: ID!, $w: ID!, $d: Int!, $r: String!) { adjustStock(versionId: $v, warehouseId: $w, delta: $d, reason: $r) }', who, { v: versionId, w: warehouseId, d: delta, r: reason })
  return { quantity: result.data?.['adjustStock'] as number | undefined, code: result.code }
}
interface MovementOut {
  delta: number
  resultingQuantity: number
  reason: string
  actorKind: string
  actorName: string | null
  warehouseName: string
}
const history = async (who: Who, productId: string, versionId?: string, first?: number, after?: string) => {
  const result = await gql(
    'query H($p: ID!, $v: ID, $first: Int, $after: String) { stockHistory(productId: $p, versionId: $v, first: $first, after: $after) { nodes { delta resultingQuantity reason actorKind actorName warehouseName } pageInfo { hasNextPage endCursor } } }',
    who,
    { p: productId, v: versionId, first, after },
  )
  return result.data?.['stockHistory'] as { nodes: MovementOut[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } | undefined
}
type LevelOut = { versionId: string; warehouseId: string; onHand: number; reserved: number; lowStockThreshold: number }
const stockPage = async (who: Who, productId: string, first?: number, after?: string) =>
  (await gql('query L($p: ID!, $first: Int, $after: String) { productStock(productId: $p, first: $first, after: $after) { nodes { versionId levels { warehouseId onHand reserved lowStockThreshold } } pageInfo { hasNextPage endCursor } } }', who, { p: productId, first, after })).data?.['productStock'] as
    | { nodes: { versionId: string; levels: Omit<LevelOut, 'versionId'>[] }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
    | undefined
/** Every level the caller reads, in the editor's order. */
const levels = async (who: Who, productId: string): Promise<LevelOut[]> => ((await stockPage(who, productId))?.nodes ?? []).flatMap((v) => v.levels.map((l) => ({ versionId: v.versionId, ...l })))
const main = async () => (await places('owner')).find((w) => w.isDefault && w.supplierId === null)?.id ?? ''

describe('Stock locations', () => {
  it('starts every store with the merchant’s default location, including one made later', async () => {
    expect((await places('owner')).filter((w) => w.supplierId === null)).toMatchObject([{ name: 'Main location', isDefault: true, units: 0 }])
    const [fresh] = await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country) values (${t.partnerA}, 'Fresh', 'fresh-inv', 'IN') returning id`
    expect(await db.sql`select name from warehouse where store_id = ${fresh?.id ?? ''} and is_default`).toHaveLength(1)
  })

  it('adds, renames and moves the default, never deleting the default or a location holding stock', async () => {
    const back = await saveWarehouse('owner', { name: 'Back room', address: { line1: '12 High St', city: 'Pune', country: 'in' } })
    expect(back.code).toBeUndefined()
    const added = (await places('owner')).find((w) => w.id === back.id)
    expect(added).toMatchObject({ isDefault: false, revision: 1 })
    expect((await saveWarehouse('owner', { name: 'Back room 2' }, back.id, 1)).code).toBeUndefined()
    expect((await saveWarehouse('owner', { name: 'Stale' }, back.id, 1)).code).toBe('STALE_REVISION')
    const makeDefault = async (who: Who, id: string) => (await gql('mutation M($id: ID!) { setDefaultWarehouse(id: $id) }', who, { id })).code
    expect(await makeDefault('owner', back.id ?? '')).toBeUndefined()
    const now2 = await places('owner')
    expect(now2.filter((w) => w.isDefault && w.supplierId === null).map((w) => w.id)).toEqual([back.id])
    expect(await deleteWarehouse('owner', back.id ?? '')).toBe('DEFAULT_WAREHOUSE')

    const old = now2.find((w) => w.name === 'Main location')?.id ?? ''
    const { versions } = await product('owner', 'Held mug')
    await setStock('owner', [{ versionId: versions[0] ?? '', warehouseId: old, quantity: 4 }])
    expect(await deleteWarehouse('owner', old)).toBe('WAREHOUSE_HOLDS_STOCK')
    await setStock('owner', [{ versionId: versions[0] ?? '', warehouseId: old, quantity: 0 }])
    expect(await deleteWarehouse('owner', old)).toBeUndefined()
    expect((await places('owner')).some((w) => w.id === old)).toBe(false)
    const again = await saveWarehouse('owner', { name: 'Main location' })
    expect(await makeDefault('owner', again.id ?? '')).toBeUndefined()
    expect(await makeDefault('manager', back.id ?? '')).toBe('FORBIDDEN')
    expect((await saveWarehouse('owner', { name: '' })).code).toBe('INVALID_INPUT')
    expect((await saveWarehouse('owner', { name: 'X', address: { country: 'India' } })).code).toBe('INVALID_INPUT')
  })

  it('is the Owner’s to change, not a Manager’s or Staff’s (ACCESS §5.1)', async () => {
    expect((await saveWarehouse('manager', { name: 'Manager room' })).code).toBe('FORBIDDEN')
    expect((await saveWarehouse('staff', { name: 'Staff room' })).code).toBe('FORBIDDEN')
    expect((await places('staff')).length).toBeGreaterThan(0)
  })

  it('lets a supplier keep its own, which the merchant side reads and never changes', async () => {
    const theirs = await saveWarehouse('supplier', { name: 'Anand godown' })
    expect((await places('supplier')).map((w) => [w.id, w.isDefault])).toEqual([[theirs.id, true]])
    expect(await places('otherSupplier')).toEqual([])
    expect((await places('owner')).find((w) => w.id === theirs.id)).toMatchObject({ supplierId: t.sellerA1First })
    expect((await saveWarehouse('owner', { name: 'Taken' }, theirs.id, 1)).code).toBe('NOT_FOUND')
    expect(await deleteWarehouse('owner', theirs.id ?? '')).toBe('NOT_FOUND')
    expect((await gql('mutation M($id: ID!) { setDefaultWarehouse(id: $id) }', 'owner', { id: theirs.id })).code).toBe('NOT_FOUND')
    expect((await saveWarehouse('otherSupplier', { name: 'Taken' }, theirs.id, 1)).code).toBe('NOT_FOUND')
  })

  it('never leaves stock in a location deleted at the same moment', async () => {
    const spare = (await saveWarehouse('owner', { name: 'Spare room' })).id ?? ''
    const { versions } = await product('owner', 'Racing mug')
    // A delete holds the location and has soft-deleted it, not yet committed.
    let commit = () => {}
    const held = new Promise<void>((resolve) => (commit = resolve))
    const deleting = db.sql.begin(async (tx) => {
      await tx`select 1 from warehouse where id = ${spare} for update`
      await tx`update warehouse set deleted_at = now() where id = ${spare}`
      await held
    })
    await new Promise((r) => setTimeout(r, 100))
    const counting = adjust('owner', versions[0] ?? '', spare, 3, 'received')
    // Commit only once the count is waiting on a lock, so the test doesn't depend on timing.
    for (let i = 0; i < 100; i++) {
      const [waiting] = await db.sql<{ n: number }[]>`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`
      if ((waiting?.n ?? 0) > 0) break
      await new Promise((r) => setTimeout(r, 20))
    }
    commit()
    await deleting
    expect((await counting).code).toBe('NOT_FOUND')
    expect(await db.sql`select 1 from stock_level where warehouse_id = ${spare}`).toHaveLength(0)
  })

  it('holds the limit when two locations are made at the same moment', async () => {
    const [{ n } = { n: 0 }] = await db.sql<{ n: number }[]>`select count(*)::int as n from warehouse where store_id = ${t.storeA1} and seller_id = ${t.sellerA1Second} and deleted_at is null`
    await db.sql`insert into warehouse (store_id, seller_id, name) select ${t.storeA1}, ${t.sellerA1Second}, 'Racer ' || g from generate_series(1, ${19 - n}) g`
    let commit = () => {}
    const held = new Promise<void>((resolve) => (commit = resolve))
    const other = db.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`warehouse:${t.storeA1}:${t.sellerA1Second}`}))`
      await tx`insert into warehouse (store_id, seller_id, name) values (${t.storeA1}, ${t.sellerA1Second}, 'Racer 20')`
      await held
    })
    await new Promise((r) => setTimeout(r, 100))
    const mine = saveWarehouse('otherSupplier', { name: 'Racer 21' })
    await new Promise((r) => setTimeout(r, 200))
    commit()
    await other
    expect((await mine).code).toBe('TOO_MANY_WAREHOUSES')
    await db.sql`delete from warehouse where name like 'Racer %'`
  })

  it('stops at 20 an owner, counted per owner', async () => {
    const [{ n } = { n: 0 }] = await db.sql<{ n: number }[]>`select count(*)::int as n from warehouse where store_id = ${t.storeA1} and seller_id = ${t.sellerA1Second} and deleted_at is null`
    await db.sql`insert into warehouse (store_id, seller_id, name) select ${t.storeA1}, ${t.sellerA1Second}, 'Filler ' || g from generate_series(1, ${20 - n}) g`
    expect((await saveWarehouse('otherSupplier', { name: 'One more' })).code).toBe('TOO_MANY_WAREHOUSES')
    expect((await saveWarehouse('supplier', { name: 'Anand second' })).code).toBeUndefined()
    await db.sql`delete from warehouse where name like 'Filler %'`
  })
})

describe('Stock and its history', () => {
  it('records the first count as starting stock, then typed numbers and reasons, newest first', async () => {
    const where = await main()
    const { id, versions } = await product('owner', 'Linen shirt', 2)
    const [small = '', large = ''] = versions
    expect((await setStock('owner', [{ versionId: small, warehouseId: where, quantity: 10 }, { versionId: large, warehouseId: where, quantity: 3 }])).set?.map((s) => s.quantity)).toEqual([10, 3])
    await setStock('owner', [{ versionId: small, warehouseId: where, quantity: 12 }, { versionId: large, warehouseId: where, quantity: 3 }])
    expect((await adjust('owner', small, where, 5, 'received')).quantity).toBe(17)
    expect((await adjust('owner', small, where, -2, 'damaged')).quantity).toBe(15)
    expect((await adjust('owner', small, where, -20, 'damaged')).code).toBe('BELOW_ZERO')

    const all = await history('owner', id)
    expect(all?.nodes.map((m) => [m.reason, m.delta, m.resultingQuantity])).toEqual([
      ['damaged', -2, 15],
      ['received', 5, 17],
      ['typed', 2, 12],
      ['starting', 3, 3],
      ['starting', 10, 10],
    ])
    expect(all?.nodes[0]).toMatchObject({ actorKind: 'person', actorName: 'Olivia', warehouseName: 'Main location' })
    expect((await history('owner', id, large))?.nodes.map((m) => m.reason)).toEqual(['starting'])
    const page = await history('owner', id, undefined, 2)
    expect(page?.pageInfo.hasNextPage).toBe(true)
    expect((await history('owner', id, undefined, 2, page?.pageInfo.endCursor ?? undefined))?.nodes.map((m) => m.reason)).toEqual(['typed', 'starting'])
    const first = await stockPage('owner', id, 1)
    expect(first?.nodes.map((v) => v.versionId)).toEqual([small])
    expect(first?.pageInfo.hasNextPage).toBe(true)
    expect((await stockPage('owner', id, 1, first?.pageInfo.endCursor ?? undefined))?.nodes.map((v) => v.versionId)).toEqual([large])
    expect(await levels('owner', id)).toMatchObject([
      { versionId: small, onHand: 15, reserved: 0, lowStockThreshold: 5 },
      { versionId: large, onHand: 3, reserved: 0 },
    ])
    const activity = await db.sql<{ action: string }[]>`select action from activity_log where store_id = ${t.storeA1} and action = 'stock.adjusted'`
    expect(activity.length).toBeGreaterThanOrEqual(5)
  })

  it('refuses unknown reasons, a zero change, repeats in one save and a Staff change', async () => {
    const where = await main()
    const { versions } = await product('owner', 'Cap')
    const v = versions[0] ?? ''
    expect((await adjust('owner', v, where, 3, 'stolen')).code).toBe('INVALID_INPUT')
    expect((await adjust('owner', v, where, 0, 'received')).code).toBe('INVALID_INPUT')
    expect((await adjust('owner', v, where, 3, 'typed')).code).toBe('INVALID_INPUT')
    expect((await setStock('owner', [{ versionId: v, warehouseId: where, quantity: -1 }])).code).toBe('INVALID_INPUT')
    expect((await setStock('owner', [{ versionId: v, warehouseId: where, quantity: 1 }, { versionId: v.toUpperCase(), warehouseId: where, quantity: 2 }])).code).toBe('INVALID_INPUT')
    expect((await setStock('owner', [])).code).toBe('INVALID_INPUT')
    expect((await adjust('staff', v, where, 1, 'received')).code).toBe('FORBIDDEN')
    expect((await adjust('manager', v, where, 1, 'received')).quantity).toBe(1)
  })

  it('keeps each owner to its own counts', async () => {
    const where = await main()
    const godown = (await places('supplier')).find((w) => w.isDefault)?.id ?? ''
    const theirs = await product('supplier', 'Anand kurta')
    const mine = await product('owner', 'Store kurta')
    const tv = theirs.versions[0] ?? ''
    const mv = mine.versions[0] ?? ''
    expect((await setStock('supplier', [{ versionId: tv, warehouseId: godown, quantity: 7 }])).code).toBeUndefined()
    // Neither side counts in the other's location, nor a version it doesn't own there.
    expect((await adjust('supplier', tv, where, 1, 'received')).code).toBe('NOT_FOUND')
    expect((await adjust('supplier', mv, godown, 1, 'received')).code).toBe('NOT_FOUND')
    expect((await adjust('owner', tv, godown, 1, 'received')).code).toBe('NOT_FOUND')
    expect((await adjust('owner', tv, where, 1, 'received')).code).toBe('NOT_FOUND')
    expect((await adjust('otherSupplier', tv, godown, 1, 'received')).code).toBe('NOT_FOUND')

    expect((await levels('supplier', theirs.id)).map((l) => l.onHand)).toEqual([7])
    expect(await levels('otherSupplier', theirs.id)).toEqual([])
    expect(await levels('supplier', mine.id)).toEqual([])
    expect((await levels('owner', theirs.id)).map((l) => l.onHand)).toEqual([7])
    expect((await history('supplier', theirs.id))?.nodes).toMatchObject([{ reason: 'starting', actorName: 'Anand' }])
    expect((await history('otherSupplier', theirs.id))?.nodes).toEqual([])
    expect((await history('bOwner', theirs.id))?.nodes).toEqual([])
  })

  it('forgets a deleted location’s threshold and units in the chip and the list', async () => {
    const where = await main()
    const spare = (await saveWarehouse('owner', { name: 'Old shed' })).id ?? ''
    const lamp = await product('owner', 'Shed lamp')
    const v = lamp.versions[0] ?? ''
    await setStock('owner', [{ versionId: v, warehouseId: where, quantity: 10 }, { versionId: v, warehouseId: spare, quantity: 0 }])
    await gql('mutation T($v: ID!, $w: ID!, $n: Int) { setLowStockThreshold(versionId: $v, warehouseId: $w, threshold: $n) }', 'owner', { v, w: spare, n: 50 })
    const isLow = async () => ((await gql('{ products(filter: "low_stock", first: 50) { nodes { id } } }', 'owner')).data?.['products'] as { nodes: { id: string }[] }).nodes.some((p) => p.id === lamp.id)
    expect(await isLow()).toBe(true)
    expect(await deleteWarehouse('owner', spare)).toBeUndefined()
    // 10 left in the default location is above its threshold of 5; the deleted shed's 50 no longer counts.
    expect(await isLow()).toBe(false)
  })

  it('counts low stock in what the caller reads, at the threshold a location sets', async () => {
    const where = await main()
    const low = await product('owner', 'Low lamp')
    const v = low.versions[0] ?? ''
    await setStock('owner', [{ versionId: v, warehouseId: where, quantity: 3 }])
    const chip = async (who: Who) => (await gql('{ productCounts { lowStock } products(filter: "low_stock", first: 50) { nodes { id stock } } }', who)).data as { productCounts: { lowStock: number }; products: { nodes: { id: string; stock: number }[] } }
    const before = await chip('owner')
    expect(before.products.nodes.find((p) => p.id === low.id)?.stock).toBe(3)
    expect((await gql('mutation T($v: ID!, $w: ID!, $n: Int) { setLowStockThreshold(versionId: $v, warehouseId: $w, threshold: $n) }', 'owner', { v, w: where, n: 2 })).data?.['setLowStockThreshold']).toBe(2)
    const after = await chip('owner')
    expect(after.products.nodes.some((p) => p.id === low.id)).toBe(false)
    expect(after.productCounts.lowStock).toBe(before.productCounts.lowStock - 1)
    expect((await gql('mutation T($v: ID!, $w: ID!, $n: Int) { setLowStockThreshold(versionId: $v, warehouseId: $w, threshold: $n) }', 'supplier', { v, w: where, n: 9 })).code).toBe('NOT_FOUND')
    // The merchant side never sets a supplier's threshold, which drives that supplier's chip.
    const godown = (await places('supplier')).find((w) => w.isDefault)?.id ?? ''
    const theirs = await product('supplier', 'Anand lamp')
    await setStock('supplier', [{ versionId: theirs.versions[0] ?? '', warehouseId: godown, quantity: 9 }])
    expect((await gql('mutation T($v: ID!, $w: ID!, $n: Int) { setLowStockThreshold(versionId: $v, warehouseId: $w, threshold: $n) }', 'owner', { v: theirs.versions[0], w: godown, n: 0 })).code).toBe('NOT_FOUND')
    expect((await gql('mutation T($v: ID!, $w: ID!, $n: Int) { setLowStockThreshold(versionId: $v, warehouseId: $w, threshold: $n) }', 'supplier', { v: theirs.versions[0], w: godown, n: 10 })).data?.['setLowStockThreshold']).toBe(10)
    // A supplier's chip counts only its own products.
    expect((await chip('supplier')).products.nodes.every((p) => p.id !== low.id)).toBe(true)
  })
})
