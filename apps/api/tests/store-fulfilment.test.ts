import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { releaseStock } from '#db/scoped/orders'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #310 (SAPI 11), part 2: shipping an order (PortalOrders "Ship items"; ACCESS §7.3): the store ships its own lines and a
// to-store supplier's once handed over; a supplier ships its own to the shopper or hands them to the store, from its own
// locations; stock leaves where it was shipped from, and what the order held is given back.

let db: TestDatabase
let t: Tenants
type Who = 'owner' | 'staff' | 'drop' | 'hub' | 'reader'
const cookies = {} as Record<Who, string>
const places = { main: '', annexe: '', drop: '', hub: '' }
const versions = { house: '', loose: '', scarf: '', stole: '' }
let reader = ''

const level = async (versionId: string, warehouseId: string) =>
  (await db.sql<{ on_hand: number; reserved: number }[]>`select on_hand, reserved from stock_level where version_id = ${versionId} and warehouse_id = ${warehouseId}`)[0]

/** A placed order whose lines hold their stock where it is, as placement would (one location a line). */
const order = async (number: string, o: { method?: string; paymentState?: string; state?: string; mode?: string; option?: string; dueBy?: string | null; lines: { version: string; seller: string | null; quantity: number; heldAt: string | null }[] }) => {
  const [row] = await db.sql<{ id: string }[]>`
    insert into "order" (store_id, state, payment_state, currency, number, placed_at, total_amount, payment_method, shipping_option, payment_due_by, stock_reserved, shipping_address)
    values (${t.storeA1}, ${o.state ?? 'placed'}, ${o.paymentState ?? 'pending'}, 'INR', ${number}, now(), 1000, ${o.method ?? 'cod'}, ${o.option ?? 'flat'}, ${o.dueBy ?? null}, true,
      ${db.sql.json({ name: 'Priya Shah', line1: '1 Road', line2: null, city: 'Pune', region: null, postalCode: '411001', country: 'IN', phone: null })})
    returning id`
  const id = row?.id ?? ''
  for (const [position, l] of o.lines.entries()) {
    const [v] = await db.sql<{ product_id: string }[]>`select product_id from product_version where id = ${l.version}`
    await db.sql`insert into order_line (order_id, store_id, seller_id, version_id, product_id, name, quantity, unit_amount, line_total_amount, reserved_warehouse_id, position)
      values (${id}, ${t.storeA1}, ${l.seller}, ${l.version}, ${v?.product_id ?? ''}, 'Item', ${l.quantity}, 100, ${100 * l.quantity}, ${l.heldAt}, ${position})`
    if (l.heldAt) await db.sql`update stock_level set reserved = reserved + ${l.quantity} where version_id = ${l.version} and warehouse_id = ${l.heldAt}`
  }
  for (const seller of new Set(o.lines.map((l) => l.seller))) {
    const mode = seller ? ((await db.sql<{ m: string }[]>`select shipping_mode as m from seller where id = ${seller}`)[0]?.m ?? 'to-store') : 'store'
    await db.sql`insert into order_part (order_id, store_id, seller_id, shipping_mode) values (${id}, ${t.storeA1}, ${seller}, ${mode})`
  }
  await db.sql`insert into payment (order_id, store_id, provider, kind, state, amount, currency, mode) values (${id}, ${t.storeA1}, ${o.method ?? 'cod'}, 'cod', 'pending', 1000, 'INR', ${o.mode ?? 'live'})`
  return id
}
const lineOf = async (orderId: string, versionId: string) => (await db.sql<{ id: string }[]>`select id from order_line where order_id = ${orderId} and version_id = ${versionId}`)[0]?.id ?? ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update seller set shipping_mode = 'to-shopper', access_level = 'vendor-orders-fulfil' where id = ${t.sellerA1First}`
  await db.sql`update seller set shipping_mode = 'to-store', access_level = 'vendor-orders-fulfil' where id = ${t.sellerA1Second}`
  reader = (await db.sql<{ id: string }[]>`insert into seller (store_id, name, access_level, status) values (${t.storeA1}, 'Chawla Crafts', 'vendor-orders-read', 'active') returning id`)[0]?.id ?? ''
  places.main = (await db.sql<{ id: string }[]>`select id from warehouse where store_id = ${t.storeA1} and seller_id is null and is_default`)[0]?.id ?? ''
  places.annexe = (await db.sql<{ id: string }[]>`insert into warehouse (store_id, name) values (${t.storeA1}, 'Annexe') returning id`)[0]?.id ?? ''
  places.drop = (await db.sql<{ id: string }[]>`insert into warehouse (store_id, seller_id, name, is_default) values (${t.storeA1}, ${t.sellerA1First}, 'Anand works', true) returning id`)[0]?.id ?? ''
  places.hub = (await db.sql<{ id: string }[]>`insert into warehouse (store_id, seller_id, name, is_default) values (${t.storeA1}, ${t.sellerA1Second}, 'Bhatia mill', true) returning id`)[0]?.id ?? ''
  const version = async (seller: string | null, sku: string, track: boolean) => {
    const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, seller_id, name, slug, visibility) values (${t.storeA1}, ${seller}, ${sku}, ${sku}, 'visible') returning id`
    return (await db.sql<{ id: string }[]>`insert into product_version (store_id, seller_id, product_id, sku, position, track_stock) values (${t.storeA1}, ${seller}, ${p?.id ?? ''}, ${sku}, 0, ${track}) returning id`)[0]?.id ?? ''
  }
  versions.house = await version(null, 'house', true)
  versions.loose = await version(null, 'loose', false)
  versions.scarf = await version(t.sellerA1First, 'scarf', true)
  versions.stole = await version(t.sellerA1Second, 'stole', true)
  await db.sql`insert into stock_level (version_id, warehouse_id, store_id, seller_id, on_hand) values
    (${versions.house}, ${places.main}, ${t.storeA1}, null, 10), (${versions.house}, ${places.annexe}, ${t.storeA1}, null, 0),
    (${versions.scarf}, ${places.drop}, ${t.storeA1}, ${t.sellerA1First}, 5), (${versions.stole}, ${places.hub}, ${t.storeA1}, ${t.sellerA1Second}, 4)`

  const person = async (email: string, role: string, seller: string | null = null) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, ${email.split('@')[0] ?? ''}, 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${u?.id ?? ''}, ${t.storeA1}, ${seller}, ${role}, 'active')`
    return withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
  }
  cookies.owner = await person('owner@a1.example', 'owner')
  cookies.staff = await person('staff@a1.example', 'staff')
  cookies.drop = await person('anand@a1.example', 'supplier-admin', t.sellerA1First)
  cookies.hub = await person('bhatia@a1.example', 'supplier-member', t.sellerA1Second)
  cookies.reader = await person('chawla@a1.example', 'supplier-admin', reader)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const sellerOf: Partial<Record<Who, () => string>> = { drop: () => t.sellerA1First, hub: () => t.sellerA1Second, reader: () => reader }
const gql = async (source: string, who: Who, as: { support?: 'read' } = {}) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const seller = sellerOf[who]?.()
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: t.storeA1, ...(seller ? { [supplierHeader]: seller } : {}) }
  const resolved = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  const standing = as.support && resolved.kind === 'acting'
    ? { ...resolved, caller: { ...resolved.caller, context: { ...resolved.caller.context, caller: { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: as.support } } } }
    : resolved
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now: () => new Date() }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const ship = (who: Who, orderId: string, warehouseId: string, lines: { id: string; quantity: number }[], extra = '', as: { support?: 'read' } = {}) =>
  gql(`mutation { shipItems(orderId: "${orderId}", warehouseId: "${warehouseId}", lines: [${lines.map((l) => `{ lineId: "${l.id}", quantity: ${l.quantity} }`).join(', ')}]${extra}) }`, who, as)
const states = async (orderId: string) => {
  const [o] = await db.sql<{ fulfilment_state: string; payment_due_by: Date | null }[]>`select fulfilment_state, payment_due_by from "order" where id = ${orderId}`
  const parts = await db.sql<{ seller_id: string | null; state: string }[]>`select seller_id, state from order_part where order_id = ${orderId}`
  return { order: o?.fulfilment_state, due: o?.payment_due_by ?? null, parts: Object.fromEntries(parts.map((p) => [p.seller_id ?? 'store', p.state])) }
}

describe('the store ships its own lines', () => {
  let id = ''
  let house = ''
  beforeAll(async () => {
    id = await order('A-2001', {
      method: 'bank_transfer', dueBy: '2026-10-10T00:00:00Z',
      lines: [{ version: versions.house, seller: null, quantity: 3, heldAt: places.main }, { version: versions.scarf, seller: t.sellerA1First, quantity: 2, heldAt: places.drop }, { version: versions.stole, seller: t.sellerA1Second, quantity: 1, heldAt: places.hub }],
    })
    house = await lineOf(id, versions.house)
  })

  it('ships part of a line from a named location: stock leaves there, the hold with it, and the rest stays to ship', async () => {
    const made = await ship('staff', id, places.main, [{ id: house, quantity: 1 }], ', courierName: "Delhivery", trackingNumber: "DL123", trackingUrl: "https://track.example/DL123"')
    expect(made.code).toBeUndefined()
    expect(made.data?.['shipItems']).toHaveLength(1)
    expect(await level(versions.house, places.main)).toEqual({ on_hand: 9, reserved: 2 })
    const [movement] = await db.sql`select delta, resulting_quantity, reason, source_kind, source_id, actor_kind from stock_movement where version_id = ${versions.house}`
    expect(movement).toEqual({ delta: -1, resulting_quantity: 9, reason: 'order', source_kind: 'order', source_id: id, actor_kind: 'person' })
    // A transfer sent unpaid is the store's choice: the 3-day sweep lets it be.
    expect(await states(id)).toEqual({ order: 'partly_fulfilled', due: null, parts: { store: 'partly_shipped', [t.sellerA1First]: 'to_ship', [t.sellerA1Second]: 'to_ship' } })
    const shipments = ((await gql(`{ order(id: "${id}") { shipments { kind warehouseName courierName trackingNumber trackingUrl lines { quantity } } lines: parts { lines { fulfilledQuantity } } history { action actorName } } }`, 'owner')).data?.['order']) as Record<string, unknown>
    expect(shipments['shipments']).toEqual([{ kind: 'manual', warehouseName: 'Main location', courierName: 'Delhivery', trackingNumber: 'DL123', trackingUrl: 'https://track.example/DL123', lines: [{ quantity: 1 }] }])
    expect((shipments['history'] as { action: string; actorName: string }[])[0]).toEqual({ action: 'order.shipped', actorName: 'staff' })
  })

  it('refuses what isn’t its to ship, more than is left or than the location holds, and writes nothing', async () => {
    const scarf = await lineOf(id, versions.scarf)
    const stole = await lineOf(id, versions.stole)
    expect((await ship('owner', id, places.main, [{ id: scarf, quantity: 1 }])).code).toBe('NOT_YOURS')
    expect((await ship('owner', id, places.main, [{ id: stole, quantity: 1 }])).code).toBe('TOO_MANY')
    expect((await ship('owner', id, places.drop, [{ id: house, quantity: 1 }])).code).toBe('NOT_YOURS')
    expect((await ship('owner', id, places.main, [{ id: house, quantity: 3 }])).code).toBe('TOO_MANY')
    expect((await ship('owner', id, places.annexe, [{ id: house, quantity: 1 }])).code).toBe('NOT_ENOUGH_STOCK')
    expect((await ship('owner', id, places.main, [{ id: house, quantity: 0 }])).code).toBe('INVALID_INPUT')
    expect((await ship('owner', id, places.main, [{ id: house, quantity: 1 }], ', trackingUrl: "http://track.example/x", trackingNumber: "X"')).code).toBe('INVALID_INPUT')
    expect((await ship('owner', id, places.main, [{ id: house, quantity: 1 }], '', { support: 'read' })).code).toBe('READ_ONLY')
    expect(await level(versions.house, places.main)).toEqual({ on_hand: 9, reserved: 2 })
    expect(await db.sql`select 1 from fulfilment where order_id = ${id}`).toHaveLength(1)
  })

  it('ships the rest and marks its part shipped, the order still partly while suppliers’ lines wait', async () => {
    expect((await ship('owner', id, places.main, [{ id: house, quantity: 2 }])).code).toBeUndefined()
    expect(await level(versions.house, places.main)).toEqual({ on_hand: 7, reserved: 0 })
    expect((await states(id)).parts['store']).toBe('shipped')
    expect((await states(id)).order).toBe('partly_fulfilled')
  })

  it('a to-shopper supplier ships its own lines from its own location, and sees its own shipment only', async () => {
    const scarf = await lineOf(id, versions.scarf)
    expect((await ship('drop', id, places.main, [{ id: scarf, quantity: 2 }])).code).toBe('NOT_YOURS')
    // Another owner's line answers as one that doesn't exist: a supplier learns nothing of others' lines (ACCESS §7.3).
    expect((await ship('drop', id, places.drop, [{ id: house, quantity: 1 }])).code).toBe('NOT_FOUND')
    expect((await ship('drop', id, places.drop, [{ id: crypto.randomUUID(), quantity: 1 }])).code).toBe('NOT_FOUND')
    expect((await ship('drop', id, places.drop, [{ id: scarf, quantity: 2 }], ', trackingNumber: "BD9"')).code).toBeUndefined()
    expect(await level(versions.scarf, places.drop)).toEqual({ on_hand: 3, reserved: 0 })
    expect((await states(id)).parts[t.sellerA1First]).toBe('shipped')
    const seen = (await gql(`{ order(id: "${id}") { shipments { kind trackingNumber warehouseName } history { action actorName note } } }`, 'drop')).data?.['order']
    expect(seen).toEqual({ shipments: [{ kind: 'manual', trackingNumber: 'BD9', warehouseName: 'Anand works' }], history: [{ action: 'order.shipped', actorName: null, note: null }] })
  })

  it('a to-store supplier hands its lines to the store; the store ships them on, its tracking never the supplier’s', async () => {
    const stole = await lineOf(id, versions.stole)
    expect((await ship('hub', id, places.hub, [{ id: stole, quantity: 2 }])).code).toBe('TOO_MANY')
    expect((await ship('hub', id, places.hub, [{ id: stole, quantity: 1 }])).code).toBeUndefined()
    expect(await level(versions.stole, places.hub)).toEqual({ on_hand: 3, reserved: 0 })
    expect(await states(id)).toMatchObject({ order: 'partly_fulfilled', parts: { [t.sellerA1Second]: 'sent_to_store' } })
    expect((await ship('hub', id, places.hub, [{ id: stole, quantity: 1 }])).code).toBe('TOO_MANY')
    // The store ships it on from its own location; the stole's stock already left at the hand-off.
    expect((await ship('owner', id, places.main, [{ id: stole, quantity: 1 }], ', trackingNumber: "DL777"')).code).toBeUndefined()
    expect(await level(versions.stole, places.hub)).toEqual({ on_hand: 3, reserved: 0 })
    expect(await states(id)).toMatchObject({ order: 'fulfilled', parts: { store: 'shipped', [t.sellerA1First]: 'shipped', [t.sellerA1Second]: 'shipped' } })
    const seen = (await gql(`{ order(id: "${id}") { shipments { kind trackingNumber } parts { lines { sentToStoreQuantity fulfilledQuantity } } } }`, 'hub')).data?.['order']
    expect(seen).toEqual({ shipments: [{ kind: 'sent_to_store', trackingNumber: null }], parts: [{ lines: [{ sentToStoreQuantity: 1, fulfilledQuantity: 1 }] }] })
  })

  it('adds or corrects tracking on a shipment by whoever sent it', async () => {
    const [mine] = await db.sql<{ id: string }[]>`select id from fulfilment where order_id = ${id} and seller_id is null and tracking_number is null`
    expect((await gql(`mutation { addTracking(shipmentId: "${mine?.id ?? ''}", courierName: "Blue Dart", trackingNumber: "BD0", trackingUrl: "https://track.example/BD0") }`, 'owner')).data?.['addTracking']).toBe(true)
    // Correcting the number keeps the courier and the address it doesn't restate.
    expect((await gql(`mutation { addTracking(shipmentId: "${mine?.id ?? ''}", trackingNumber: "BD1") }`, 'owner')).data?.['addTracking']).toBe(true)
    expect((await gql(`mutation { addTracking(shipmentId: "${mine?.id ?? ''}", trackingNumber: "BD2") }`, 'drop')).code).toBe('NOT_FOUND')
    expect((await gql(`mutation { addTracking(shipmentId: "${mine?.id ?? ''}", trackingNumber: "BD2", trackingUrl: "ftp://x") }`, 'owner')).code).toBe('INVALID_INPUT')
    expect((await db.sql`select courier_name, tracking_number, tracking_url from fulfilment where id = ${mine?.id ?? ''}`)[0]).toEqual({ courier_name: 'Blue Dart', tracking_number: 'BD1', tracking_url: 'https://track.example/BD0' })
  })
})

describe('what never ships', () => {
  it('refuses a cancelled order, a test order and a card order still being paid; a pickup is handed over, not posted', async () => {
    const line = { version: versions.loose, seller: null, quantity: 1, heldAt: null }
    for (const o of [{ state: 'cancelled' }, { mode: 'test', method: 'stripe', paymentState: 'paid' }, { method: 'stripe' }]) {
      const id = await order(`A-${crypto.randomUUID().slice(0, 6)}`, { ...o, lines: [line] })
      expect((await ship('owner', id, places.main, [{ id: await lineOf(id, versions.loose), quantity: 1 }])).code, JSON.stringify(o)).toBe('NOT_SHIPPABLE')
    }
    const pickup = await order('A-2101', { option: 'pickup', lines: [line] })
    expect((await ship('owner', pickup, places.main, [{ id: await lineOf(pickup, versions.loose), quantity: 1 }])).code).toBeUndefined()
    const [made] = await db.sql<{ id: string; kind: string }[]>`select id, kind from fulfilment where order_id = ${pickup}`
    expect(made?.kind).toBe('pickup')
    expect((await gql(`mutation { addTracking(shipmentId: "${made?.id ?? ''}", trackingNumber: "X") }`, 'owner')).code).toBe('NOT_SHIPPABLE')
  })

  it('refuses a read-only supplier tier, and a supplier an order without its lines as not found', async () => {
    const id = await order('A-2201', { lines: [{ version: versions.loose, seller: null, quantity: 1, heldAt: null }] })
    expect((await ship('reader', id, places.main, [{ id: await lineOf(id, versions.loose), quantity: 1 }])).code).toBe('FORBIDDEN')
    expect((await ship('drop', id, places.drop, [{ id: await lineOf(id, versions.loose), quantity: 1 }])).code).toBe('NOT_FOUND')
  })

  it('leaves a transfer’s due date when a supplier ships: only the store chooses to send it unpaid', async () => {
    const id = await order('A-2251', { method: 'bank_transfer', dueBy: '2026-10-10T00:00:00Z', lines: [{ version: versions.scarf, seller: t.sellerA1First, quantity: 1, heldAt: places.drop }, { version: versions.stole, seller: t.sellerA1Second, quantity: 1, heldAt: places.hub }] })
    expect((await ship('drop', id, places.drop, [{ id: await lineOf(id, versions.scarf), quantity: 1 }])).code).toBeUndefined()
    expect((await ship('hub', id, places.hub, [{ id: await lineOf(id, versions.stole), quantity: 1 }])).code).toBeUndefined()
    expect((await states(id)).due).toEqual(new Date('2026-10-10T00:00:00Z'))
    expect((await ship('owner', id, places.main, [{ id: await lineOf(id, versions.stole), quantity: 1 }])).code).toBeUndefined()
    expect((await states(id)).due).toBeNull()
  })

  it('lets a past-due store’s supplier keep shipping while the merchant side is read-only (#337)', async () => {
    const id = await order('A-2301', { lines: [{ version: versions.scarf, seller: t.sellerA1First, quantity: 1, heldAt: places.drop }] })
    await db.sql`update store set status = 'past_due' where id = ${t.storeA1}`
    try {
      expect((await gql(`mutation { addOrderNote(orderId: "${id}", note: "x") }`, 'owner')).code).toBe('READ_ONLY')
      expect((await ship('drop', id, places.drop, [{ id: await lineOf(id, versions.scarf), quantity: 1 }])).code).toBeUndefined()
    } finally {
      await db.sql`update store set status = 'active' where id = ${t.storeA1}`
    }
  })
})

describe('stock an order still holds', () => {
  it('gives back on cancellation only what hasn’t left: shipped or handed to the store', async () => {
    const id = await order('A-2401', { lines: [{ version: versions.house, seller: null, quantity: 3, heldAt: places.main }, { version: versions.stole, seller: t.sellerA1Second, quantity: 2, heldAt: places.hub }] })
    expect((await ship('owner', id, places.main, [{ id: await lineOf(id, versions.house), quantity: 1 }])).code).toBeUndefined()
    expect((await ship('hub', id, places.hub, [{ id: await lineOf(id, versions.stole), quantity: 1 }])).code).toBeUndefined()
    const before = { house: await level(versions.house, places.main), stole: await level(versions.stole, places.hub) }
    await withSystemScope(db.sql, (tx) => releaseStock(tx, t.storeA1, id))
    expect(await level(versions.house, places.main)).toEqual({ on_hand: before.house?.on_hand, reserved: (before.house?.reserved ?? 0) - 2 })
    expect(await level(versions.stole, places.hub)).toEqual({ on_hand: before.stole?.on_hand, reserved: (before.stole?.reserved ?? 0) - 1 })
  })
})

describe('in the database (DATA-MODEL §7.11)', () => {
  const as = (seller: string | null): TenantContext => ({ caller: { kind: 'person', userId: crypto.randomUUID(), sessionId: crypto.randomUUID() }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: seller ? { kind: 'seller', sellerId: seller } : { kind: 'all' }, subscription: 'active' })

  it('lets a supplier read only its own shipments and write none; the merchant side reads all and writes none', async () => {
    const own = await withScope(db.sql, as(t.sellerA1First), (tx) => tx<{ seller_id: string }[]>`select seller_id from fulfilment`)
    expect(own.length).toBeGreaterThan(0)
    expect(new Set(own.map((f) => f.seller_id))).toEqual(new Set([t.sellerA1First]))
    expect(new Set((await withScope(db.sql, as(null), (tx) => tx<{ seller_id: string | null }[]>`select seller_id from fulfilment`)).map((f) => f.seller_id))).toEqual(new Set([null, t.sellerA1First, t.sellerA1Second]))
    for (const who of [t.sellerA1First, null]) {
      await expect(withScope(db.sql, as(who), (tx) => tx`update fulfilment set tracking_number = 'x'`)).rejects.toThrow(/permission denied/)
      await expect(withScope(db.sql, as(who), (tx) => tx`delete from fulfilment_line`)).rejects.toThrow(/permission denied/)
    }
    const otherStore: TenantContext = { ...as(null), storeId: t.storeA2 }
    expect(await withScope(db.sql, otherStore, (tx) => tx`select 1 from fulfilment`)).toHaveLength(0)
  })
})
