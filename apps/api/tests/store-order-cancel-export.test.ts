import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { PaymentRefused, PaymentUnavailable, type PaymentGateway } from '#core/payments'
import { selectCatalogExport } from '#db/scoped/catalogExports'
import { withScope, withSystemScope } from '#db/scoped/index'
import { buildOrderExport } from '#engine/modules/orders/index'
import { catalogExportDeliverer } from '#jobs/queues/deliverers/catalogExport'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #310 (SAPI 11), part 4: cancelling an unshipped order (stock released, everything paid given back), the orders
// export as a job, and a supplier's "Your sales" (FIRST-RELEASE §6, §17; ACCESS §5.2, §7.3).

let db: TestDatabase
let t: Tenants
type Who = 'owner' | 'staff' | 'drop' | 'hub' | 'reader' | 'stockOnly' | 'other'
const cookies = {} as Record<Who, string>
const sellers = { reader: '', stockOnly: '' }
const places = { main: '', drop: '' }
const versions = { house: '', scarf: '', stole: '' }
let stripeAccount = ''

const refunds: { ref: string; amount: bigint }[] = []
let refundAnswer: 'done' | 'unavailable' = 'done'
let cancelAnswer: 'closed' | 'processing' = 'closed'
const stripe: PaymentGateway = {
  available: () => true,
  start: async () => Promise.reject(new Error('not here')),
  outcome: async () => ({ state: 'pending' }),
  cancel: async () => {
    if (cancelAnswer === 'processing') throw new PaymentRefused('payment_intent_unexpected_state')
  },
  refund: async (_, ref, request) => {
    if (refundAnswer === 'unavailable') throw new PaymentUnavailable('down')
    refunds.push({ ref, amount: request.amount.amount })
    return { providerRef: `re_${refunds.length}`, state: 'done' }
  },
}

/** A placed order holding its stock: 2 house (2,000), 1 scarf (1,500, to-shopper), 1 stole (1,000, to-store), 500 delivery. */
const order = async (number: string, o: { method: 'cod' | 'stripe'; paid: boolean; placedAt?: string }) => {
  const [row] = await db.sql<{ id: string }[]>`
    insert into "order" (store_id, state, payment_state, currency, number, placed_at, paid_at, subtotal_amount, shipping_amount, total_amount, payment_method, stock_reserved, email, phone, shipping_address)
    values (${t.storeA1}, 'placed', ${o.paid ? 'paid' : 'pending'}, 'INR', ${number}, ${o.placedAt ?? new Date().toISOString()}, ${o.paid ? new Date() : null}, 4500, 500, 5000, ${o.method}, true,
      'priya@example.com', '+919800000001', ${db.sql.json({ name: 'Priya Shah', line1: '1 Road', line2: null, city: 'Pune', region: 'MH', postalCode: '411001', country: 'IN', phone: null })})
    returning id`
  const id = row?.id ?? ''
  const lines = [
    { version: versions.house, seller: null, quantity: 2, total: 2000, heldAt: places.main },
    { version: versions.scarf, seller: t.sellerA1First, quantity: 1, total: 1500, heldAt: places.drop },
    { version: versions.stole, seller: t.sellerA1Second, quantity: 1, total: 1000, heldAt: null },
  ]
  for (const [position, l] of lines.entries()) {
    const [v] = await db.sql<{ product_id: string }[]>`select product_id from product_version where id = ${l.version}`
    await db.sql`insert into order_line (order_id, store_id, seller_id, version_id, product_id, name, sku, quantity, unit_amount, line_total_amount, reserved_warehouse_id, position)
      values (${id}, ${t.storeA1}, ${l.seller}, ${l.version}, ${v?.product_id ?? ''}, ${`Item ${position}`}, ${`SKU${position}`}, ${l.quantity}, ${l.total / l.quantity}, ${l.total}, ${l.heldAt}, ${position})`
    if (l.heldAt) await db.sql`update stock_level set reserved = reserved + ${l.quantity} where version_id = ${l.version} and warehouse_id = ${l.heldAt}`
  }
  for (const [seller, mode] of [[null, 'store'], [t.sellerA1First, 'to-shopper'], [t.sellerA1Second, 'to-store']] as const) {
    await db.sql`insert into order_part (order_id, store_id, seller_id, shipping_mode) values (${id}, ${t.storeA1}, ${seller}, ${mode})`
  }
  await db.sql`insert into payment (order_id, store_id, provider, provider_account_id, provider_ref, kind, state, amount, currency, mode, captured_at)
    values (${id}, ${t.storeA1}, ${o.method}, ${o.method === 'stripe' ? stripeAccount : null}, ${o.method === 'stripe' ? `pi_${number.replace('-', '')}` : null}, ${o.method === 'stripe' ? 'card' : 'cod'},
      ${o.paid ? 'captured' : 'pending'}, 5000, 'INR', 'live', ${o.paid ? new Date() : null})`
  return id
}
const held = async (versionId: string, warehouseId: string) => (await db.sql<{ reserved: number }[]>`select reserved from stock_level where version_id = ${versionId} and warehouse_id = ${warehouseId}`)[0]?.reserved

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update seller set shipping_mode = 'to-shopper', access_level = 'vendor-orders-fulfil' where id = ${t.sellerA1First}`
  await db.sql`update seller set shipping_mode = 'to-store', access_level = 'vendor-orders-fulfil' where id = ${t.sellerA1Second}`
  sellers.reader = (await db.sql<{ id: string }[]>`insert into seller (store_id, name, access_level, status) values (${t.storeA1}, 'Chawla Crafts', 'vendor-orders-read', 'active') returning id`)[0]?.id ?? ''
  sellers.stockOnly = (await db.sql<{ id: string }[]>`insert into seller (store_id, name, access_level, status) values (${t.storeA1}, 'Dutta Dyes', 'vendor-stock', 'active') returning id`)[0]?.id ?? ''
  places.main = (await db.sql<{ id: string }[]>`select id from warehouse where store_id = ${t.storeA1} and seller_id is null and is_default`)[0]?.id ?? ''
  places.drop = (await db.sql<{ id: string }[]>`insert into warehouse (store_id, seller_id, name, is_default) values (${t.storeA1}, ${t.sellerA1First}, 'Anand works', true) returning id`)[0]?.id ?? ''
  const version = async (seller: string | null, sku: string) => {
    const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, seller_id, name, slug, visibility) values (${t.storeA1}, ${seller}, ${sku}, ${sku}, 'visible') returning id`
    return (await db.sql<{ id: string }[]>`insert into product_version (store_id, seller_id, product_id, sku, position, track_stock) values (${t.storeA1}, ${seller}, ${p?.id ?? ''}, ${sku}, 0, true) returning id`)[0]?.id ?? ''
  }
  versions.house = await version(null, 'house')
  versions.scarf = await version(t.sellerA1First, 'scarf')
  versions.stole = await version(t.sellerA1Second, 'stole')
  await db.sql`insert into stock_level (version_id, warehouse_id, store_id, seller_id, on_hand) values
    (${versions.house}, ${places.main}, ${t.storeA1}, null, 20), (${versions.scarf}, ${places.drop}, ${t.storeA1}, ${t.sellerA1First}, 20)`
  stripeAccount = (await db.sql<{ id: string }[]>`insert into payment_provider_account (store_id, provider, mode, external_account_id) values (${t.storeA1}, 'stripe', 'live', 'acct_jaipur') returning id`)[0]?.id ?? ''

  const person = async (email: string, role: string, seller: string | null = null, storeId = t.storeA1) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, ${email.split('@')[0] ?? ''}, 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${u?.id ?? ''}, ${storeId}, ${seller}, ${role}, 'active')`
    return withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
  }
  cookies.owner = await person('owner@a1.example', 'owner')
  cookies.staff = await person('staff@a1.example', 'staff')
  cookies.drop = await person('anand@a1.example', 'supplier-admin', t.sellerA1First)
  cookies.hub = await person('bhatia@a1.example', 'supplier-member', t.sellerA1Second)
  cookies.reader = await person('chawla@a1.example', 'supplier-admin', sellers.reader)
  cookies.stockOnly = await person('dutta@a1.example', 'supplier-admin', sellers.stockOnly)
  cookies.other = await person('owner@a2.example', 'owner', null, t.storeA2)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const sellerOf: Partial<Record<Who, () => string>> = { drop: () => t.sellerA1First, hub: () => t.sellerA1Second, reader: () => sellers.reader, stockOnly: () => sellers.stockOnly }
const gql = async (source: string, who: Who, as: { support?: 'read' } = {}) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const seller = sellerOf[who]?.()
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: who === 'other' ? t.storeA2 : t.storeA1, ...(seller ? { [supplierHeader]: seller } : {}) }
  const resolved = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  const standing = as.support && resolved.kind === 'acting'
    ? { ...resolved, caller: { ...resolved.caller, context: { ...resolved.caller.context, caller: { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: as.support } } } }
    : resolved
  const payments = { gateways: { stripe }, stripeConnect: null, stripeTax: () => null, webhookUrl: () => '' }
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, payments, secrets: null, now: () => new Date() }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const cancel = (who: Who, id: string, as: { support?: 'read' } = {}) => gql(`mutation { cancelOrder(orderId: "${id}", reason: shopper) }`, who, as)
const stateOf = async (id: string) => (await db.sql<{ state: string; payment_state: string; cancel_reason: string | null; refunded_amount: string }[]>`select state, payment_state, cancel_reason, refunded_amount::text from "order" where id = ${id}`)[0]

describe('cancelling an order', () => {
  it('releases a cash order’s stock and gives nothing back, each part cancelled and every owner told', async () => {
    const id = await order('A-4001', { method: 'cod', paid: false })
    const before = { house: await held(versions.house, places.main), scarf: await held(versions.scarf, places.drop) }
    expect((await cancel('staff', id)).data?.['cancelOrder']).toBe(true)
    expect(await stateOf(id)).toEqual({ state: 'cancelled', payment_state: 'pending', cancel_reason: 'shopper', refunded_amount: '0' })
    expect(await held(versions.house, places.main)).toBe((before.house ?? 0) - 2)
    expect(await held(versions.scarf, places.drop)).toBe((before.scarf ?? 0) - 1)
    expect(new Set((await db.sql<{ state: string }[]>`select state from order_part where order_id = ${id}`).map((p) => p.state))).toEqual(new Set(['cancelled']))
    expect(await db.sql`select 1 from refund where order_id = ${id}`).toHaveLength(0)
    expect((await gql(`{ order(id: "${id}") { state parts { state } history { action note } } }`, 'drop')).data?.['order']).toEqual({ state: 'cancelled', parts: [{ state: 'cancelled' }], history: [{ action: 'order.cancelled', note: null }] })
    expect((await cancel('owner', id)).code).toBe('NOT_CANCELLABLE')
  })

  it('gives everything paid back on the card, one refund an owner as cancelled, never on the ledger', async () => {
    const id = await order('A-4002', { method: 'stripe', paid: true })
    expect((await cancel('owner', id)).data?.['cancelOrder']).toBe(true)
    expect(await stateOf(id)).toEqual({ state: 'cancelled', payment_state: 'refunded', cancel_reason: 'shopper', refunded_amount: '5000' })
    expect(refunds.map((r) => r.amount).reduce((a, b) => a + b, 0n)).toBe(5000n)
    const rows = await db.sql<{ seller_id: string | null; amount: string; reason: string; override_of_seller_id: string | null }[]>`select seller_id, amount::text, reason, override_of_seller_id from refund where order_id = ${id} order by amount desc`
    expect(rows).toEqual([
      { seller_id: null, amount: '2500', reason: 'cancelled', override_of_seller_id: null },
      { seller_id: t.sellerA1First, amount: '1500', reason: 'cancelled', override_of_seller_id: null },
      { seller_id: t.sellerA1Second, amount: '1000', reason: 'cancelled', override_of_seller_id: null },
    ])
    expect(await db.sql`select 1 from supplier_ledger_entry`).toHaveLength(0)
  })

  it('keeps the order as it was when the provider is down, and refuses one whose card payment is still going through', async () => {
    const paid = await order('A-4003', { method: 'stripe', paid: true })
    const before = await held(versions.house, places.main)
    refundAnswer = 'unavailable'
    expect((await cancel('owner', paid)).code).toBe('PROVIDER_UNAVAILABLE')
    refundAnswer = 'done'
    expect(await stateOf(paid)).toMatchObject({ state: 'placed', payment_state: 'paid' })
    expect(await held(versions.house, places.main)).toBe(before)
    const paying = await order('A-4004', { method: 'stripe', paid: false })
    cancelAnswer = 'processing'
    expect((await cancel('owner', paying)).code).toBe('PAYMENT_PENDING')
    cancelAnswer = 'closed'
    expect((await cancel('owner', paying)).data?.['cancelOrder']).toBe(true)
  })

  it('never cancels another store’s order: not found, and its state, stock and payment untouched', async () => {
    const id = await order('A-4006', { method: 'stripe', paid: true })
    const before = { state: await stateOf(id), house: await held(versions.house, places.main), refunds: refunds.length }
    expect((await cancel('other', id)).code).toBe('NOT_FOUND')
    expect(await stateOf(id)).toEqual(before.state)
    expect(await held(versions.house, places.main)).toBe(before.house)
    expect(refunds.length).toBe(before.refunds)
    expect((await db.sql`select state from payment where order_id = ${id}`)[0]?.['state']).toBe('captured')
  })

  it('refuses once anything has left, a supplier, and a read-only support session', async () => {
    const id = await order('A-4005', { method: 'cod', paid: false })
    expect((await cancel('drop', id)).code).toBe('FORBIDDEN')
    expect((await cancel('owner', id, { support: 'read' })).code).toBe('READ_ONLY')
    const scarf = (await db.sql<{ id: string }[]>`select id from order_line where order_id = ${id} and version_id = ${versions.scarf}`)[0]?.id ?? ''
    expect((await gql(`mutation { shipItems(orderId: "${id}", warehouseId: "${places.drop}", lines: [{ lineId: "${scarf}", quantity: 1 }]) }`, 'drop')).code).toBeUndefined()
    expect((await cancel('owner', id)).code).toBe('NOT_CANCELLABLE')
  })
})

describe('the orders export', () => {
  const relay = () => relayDue(db.sql, { 'export.catalog': catalogExportDeliverer(db.sql) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
  const exported = async (who: Who, args = '') => {
    const asked = await gql(`mutation { exportOrders${args} }`, who)
    if (asked.code) return { code: asked.code }
    await relay()
    const file = (await gql(`{ orderExport(id: "${asked.data?.['exportOrders'] as string}") { state rows truncated csv } }`, who)).data?.['orderExport'] as { state: string; csv: string }
    return { state: file.state, lines: file.csv.split('\n') }
  }

  it('gives the merchant side every line of the orders the chip chooses, with the shopper and the money', async () => {
    const file = await exported('staff', '(filter: CANCELLED_REFUNDED, search: "A-4001")')
    expect(file.state).toBe('done')
    expect(file.lines?.[0]).toBe('order,placed at (UTC),status,payment,fulfilment,paid with,customer,email,phone,city,region,postal code,country,item,option,sku,supplier,quantity,unit price,line total,order total,currency')
    expect(file.lines?.slice(1).map((l) => l.split(',').slice(0, 1).concat(l.split(',').slice(6, 8), l.split(',').slice(16, 21)))).toEqual([
      ['A-4001', 'Priya Shah', 'priya@example.com', '', '2', '10.00', '20.00', '50.00'],
      ['A-4001', 'Priya Shah', 'priya@example.com', 'Anand Textiles', '1', '15.00', '15.00', '50.00'],
      ['A-4001', 'Priya Shah', 'priya@example.com', 'Bhatia Threads', '1', '10.00', '10.00', '50.00'],
    ])
    const recent = (await gql('{ orderExports { state } catalogExports { id } }', 'staff')).data
    expect(recent).toEqual({ orderExports: [{ state: 'done' }], catalogExports: [] })
  })

  it('gives a supplier its own lines only, no totals, and the shopper only where its part ships to the shopper', async () => {
    const drop = await exported('drop', '(search: "A-4001")')
    expect(drop.lines?.[0]).toBe('order,placed at (UTC),status,your part,ships,customer,city,region,postal code,country,item,option,sku,quantity,unit price,amount,currency')
    expect(drop.lines?.slice(1)).toHaveLength(1)
    expect(drop.lines?.[1]).toContain(',to-shopper,Priya Shah,Pune,MH,411001,IN,Item 1,')
    expect(drop.lines?.join('\n')).not.toMatch(/priya@example\.com|9800000001|50\.00/)
    const hub = await exported('hub', '(search: "A-4001")')
    expect(hub.lines?.[1]).toContain(',to-store,,,,,,Item 2,')
  })

  it('reads a file only for whoever asked: never another seat, a supplier, another store, nor as a products export', async () => {
    const asked = (await gql('mutation { exportOrders }', 'owner')).data?.['exportOrders'] as string
    await relay()
    const read = (who: Who) => gql(`{ orderExport(id: "${asked}") { state } }`, who)
    expect((await read('owner')).data?.['orderExport']).toEqual({ state: 'done' })
    for (const who of ['staff', 'drop', 'reader', 'other'] as const) expect((await read(who)).data?.['orderExport'], who).toBeNull()
    expect((await gql(`{ catalogExport(id: "${asked}") { id } }`, 'owner')).data?.['catalogExport']).toBeNull()
    expect(((await gql('{ orderExports { id } }', 'staff')).data?.['orderExports'] as { id: string }[]).map((e) => e.id)).not.toContain(asked)
  })

  it('gives another store’s export none of this store’s rows', async () => {
    const theirs = await exported('other')
    expect(theirs.state).toBe('done')
    expect(theirs.lines).toHaveLength(1)
  })

  it('cuts the file at its cap and says so', async () => {
    const asked = (await gql('mutation { exportOrders }', 'owner')).data?.['exportOrders'] as string
    const merchant = { caller: { kind: 'person' as const, userId: crypto.randomUUID(), sessionId: '' }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' as const }, subscription: 'active' as const }
    const built = await withScope(db.sql, merchant, async (tx) => {
      const job = await selectCatalogExport(tx, t.storeA1, asked)
      if (!job) throw new Error('no job')
      return buildOrderExport(tx, job, 2)
    })
    expect([built.rows, built.truncated]).toEqual([2, true])
    expect(built.csv.split('\n').at(-1)).toBe('Cut at 2 rows: narrow the filter for the rest.')
  })

  it('lets the read-only order tier export, never a stock-only supplier or a read-only support session', async () => {
    expect((await exported('reader')).state).toBe('done')
    expect((await exported('stockOnly')).code).toBe('FORBIDDEN')
    expect((await gql('mutation { exportOrders }', 'owner', { support: 'read' })).code).toBe('FORBIDDEN')
  })
})

describe('Your sales', () => {
  it('lists a supplier’s own sold lines at the price sold, newest first, and nothing for anyone without sales.read', async () => {
    const sales = (await gql('{ mySales(first: 2) { nodes { orderNumber name quantity amount { amount currency } } pageInfo { hasNextPage } } }', 'hub')).data?.['mySales'] as { nodes: { orderNumber: string }[]; pageInfo: { hasNextPage: boolean } }
    expect(sales.nodes[0]).toMatchObject({ name: 'Item 2', quantity: 1, amount: { amount: '1000', currency: 'INR' } })
    expect(sales.pageInfo.hasNextPage).toBe(true)
    const all = ((await gql('{ mySales { nodes { orderNumber name } } }', 'drop')).data?.['mySales'] as { nodes: { name: string }[] }).nodes
    expect(new Set(all.map((s) => s.name))).toEqual(new Set(['Item 1']))
    for (const who of ['owner', 'stockOnly'] as const) expect((await gql('{ mySales { nodes { orderNumber } } }', who)).code).toBe('FORBIDDEN')
  })
})
