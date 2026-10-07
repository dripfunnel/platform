import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #310 (SAPI 11), part 1: the Orders list, its chips and an order's detail on the merchant side, and a supplier's own
// part of them (FIRST-RELEASE §6; ACCESS §7.3; DATA-MODEL §7.11), with the team's notes in the history.

let db: TestDatabase
let t: Tenants
type Who = 'owner' | 'staff' | 'other' | 'drop' | 'hub' | 'stockOnly'
const cookies = {} as Record<Who, string>
const orders = { cod: '', unpaidCard: '', test: '', cancelled: '', partly: '', elsewhere: '', cart: '' }
let stockOnlySeller = ''

const address = { name: 'Priya Shah', line1: '12 MG Road', line2: null, city: 'Pune', region: 'Maharashtra', postalCode: '411001', country: 'IN', phone: '+919800000001' }

/** A placed order in one statement set: lines per owner (null is the merchant's), a part per owner, and its payment. */
const order = async (storeId: string, number: string, placedAt: string, o: {
  lines: { seller: string | null; name: string; quantity: number; unit: number }[]
  method: string
  paymentState?: string
  state?: 'placed' | 'cancelled'
  fulfilment?: string
  mode?: 'test' | 'live'
}) => {
  const subtotal = o.lines.reduce((sum, l) => sum + l.unit * l.quantity, 0)
  const [row] = await db.sql<{ id: string }[]>`
    insert into "order" (store_id, state, payment_state, fulfilment_state, currency, email, phone, shipping_address, billing_address, number, placed_at,
      subtotal_amount, shipping_amount, tax_amount, total_amount, payment_method, cancelled_at, cancel_reason)
    values (${storeId}, ${o.state ?? 'placed'}, ${o.paymentState ?? 'pending'}, ${o.fulfilment ?? 'unfulfilled'}, 'INR', 'priya@example.com', '+919800000001',
      ${db.sql.json(address)}, ${db.sql.json(address)}, ${number}, ${placedAt}, ${subtotal}, 5000, 900, ${subtotal + 5900}, ${o.method},
      ${o.state === 'cancelled' ? placedAt : null}, ${o.state === 'cancelled' ? 'store' : null})
    returning id`
  const id = row?.id ?? ''
  const versions = await db.sql<{ id: string; product_id: string }[]>`select id, product_id from product_version where store_id = ${storeId} order by position limit 1`
  for (const [position, l] of o.lines.entries()) {
    await db.sql`insert into order_line (order_id, store_id, seller_id, version_id, product_id, name, quantity, unit_amount, discount_amount, tax_amount, line_total_amount, position)
      values (${id}, ${storeId}, ${l.seller}, ${versions[0]?.id ?? ''}, ${versions[0]?.product_id ?? ''}, ${l.name}, ${l.quantity}, ${l.unit}, 100, 50, ${l.unit * l.quantity - 50}, ${position})`
  }
  for (const seller of new Set(o.lines.map((l) => l.seller))) {
    const mode = seller ? ((await db.sql<{ shipping_mode: string }[]>`select shipping_mode from seller where id = ${seller}`)[0]?.shipping_mode ?? 'to-store') : 'store'
    await db.sql`insert into order_part (order_id, store_id, seller_id, shipping_mode) values (${id}, ${storeId}, ${seller}, ${mode})`
  }
  await db.sql`insert into payment (order_id, store_id, provider, kind, state, amount, currency, mode)
    values (${id}, ${storeId}, ${o.method}, ${o.method === 'cod' ? 'cod' : 'card'}, ${o.paymentState === 'paid' ? 'captured' : 'pending'}, ${subtotal + 5900}, 'INR', ${o.mode ?? 'live'})`
  return id
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update seller set shipping_mode = 'to-shopper', access_level = 'vendor-orders-fulfil' where id = ${t.sellerA1First}`
  await db.sql`update seller set shipping_mode = 'to-store', access_level = 'vendor-orders-fulfil' where id = ${t.sellerA1Second}`
  stockOnlySeller = (await db.sql<{ id: string }[]>`insert into seller (store_id, name, access_level, status) values (${t.storeA1}, 'Chawla Crafts', 'vendor-stock', 'active') returning id`)[0]?.id ?? ''
  for (const storeId of [t.storeA1, t.storeA2]) {
    const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${storeId}, 'Kurta', 'kurta', 'visible') returning id`
    await db.sql`insert into product_version (store_id, product_id, sku, position) values (${storeId}, ${p?.id ?? ''}, 'K1', 0)`
  }

  const person = async (email: string, storeId: string, role: string, seller: string | null = null) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, ${email.split('@')[0] ?? ''}, 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${u?.id ?? ''}, ${storeId}, ${seller}, ${role}, 'active')`
    return withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
  }
  cookies.owner = await person('owner@a1.example', t.storeA1, 'owner')
  cookies.staff = await person('staff@a1.example', t.storeA1, 'staff')
  cookies.other = await person('owner@a2.example', t.storeA2, 'owner')
  cookies.drop = await person('anand@a1.example', t.storeA1, 'supplier-admin', t.sellerA1First)
  cookies.hub = await person('bhatia@a1.example', t.storeA1, 'supplier-member', t.sellerA1Second)
  cookies.stockOnly = await person('chawla@a1.example', t.storeA1, 'supplier-admin', stockOnlySeller)

  orders.cod = await order(t.storeA1, 'A-1001', '2026-10-01T10:00:00Z', {
    method: 'cod',
    lines: [
      { seller: null, name: 'House kurta', quantity: 1, unit: 120000 },
      { seller: t.sellerA1First, name: 'Anand scarf', quantity: 2, unit: 45000 },
      { seller: t.sellerA1Second, name: 'Bhatia stole', quantity: 1, unit: 30000 },
    ],
  })
  orders.unpaidCard = await order(t.storeA1, 'A-1002', '2026-10-02T10:00:00Z', { method: 'stripe', lines: [{ seller: t.sellerA1First, name: 'Anand scarf', quantity: 1, unit: 45000 }] })
  orders.test = await order(t.storeA1, 'A-1003', '2026-10-03T10:00:00Z', { method: 'stripe', paymentState: 'paid', mode: 'test', lines: [{ seller: t.sellerA1First, name: 'Anand scarf', quantity: 1, unit: 45000 }] })
  orders.cancelled = await order(t.storeA1, 'A-1004', '2026-10-04T10:00:00Z', { method: 'cod', state: 'cancelled', lines: [{ seller: null, name: 'House kurta', quantity: 1, unit: 120000 }] })
  orders.partly = await order(t.storeA1, 'A-1005', '2026-10-05T10:00:00Z', { method: 'razorpay', paymentState: 'paid', fulfilment: 'partly_fulfilled', lines: [{ seller: null, name: 'House kurta', quantity: 2, unit: 120000 }] })
  orders.elsewhere = await order(t.storeA2, 'B-1', '2026-10-06T10:00:00Z', { method: 'cod', lines: [{ seller: null, name: 'Their kurta', quantity: 1, unit: 99000 }] })
  orders.cart = (await db.sql<{ id: string }[]>`insert into "order" (store_id, currency, access_token_hash) values (${t.storeA1}, 'INR', ${'0'.repeat(64)}) returning id`)[0]?.id ?? ''
  await db.sql`update order_part set state = 'partly_shipped' where order_id = ${orders.partly}`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const sellerOf: Partial<Record<Who, () => string>> = { drop: () => t.sellerA1First, hub: () => t.sellerA1Second, stockOnly: () => stockOnlySeller }

const gql = async (source: string, who: Who, as: { support?: 'read' } = {}) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const seller = sellerOf[who]?.()
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: who === 'other' ? t.storeA2 : t.storeA1, ...(seller ? { [supplierHeader]: seller } : {}) }
  const resolved = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  const standing = as.support && resolved.kind === 'acting'
    ? { ...resolved, caller: { ...resolved.caller, context: { ...resolved.caller.context, caller: { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: as.support } } } }
    : resolved
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now: () => new Date() }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const numbers = async (who: Who, args = '') => ((await gql(`{ orders${args} { nodes { number } } }`, who)).data?.['orders'] as { nodes: { number: string }[] } | undefined)?.nodes.map((n) => n.number)
const asSupplier = (sellerId: string): TenantContext => ({ caller: { kind: 'person', userId: crypto.randomUUID(), sessionId: crypto.randomUUID() }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'seller', sellerId }, subscription: 'active' })

describe('the merchant side’s Orders', () => {
  it('lists the store’s placed orders newest first: never a cart, never another store’s', async () => {
    expect(await numbers('owner')).toEqual(['A-1005', 'A-1004', 'A-1003', 'A-1002', 'A-1001'])
    expect(await numbers('staff')).toEqual(['A-1005', 'A-1004', 'A-1003', 'A-1002', 'A-1001'])
    expect(await numbers('other')).toEqual(['B-1'])
  })

  it('filters by each chip and counts them, a test order and an unpaid card never to ship', async () => {
    expect(await numbers('owner', '(filter: TO_SHIP)')).toEqual(['A-1005', 'A-1001'])
    expect(await numbers('owner', '(filter: PARTLY_SHIPPED)')).toEqual(['A-1005'])
    expect(await numbers('owner', '(filter: SHIPPED)')).toEqual([])
    expect(await numbers('owner', '(filter: CANCELLED_REFUNDED)')).toEqual(['A-1004'])
    expect(await numbers('owner', '(filter: PAYMENT_PENDING)')).toEqual(['A-1002', 'A-1001'])
    expect((await gql('{ orderCounts { all toShip partlyShipped shipped cancelledRefunded paymentPending } }', 'owner')).data?.['orderCounts']).toEqual({
      all: 5, toShip: 2, partlyShipped: 1, shipped: 0, cancelledRefunded: 1, paymentPending: 2,
    })
    expect((await gql('{ navBadges { toShip } }', 'owner')).data?.['navBadges']).toEqual({ toShip: 2 })
  })

  it('searches by number or the shopper’s name, and pages by cursor', async () => {
    expect(await numbers('owner', '(search: "1003")')).toEqual(['A-1003'])
    expect(await numbers('owner', '(search: "priya")')).toHaveLength(5)
    expect(await numbers('owner', '(search: "%")')).toEqual([])
    const first = (await gql('{ orders(first: 2) { nodes { number } pageInfo { endCursor hasNextPage } } }', 'owner')).data?.['orders'] as { pageInfo: { endCursor: string; hasNextPage: boolean } }
    expect(first.pageInfo.hasNextPage).toBe(true)
    expect(await numbers('owner', `(first: 2, after: "${first.pageInfo.endCursor}")`)).toEqual(['A-1003', 'A-1002'])
    expect((await gql('{ orders(after: "nonsense") { nodes { id } } }', 'owner')).code).toBe('INVALID_CURSOR')
  })

  it('answers a row with its total, payment, items and the shopper’s name and city, and flags a test order', async () => {
    const rows = ((await gql('{ orders { nodes { number total { amount currency } paymentState paymentMethod items customerName city test partState } } }', 'owner')).data?.['orders'] as { nodes: Record<string, unknown>[] }).nodes
    expect(rows.find((r) => r['number'] === 'A-1001')).toEqual({ number: 'A-1001', total: { amount: '245900', currency: 'INR' }, paymentState: 'pending', paymentMethod: 'cod', items: 4, customerName: 'Priya Shah', city: 'Pune', test: false, partState: null })
    expect(rows.find((r) => r['number'] === 'A-1003')?.['test']).toBe(true)
  })

  it('shows an order’s detail: its parts by who packs them, money, payment and the shopper', async () => {
    const detail = (await gql(`{ order(id: "${orders.cod}") { number email phone total { amount } shipping { amount } paymentMethod billingAddress { city }
      parts { supplierName shippingMode state lines { name quantity unitPrice { amount } amount { amount } tax { amount } total { amount } } }
      payments { provider state mode amount { amount } } } }`, 'staff')).data?.['order']
    expect(detail).toEqual({
      number: 'A-1001', email: 'priya@example.com', phone: '+919800000001', total: { amount: '245900' }, shipping: { amount: '5000' }, paymentMethod: 'cod', billingAddress: { city: 'Pune' },
      parts: [
        { supplierName: null, shippingMode: 'store', state: 'to_ship', lines: [{ name: 'House kurta', quantity: 1, unitPrice: { amount: '120000' }, amount: { amount: '120000' }, tax: { amount: '50' }, total: { amount: '119950' } }] },
        { supplierName: 'Anand Textiles', shippingMode: 'to-shopper', state: 'to_ship', lines: [{ name: 'Anand scarf', quantity: 2, unitPrice: { amount: '45000' }, amount: { amount: '90000' }, tax: { amount: '50' }, total: { amount: '89950' } }] },
        { supplierName: 'Bhatia Threads', shippingMode: 'to-store', state: 'to_ship', lines: [{ name: 'Bhatia stole', quantity: 1, unitPrice: { amount: '30000' }, amount: { amount: '30000' }, tax: { amount: '50' }, total: { amount: '29950' } }] },
      ],
      payments: [{ provider: 'cod', state: 'pending', mode: 'live', amount: { amount: '245900' } }],
    })
    expect((await gql(`{ order(id: "${orders.elsewhere}") { id } }`, 'owner')).data?.['order']).toBeNull()
    expect((await gql(`{ order(id: "${orders.cart}") { id } }`, 'owner')).data?.['order']).toBeNull()
    expect((await gql('{ order(id: "not-an-id") { id } }', 'owner')).data?.['order']).toBeNull()
  })
})

describe('team notes', () => {
  it('adds a note any merchant seat may, into the history with who wrote it', async () => {
    expect((await gql(`mutation { addOrderNote(orderId: "${orders.cod}", note: "  Gift wrap — shopper called  ") }`, 'staff')).data?.['addOrderNote']).toBe(true)
    const history = ((await gql(`{ order(id: "${orders.cod}") { history { action actorKind actorName note } } }`, 'owner')).data?.['order'] as { history: unknown[] }).history
    expect(history[0]).toEqual({ action: 'order.note_added', actorKind: 'person', actorName: 'staff', note: 'Gift wrap — shopper called' })
  })

  it('refuses an empty or overlong note, another store’s order, a supplier and a read-only support session', async () => {
    expect((await gql(`mutation { addOrderNote(orderId: "${orders.cod}", note: "   ") }`, 'owner')).code).toBe('INVALID_INPUT')
    expect((await gql(`mutation { addOrderNote(orderId: "${orders.cod}", note: "${'x'.repeat(1001)}") }`, 'owner')).code).toBe('INVALID_INPUT')
    expect((await gql(`mutation { addOrderNote(orderId: "${orders.elsewhere}", note: "Hi") }`, 'owner')).code).toBe('NOT_FOUND')
    expect((await gql(`mutation { addOrderNote(orderId: "${orders.cart}", note: "Hi") }`, 'owner')).code).toBe('NOT_FOUND')
    expect((await gql(`mutation { addOrderNote(orderId: "${orders.cod}", note: "Hi") }`, 'drop')).code).toBe('FORBIDDEN')
    expect((await gql(`mutation { addOrderNote(orderId: "${orders.cod}", note: "Hi") }`, 'owner', { support: 'read' })).code).toBe('READ_ONLY')
    const notes = await db.sql`select 1 from activity_log where action = 'order.note_added' and target_id = ${orders.cod}`
    expect(notes).toHaveLength(1)
  })
})

describe('a supplier’s own part (ACCESS §7.3)', () => {
  it('lists only orders holding its lines that went through on the live storefront, with no money or payment', async () => {
    expect(await numbers('drop')).toEqual(['A-1001'])
    expect(await numbers('hub')).toEqual(['A-1001'])
    const row = ((await gql('{ orders { nodes { number total { amount } paymentState paymentMethod test items partState shippingMode customerName city } } }', 'drop')).data?.['orders'] as { nodes: unknown[] }).nodes[0]
    expect(row).toEqual({ number: 'A-1001', total: null, paymentState: null, paymentMethod: null, test: null, items: 2, partState: 'to_ship', shippingMode: 'to-shopper', customerName: 'Priya Shah', city: 'Pune' })
    expect((await gql('{ orderCounts { all toShip cancelledRefunded paymentPending } }', 'drop')).data?.['orderCounts']).toEqual({ all: 1, toShip: 1, cancelledRefunded: 0, paymentPending: 0 })
    expect((await gql('{ navBadges { toShip } }', 'hub')).data?.['navBadges']).toEqual({ toShip: 1 })
    expect(await numbers('drop', '(filter: CANCELLED_REFUNDED)')).toEqual([])
    expect(await numbers('drop', '(search: "priya")')).toEqual([])
  })

  it('reads its part only: its lines at the price sold, the shopper’s name and address only when it ships to the shopper', async () => {
    const query = `{ order(id: "${orders.cod}") { number customerName shippingAddress { name city } email phone billingAddress { city } total { amount } paymentMethod payments { provider } adjustments { kind }
      parts { supplierName shippingMode lines { name quantity unitPrice { amount } amount { amount currency } discount { amount } tax { amount } total { amount } } } history { action actorName note } } }`
    expect((await gql(query, 'drop')).data?.['order']).toEqual({
      number: 'A-1001', customerName: 'Priya Shah', shippingAddress: { name: 'Priya Shah', city: 'Pune' }, email: null, phone: null, billingAddress: null, total: null, paymentMethod: null, payments: [], adjustments: [],
      parts: [{ supplierName: null, shippingMode: 'to-shopper', lines: [{ name: 'Anand scarf', quantity: 2, unitPrice: { amount: '45000' }, amount: { amount: '90000', currency: 'INR' }, discount: null, tax: null, total: null }] }],
      history: [],
    })
    const hub = (await gql(query, 'hub')).data?.['order'] as Record<string, unknown>
    expect([hub['customerName'], hub['shippingAddress']]).toEqual([null, null])
    expect((hub['parts'] as { lines: { name: string }[] }[]).flatMap((p) => p.lines.map((l) => l.name))).toEqual(['Bhatia stole'])
  })

  it('keeps an order as placed when the supplier’s mode changes afterwards: a to-store part still shows nothing of the shopper', async () => {
    await db.sql`update seller set shipping_mode = 'to-shopper' where id = ${t.sellerA1Second}`
    try {
      const hub = (await gql(`{ order(id: "${orders.cod}") { customerName shippingAddress { name } } }`, 'hub')).data?.['order']
      expect(hub).toEqual({ customerName: null, shippingAddress: null })
    } finally {
      await db.sql`update seller set shipping_mode = 'to-store' where id = ${t.sellerA1Second}`
    }
  })

  it('never reads an order unpaid by card, a test order, another supplier’s only order or another store’s', async () => {
    for (const id of [orders.unpaidCard, orders.test, orders.cancelled, orders.elsewhere]) {
      expect((await gql(`{ order(id: "${id}") { id } }`, 'drop')).data?.['order']).toBeNull()
    }
  })

  it('reads only its own thin entries in the history, never the store’s notes or reasons', async () => {
    await db.sql`insert into activity_log (category, action, result, actor_kind, actor_id, partner_id, store_id, seller_id, target_type, target_id, target_label, reason, api, visibility)
      values ('write', 'refund.issued', 'success', 'person', ${crypto.randomUUID()}, ${t.partnerA}, ${t.storeA1}, ${t.sellerA1First}, 'order', ${orders.cod}, 'A-1001', 'kept', 'store', 'store')`
    const history = ((await gql(`{ order(id: "${orders.cod}") { history { action actorName note } } }`, 'drop')).data?.['order'] as { history: unknown[] }).history
    expect(history).toEqual([{ action: 'refund.issued', actorName: null, note: null }])
    expect(((await gql(`{ order(id: "${orders.cod}") { history { action } } }`, 'hub')).data?.['order'] as { history: unknown[] }).history).toEqual([])
  })

  it('refuses a stock-only supplier every order field, and its badge counts nothing', async () => {
    expect((await gql('{ orders { nodes { id } } }', 'stockOnly')).code).toBe('FORBIDDEN')
    expect((await gql('{ orderCounts { all } }', 'stockOnly')).code).toBe('FORBIDDEN')
    expect((await gql(`{ order(id: "${orders.cod}") { id } }`, 'stockOnly')).code).toBe('FORBIDDEN')
    expect((await gql('{ navBadges { toShip } }', 'stockOnly')).data?.['navBadges']).toEqual({ toShip: 0 })
  })
})

describe('in the database (DATA-MODEL §5.3, §7.11)', () => {
  it('gives a supplier no order, money, adjustment or payment of its own accord, only the two views', async () => {
    for (const query of ['select 1 from "order"', 'select unit_amount from order_line', 'select line_total_amount from order_line', 'select 1 from order_adjustment', 'select 1 from payment']) {
      await expect(withScope(db.sql, asSupplier(t.sellerA1First), (tx) => tx.unsafe(query)), query).rejects.toThrow(/permission denied/)
    }
    const own = await withScope(db.sql, asSupplier(t.sellerA1First), (tx) => tx<{ id: string; seller_id: string }[]>`select id, seller_id from order_line`)
    expect(new Set(own.map((l) => l.seller_id))).toEqual(new Set([t.sellerA1First]))
    const viewed = await withScope(db.sql, asSupplier(t.sellerA1Second), (tx) => tx<{ number: string; customer_name: string | null }[]>`select number, customer_name from order_for_supplier`)
    expect(viewed).toEqual([{ number: 'A-1001', customer_name: null }])
    const money = await withScope(db.sql, asSupplier(t.sellerA1Second), (tx) => tx<{ line_amount: string }[]>`select line_amount::text from order_line_for_supplier`)
    expect(money).toEqual([{ line_amount: '30000' }])
  })

  it('shows the views nothing outside a supplier’s own store scope', async () => {
    const merchant: TenantContext = { ...asSupplier(t.sellerA1First), sellerScope: { kind: 'all' } }
    await expect(withScope(db.sql, merchant, (tx) => tx`select 1 from order_for_supplier`)).rejects.toThrow(/permission denied/)
    const otherStore: TenantContext = { ...asSupplier(t.sellerA1First), storeId: t.storeA2 }
    expect(await withScope(db.sql, otherStore, (tx) => tx`select 1 from order_for_supplier`)).toHaveLength(0)
    expect(await withScope(db.sql, otherStore, (tx) => tx`select 1 from order_line_for_supplier`)).toHaveLength(0)
  })
})
