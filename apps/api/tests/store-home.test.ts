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

// Card #322 (SAPI 18), part 1: Home (FIRST-RELEASE §5, §20), each figure for the seat asking, withheld on the server:
// Staff get no money or returning customers, a Manager no Owner-only item, a supplier no Home (ACCESS §5.1, §11).

let db: TestDatabase
let t: Tenants
type Who = 'owner' | 'manager' | 'staff' | 'supplier' | 'other' | 'fresh'
const cookies = {} as Record<Who, string>
const ids = { cod: '', cardPending: '', testOrder: '', boundary: '', y2: '' }
// 11:30 in Kolkata on 10 October: "today" began at 18:30 UTC on the 9th.
const now = new Date('2026-10-10T06:00:00Z')

const order = async (storeId: string, number: string, placedAt: string, o: { total: number; refunded?: number; method?: string; paid?: boolean; state?: 'placed' | 'cancelled'; fulfilment?: string; currency?: string; customerId?: string | null; email?: string | null; test?: boolean }) => {
  const paid = o.paid ?? true
  const [row] = await db.sql<{ id: string }[]>`
    insert into "order" (store_id, state, payment_state, fulfilment_state, currency, customer_id, email, shipping_address, number, placed_at, subtotal_amount, shipping_amount, tax_amount,
      total_amount, refunded_amount, payment_method, cancelled_at, cancel_reason)
    values (${storeId}, ${o.state ?? 'placed'}, ${paid ? (o.refunded ? 'partly_refunded' : 'paid') : 'pending'}, ${o.fulfilment ?? 'unfulfilled'}, ${o.currency ?? 'INR'}, ${o.customerId ?? null},
      ${o.email ?? null}, ${db.sql.json({ name: `Buyer ${number}`, line1: '1 Road', city: 'Pune', country: 'IN' })}, ${number}, ${placedAt}, ${o.total}, 0, 0, ${o.total}, ${o.refunded ?? 0},
      ${o.method ?? 'stripe'}, ${o.state === 'cancelled' ? placedAt : null}, ${o.state === 'cancelled' ? 'store' : null})
    returning id`
  const id = row?.id ?? ''
  await db.sql`insert into order_line (order_id, store_id, version_id, product_id, name, quantity, unit_amount, line_total_amount)
    select ${id}, ${storeId}, v.id, v.product_id, 'Kurta', 2, ${Math.floor(o.total / 2)}, ${o.total} from product_version v where v.store_id = ${storeId} order by v.position limit 1`
  if (o.test) await db.sql`insert into payment (order_id, store_id, provider, kind, state, amount, currency, mode) values (${id}, ${storeId}, 'stripe', 'card', 'captured', ${o.total}, 'INR', 'test')`
  return id
}

const gql = async (source: string, who: Who, as: { support?: 'read' } = {}) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers: Record<string, string> = {
    cookie: `${storeCookieName}=${cookies[who]}`,
    [storeHeader]: who === 'other' ? t.storeA2 : who === 'fresh' ? t.storeB1 : t.storeA1,
    ...(who === 'supplier' ? { [supplierHeader]: t.sellerA1First } : {}),
  }
  const partnerId = who === 'fresh' ? t.partnerB : t.partnerA
  const resolved = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, new Date(), activityLog, facts)
  const standing = as.support && resolved.kind === 'acting'
    ? { ...resolved, caller: { ...resolved.caller, context: { ...resolved.caller.context, caller: { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: as.support } } } }
    : resolved
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: activityLog, facts, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

const fields = `timeZone hasOrders toShip partlyShipped oldestToShipAt paymentsToCollect { count firstOrderId } awaitingApproval lowStock { count names } rejectedCouriers
  ordersToday ordersYesterday sales { yesterday { amount currency } dayBefore { amount } averageWeek { amount } } returningCustomers
  latestOrders { number items total { amount currency } } setup { products collections payments shipping }`
const home = async (who: Who, as: { support?: 'read' } = {}) => (await gql(`{ home { ${fields} } }`, who, as)).data?.['home'] as Record<string, unknown> | null

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set time_zone = 'Asia/Kolkata', pricing_currency = 'INR' where id in (${t.storeA1}, ${t.storeA2}, ${t.storeB1})`
  await db.sql`update seller set access_level = 'vendor-orders-fulfil' where id = ${t.sellerA1First}`

  const person = async (email: string, storeId: string, role: string, partnerId = t.partnerA, seller: string | null = null) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${email.split('@')[0] ?? ''}, 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${u?.id ?? ''}, ${storeId}, ${seller}, ${role}, 'active')`
    return withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId }, new Date()))
  }
  cookies.owner = await person('owner@a1.example', t.storeA1, 'owner')
  cookies.manager = await person('manager@a1.example', t.storeA1, 'manager')
  cookies.staff = await person('staff@a1.example', t.storeA1, 'staff')
  cookies.supplier = await person('anand@a1.example', t.storeA1, 'supplier-admin', t.partnerA, t.sellerA1First)
  cookies.other = await person('owner@a2.example', t.storeA2, 'owner')
  cookies.fresh = await person('owner@b1.example', t.storeB1, 'owner', t.partnerB)

  // Stock: the store's own Kurta is low (2 left), its Saree isn't, and a supplier's Scarf is low and waiting for approval.
  const product = async (storeId: string, name: string, onHand: number, seller: string | null = null) => {
    const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, seller_id, name, slug, visibility, approval_status) values (${storeId}, ${seller}, ${name}, ${name.toLowerCase()}, 'visible', ${seller ? 'pending' : null}) returning id`
    const [v] = await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position) values (${storeId}, ${p?.id ?? ''}, ${name}, 0) returning id`
    const warehouse = seller
      ? (await db.sql<{ id: string }[]>`insert into warehouse (store_id, seller_id, name, is_default) values (${storeId}, ${seller}, 'Their place', true) returning id`)[0]?.id
      : (await db.sql<{ id: string }[]>`select id from warehouse where store_id = ${storeId} and is_default and seller_id is null`)[0]?.id
    await db.sql`insert into stock_level (version_id, warehouse_id, store_id, on_hand) values (${v?.id ?? ''}, ${warehouse ?? ''}, ${storeId}, ${onHand})`
  }
  await product(t.storeA1, 'Kurta', 2)
  await product(t.storeA1, 'Saree', 50)
  await product(t.storeA1, 'Scarf', 1, t.sellerA1First)
  await product(t.storeA2, 'Dhoti', 0)
  await db.sql`update store set vendor_products_require_approval = true where id = ${t.storeA1}`
  await db.sql`insert into store_courier (store_id, provider, role, label_size, last_test_result) values (${t.storeA1}, 'shiprocket', 'pricing', 'a6', 'rejected')`

  // Yesterday in Kolkata is 18:30 on the 8th to 18:30 on the 9th (UTC); the day before, the 24 hours before that.
  await order(t.storeA1, 'A-1', '2026-10-09T10:00:00Z', { total: 10000, refunded: 2000, customerId: t.customerA1, email: 'priya@example.com' })
  ids.y2 = await order(t.storeA1, 'A-2', '2026-10-09T18:00:00Z', { total: 5000, email: 'ravi@example.com' })
  ids.boundary = await order(t.storeA1, 'A-3', '2026-10-09T18:45:00Z', { total: 3000, fulfilment: 'partly_fulfilled', customerId: t.customerA1, email: 'priya@example.com' })
  ids.cod = await order(t.storeA1, 'A-4', '2026-10-10T02:00:00Z', { total: 4000, method: 'cod', paid: false, email: 'cod@example.com' })
  ids.cardPending = await order(t.storeA1, 'A-5', '2026-10-10T04:00:00Z', { total: 6000, paid: false, email: 'card@example.com' })
  ids.testOrder = await order(t.storeA1, 'A-6', '2026-10-10T03:00:00Z', { total: 7000, test: true, email: 'priya@example.com' })
  await order(t.storeA1, 'A-7', '2026-10-08T10:00:00Z', { total: 4000, fulfilment: 'fulfilled', email: 'Ravi@Example.com' })
  await order(t.storeA1, 'A-8', '2026-10-09T09:00:00Z', { total: 9000, state: 'cancelled', email: 'gone@example.com' })
  await order(t.storeA1, 'A-9', '2026-10-09T12:00:00Z', { total: 1500, currency: 'USD', email: 'usd@example.com' })
  await order(t.storeA1, 'A-10', '2026-09-30T10:00:00Z', { total: 9999, fulfilment: 'fulfilled', email: 'old@example.com' })
  await order(t.storeA2, 'B-1', '2026-10-09T10:00:00Z', { total: 77777, customerId: t.customerA2, email: 'priya@example.com' })
  await order(t.storeA2, 'B-2', '2026-10-09T11:00:00Z', { total: 1000, customerId: t.customerA2, email: 'priya@example.com' })
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const owner = {
  timeZone: 'Asia/Kolkata',
  hasOrders: true,
  // A-1, A-2, A-3, the cash order A-4 and A-9: never the card still being paid, the test or the cancelled one.
  toShip: 5,
  partlyShipped: 1,
  oldestToShipAt: '2026-10-09T10:00:00.000Z',
  ordersToday: 2,
  ordersYesterday: 3,
  returningCustomers: 2,
  latestOrders: [
    { number: 'A-5', items: 2, total: { amount: '6000', currency: 'INR' } },
    { number: 'A-6', items: 2, total: { amount: '7000', currency: 'INR' } },
    { number: 'A-4', items: 2, total: { amount: '4000', currency: 'INR' } },
    { number: 'A-3', items: 2, total: { amount: '3000', currency: 'INR' } },
    { number: 'A-2', items: 2, total: { amount: '5000', currency: 'INR' } },
  ],
  setup: null,
}

describe('Home for each seat', () => {
  it('gives the Owner every figure in the store’s own days: sales net of refunds a currency, the pricing one first', async () => {
    expect(await home('owner')).toEqual({
      ...owner,
      paymentsToCollect: { count: 1, firstOrderId: ids.cod },
      awaitingApproval: 1,
      // The supplier's Scarf counts on the merchant side, as the Low stock chip does.
      lowStock: { count: 2, names: ['Kurta', 'Scarf'] },
      rejectedCouriers: ['shiprocket'],
      sales: [
        // Yesterday A-1 (10,000 less 2,000) and A-2; the day before A-7; the week's four sales average 5,000.
        { yesterday: { amount: '13000', currency: 'INR' }, dayBefore: { amount: '4000' }, averageWeek: { amount: '5000' } },
        { yesterday: { amount: '1500', currency: 'USD' }, dayBefore: { amount: '0' }, averageWeek: { amount: '1500' } },
      ],
    })
  })

  it('gives a Manager the money and payments to collect, never the approval queue or the couriers', async () => {
    const seen = await home('manager')
    expect(seen).toMatchObject({ ...owner, paymentsToCollect: { count: 1, firstOrderId: ids.cod }, lowStock: { count: 2 } })
    expect([seen?.['awaitingApproval'], seen?.['rejectedCouriers']]).toEqual([null, null])
    expect(seen?.['sales']).toHaveLength(2)
  })

  it('gives Staff the work and the counts, never money, an order’s total or returning customers', async () => {
    expect(await home('staff')).toEqual({
      ...owner,
      returningCustomers: null,
      sales: null,
      paymentsToCollect: null,
      awaitingApproval: null,
      rejectedCouriers: null,
      lowStock: { count: 2, names: ['Kurta', 'Scarf'] },
      latestOrders: owner.latestOrders.map((o) => ({ ...o, total: null })),
    })
  })

  it('shows a new store its checklist, each item only to a seat that can do it', async () => {
    expect(await home('fresh')).toMatchObject({ hasOrders: false, toShip: 0, ordersToday: 0, sales: [], returningCustomers: 0, latestOrders: [], setup: { products: false, collections: false, payments: false, shipping: false } })
    await db.sql`insert into store_shipping (store_id, currency, saved_at) values (${t.storeB1}, 'INR', now())`
    expect((await home('fresh'))?.['setup']).toEqual({ products: false, collections: false, payments: false, shipping: true })
  })
})

describe('across stores and callers (ACCESS §11)', () => {
  it('counts nothing of another store: its orders, stock, customers and work are its own', async () => {
    expect(await home('other')).toMatchObject({
      toShip: 2,
      ordersToday: 0,
      ordersYesterday: 2,
      returningCustomers: 1,
      awaitingApproval: null,
      lowStock: { count: 1, names: ['Dhoti'] },
      rejectedCouriers: [],
      sales: [{ yesterday: { amount: '78777', currency: 'INR' }, dayBefore: { amount: '0' }, averageWeek: { amount: '39389' } }],
      latestOrders: [{ number: 'B-2', items: 2, total: { amount: '1000', currency: 'INR' } }, { number: 'B-1', items: 2, total: { amount: '77777', currency: 'INR' } }],
    })
  })

  it('refuses Home to a supplier, whatever its tier', async () => {
    expect((await gql('{ home { toShip } }', 'supplier')).code).toBe('FORBIDDEN')
    await db.sql`update seller set access_level = 'vendor-stock' where id = ${t.sellerA1First}`
    try {
      expect((await gql('{ home { toShip } }', 'supplier')).code).toBe('FORBIDDEN')
    } finally {
      await db.sql`update seller set access_level = 'vendor-orders-fulfil' where id = ${t.sellerA1First}`
    }
  })

  it('answers a read-only support session as the seat it views, and a past-due store as always', async () => {
    expect(await home('owner', { support: 'read' })).toMatchObject({ toShip: 5, awaitingApproval: 1 })
    await db.sql`update store set status = 'past_due' where id = ${t.storeA1}`
    try {
      expect((await home('staff'))?.['toShip']).toBe(5)
    } finally {
      await db.sql`update store set status = 'active' where id = ${t.storeA1}`
    }
  })
})
