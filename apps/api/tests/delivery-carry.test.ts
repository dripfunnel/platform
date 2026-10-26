import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deliverySchema, type DeliveryContext } from '#apis/delivery/schema'
import { secretBox, type SecretBox } from '#auth/secretBox'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { createCarry, createDispatch, createOwnDelivery, firstDayOfWeek } from '#engine/modules/ownDelivery/index'
import { activityLog } from '#saas/activity/index'
import { seedStoreWorld, type StoreWorld } from './support/storeWorld'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// DL 6 (#843): pickup as a local shipment, the handover code, cash on delivery and steps sent late (DELIVERY §3, §4, §8).

let db: TestDatabase
let tenants: Tenants
let world: StoreWorld
let secrets: SecretBox
let warehouse = ''
let version = ''
const riders: string[] = []
let clock = new Date('2026-10-26T12:00:00Z')
const facts = { requestId: 'carry-test', ip: null, userAgent: null }
const merchantId = '00000000-0000-4000-8000-000000000001'
const context = (riderId?: string, storeId = tenants.storeA1): TenantContext => ({
  partnerId: tenants.partnerA, storeId, sellerScope: { kind: 'all' }, subscription: 'active',
  caller: riderId ? { kind: 'rider', riderId } : { kind: 'person', userId: merchantId, sessionId: 'test' },
})
const deps = (riderId?: string, storeId = tenants.storeA1) => ({ sql: db.sql, context: context(riderId, storeId), activity: activityLog, facts, now: () => clock, secrets })
const carry = (riderId?: string, storeId = tenants.storeA1) => createCarry(deps(riderId, storeId))
const dispatch = (riderId?: string) => createDispatch(deps(riderId))
const tick = (ms: number) => { clock = new Date(clock.getTime() + ms) }

const order = async (method: 'cod' | 'stripe' = 'cod') => {
  const [o] = await db.sql<{ id: string }[]>`insert into "order"(store_id,state,number,currency,payment_method,payment_state,shipping_option,delivery_warehouse_id,total_amount,shipping_amount,placed_at,email,phone,shopper_note,stock_reserved,shipping_address)
    values(${tenants.storeA1},'placed',${crypto.randomUUID().slice(0, 8)},'INR',${method},${method === 'cod' ? 'pending' : 'paid'},'own_delivery',${warehouse},10000,4000,${clock},'shopper@example.com','+919811111111','Ring twice',true,
      ${db.sql.json({ name: 'Secret Person', line1: 'Secret street 1', city: 'Jaipur', postalCode: '302017', country: 'IN', phone: '+919822222222', latitude: 26.915, longitude: 75.79 })}) returning id`
  if (!o) throw new Error('no order')
  const [v] = await db.sql<{ product_id: string }[]>`select product_id from product_version where id = ${version}`
  await db.sql`insert into order_part(order_id,store_id,seller_id,shipping_mode) values(${o.id},${tenants.storeA1},null,'store')`
  await db.sql`insert into order_line(order_id,store_id,version_id,product_id,name,quantity,unit_amount,line_total_amount,reserved_warehouse_id) values(${o.id},${tenants.storeA1},${version},${v?.product_id ?? ''},'Mug',2,3000,6000,${warehouse})`
  await db.sql`update stock_level set reserved = reserved + 2 where version_id = ${version} and warehouse_id = ${warehouse}`
  await db.sql`insert into payment(store_id,order_id,provider,kind,amount,currency,mode) values(${tenants.storeA1},${o.id},${method},${method === 'cod' ? 'cod' : 'card'},10000,'INR','live')`
  await withSystemScope(db.sql, (tx) => createOwnDelivery(tx, activityLog, tenants.storeA1, o.id, clock))
  return o.id
}
const latest = async (orderId: string) => {
  const [d] = await db.sql<{ id: string; state: string; rider_id: string | null; offer_round: number; delivered_at: Date | null; failed_reason: string | null; code_unconfirmed_at: Date | null; cash_collected_at: Date | null; handover_code_enc: string | null; code_attempts: number; fulfilment_id: string | null; excluded_rider_id: string | null }[]>`
    select id,state,rider_id,offer_round,delivered_at,failed_reason,code_unconfirmed_at,cash_collected_at,handover_code_enc,code_attempts,fulfilment_id,excluded_rider_id from delivery where order_id = ${orderId} order by created_at desc,id desc limit 1`
  if (!d) throw new Error('no delivery')
  return d
}
/** An order's delivery assigned by hand to a rider, with its fresh code. */
const assigned = async (method: 'cod' | 'stripe' = 'cod', rider = riders[0] ?? '') => {
  const id = await order(method)
  const d = await latest(id)
  await db.sql`update delivery set state = 'unassigned' where id = ${d.id}`
  await dispatch().assign(d.id, rider)
  return { orderId: id, deliveryId: d.id }
}
const codeOf = async (deliveryId: string) => {
  const [row] = await db.sql<{ handover_code_enc: string | null }[]>`select handover_code_enc from delivery where id = ${deliveryId}`
  const opened = row?.handover_code_enc ? await secrets.open(row.handover_code_enc) : null
  return opened?.split(':')[1] ?? ''
}
const wrong = (code: string) => (code === '0000' ? '1111' : '0000')
const pickedUp = async (method: 'cod' | 'stripe' = 'cod', rider = riders[0] ?? '') => {
  const a = await assigned(method, rider)
  await carry(rider).pickUp(a.deliveryId)
  return a
}
const onHand = async () => (await db.sql<{ on_hand: number; reserved: number }[]>`select on_hand,reserved from stock_level where version_id = ${version} and warehouse_id = ${warehouse}`)[0]
const riderGql = (riderId: string, source: string) => {
  const contextValue: DeliveryContext = { sql: db.sql, caller: { storeId: tenants.storeA1, partnerId: tenants.partnerA, available: true, rider: { ...context(riderId), caller: { kind: 'rider', riderId } }, token: null }, activity: activityLog, facts, now: () => clock, defer: () => undefined, secrets }
  return graphql({ schema: deliverySchema as GraphQLSchema, source, contextValue })
}

beforeAll(async () => {
  db = await createTestDatabase()
  tenants = await seedTenants(db.sql)
  secrets = await secretBox(btoa('k'.repeat(32)))
  world = await seedStoreWorld(db.sql, tenants, { now: () => clock, secrets, lookup: null })
  const [w] = await db.sql<{ id: string }[]>`select id from warehouse where store_id = ${tenants.storeA1} and seller_id is null limit 1`
  if (!w) throw new Error('no warehouse')
  warehouse = w.id
  await db.sql`update warehouse set latitude = 26.9124, longitude = 75.7873, address = ${db.sql.json({ line1: 'Depot road', city: 'Jaipur', country: 'IN' })} where id = ${warehouse}`
  await db.sql`insert into store_shipping(store_id,currency,own_delivery_enabled,dispatch_when,offer_minutes) values(${tenants.storeA1},'INR',true,'placed',5) on conflict(store_id) do update set own_delivery_enabled = true,dispatch_when = 'placed',offer_minutes = 5`
  const [p] = await db.sql<{ id: string }[]>`insert into product(store_id,name,slug,visibility) values(${tenants.storeA1},'Mug','carry-mug','visible') returning id`
  const [v] = await db.sql<{ id: string }[]>`insert into product_version(store_id,product_id,sku,position,track_stock) values(${tenants.storeA1},${p?.id ?? ''},'CARRY-MUG',0,true) returning id`
  version = v?.id ?? ''
  await db.sql`insert into stock_level(version_id,warehouse_id,store_id,seller_id,on_hand) values(${version},${warehouse},${tenants.storeA1},null,100)`
  for (let i = 0; i < 2; i++) {
    const [r] = await db.sql<{ id: string }[]>`insert into rider(store_id,name,phone,status) values(${tenants.storeA1},${`Rider ${i}`},${`+91970000000${i}`},'active') returning id`
    riders.push(r?.id ?? '')
  }
}, 60_000)
afterAll(async () => { await db?.drop() })

describe('pickup', () => {
  it('ships the lines as a local shipment from the delivery’s warehouse, as shipItems does', async () => {
    const before = await onHand()
    const { orderId, deliveryId } = await pickedUp()
    const d = await latest(orderId)
    expect(d).toMatchObject({ state: 'picked_up', rider_id: riders[0] })
    const shipments = await db.sql`select id,kind,warehouse_id,created_by from fulfilment where order_id = ${orderId}`
    expect(shipments).toEqual([{ id: d.fulfilment_id, kind: 'local', warehouse_id: warehouse, created_by: riders[0] }])
    expect(await onHand()).toEqual({ on_hand: (before?.on_hand ?? 0) - 2, reserved: (before?.reserved ?? 0) })
    expect(await db.sql`select delta,actor_kind,actor_id from stock_movement where source_id = ${orderId}`).toEqual([{ delta: -2, actor_kind: 'rider', actor_id: riders[0] }])
    expect(await db.sql`select fulfilment_state from "order" where id = ${orderId}`).toEqual([{ fulfilment_state: 'fulfilled' }])
    expect(await db.sql`select state from order_part where order_id = ${orderId}`).toEqual([{ state: 'shipped' }])
    expect(await db.sql`select payload->>'event' as event from outbox where kind = 'order.notify' and payload->>'orderId' = ${orderId}`).toEqual([{ event: 'shipped' }])
    expect(await db.sql`select payload->>'message' as message from outbox where kind = 'push' and payload->>'orderId' = ${orderId}`).toEqual([{ message: 'order.picked_up' }])
    expect(await db.sql`select action,actor_kind,api from activity_log where target_id = ${deliveryId} and action = 'delivery.picked_up'`).toEqual([{ action: 'delivery.picked_up', actor_kind: 'rider', api: 'delivery' }])
  })
  it('refuses another rider’s delivery, a second pickup, and stock that isn’t there, changing nothing', async () => {
    const { orderId, deliveryId } = await assigned()
    await expect(carry(riders[1]).pickUp(deliveryId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(carry(riders[0], tenants.storeA2).pickUp(deliveryId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await db.sql`update stock_level set on_hand = 1 where version_id = ${version} and warehouse_id = ${warehouse}`
    await expect(carry(riders[0]).pickUp(deliveryId)).rejects.toMatchObject({ code: 'NOT_ENOUGH_STOCK' })
    expect((await latest(orderId)).state).toBe('assigned')
    expect(await db.sql`select id from fulfilment where order_id = ${orderId}`).toHaveLength(0)
    await db.sql`update stock_level set on_hand = 100 where version_id = ${version} and warehouse_id = ${warehouse}`
    await carry(riders[0]).pickUp(deliveryId)
    await expect(carry(riders[0]).pickUp(deliveryId)).rejects.toMatchObject({ code: 'NOT_ASSIGNED' })
    await carry(riders[0]).failed({ id: deliveryId, reason: 'refused', note: null, at: clock.toISOString(), key: 'clean-1' })
  })
  it('hands back: a new round without that rider, and the code is gone', async () => {
    const { orderId, deliveryId } = await assigned()
    const before = await latest(orderId)
    expect(before.handover_code_enc).not.toBeNull()
    await carry(riders[0]).handBack(deliveryId)
    expect(await latest(orderId)).toMatchObject({ state: 'searching', rider_id: null, excluded_rider_id: riders[0], offer_round: before.offer_round + 1, handover_code_enc: null })
    expect(await db.sql`select 1 from outbox where kind = 'delivery.offer' and idempotency_key like ${`%${deliveryId}:${before.offer_round + 1}`}`).toHaveLength(1)
    // The next rider's assignment makes a fresh code.
    await db.sql`update delivery set state = 'unassigned' where id = ${deliveryId}`
    await dispatch().assign(deliveryId, riders[1] ?? '')
    expect(await codeOf(deliveryId)).toMatch(/^\d{4}$/)
    await db.sql`update delivery set state = 'cancelled' where id = ${deliveryId}`
  })
})

describe('the handover code', () => {
  it('delivers with the right code; cash on delivery needs the cash and then marks the order paid', async () => {
    const { orderId, deliveryId } = await pickedUp()
    const code = await codeOf(deliveryId)
    tick(60_000)
    await expect(carry(riders[0]).delivered({ id: deliveryId, code, cashCollected: null, at: clock.toISOString(), key: 'k1' })).rejects.toMatchObject({ code: 'CASH_NOT_CONFIRMED' })
    expect(await carry(riders[0]).delivered({ id: deliveryId, code, cashCollected: true, at: clock.toISOString(), key: 'k1' })).toBe(true)
    const d = await latest(orderId)
    expect(d).toMatchObject({ state: 'delivered', delivered_at: clock, cash_collected_at: clock, handover_code_enc: null })
    expect(await db.sql`select payment_state from "order" where id = ${orderId}`).toEqual([{ payment_state: 'paid' }])
    expect(await db.sql`select actor_kind from activity_log where target_id = ${orderId} and action = 'order.marked_paid'`).toEqual([{ actor_kind: 'rider' }])
    expect(await db.sql`select delivered_at from fulfilment where id = ${d.fulfilment_id}`).toEqual([{ delivered_at: clock }])
    expect(await db.sql`select payload->>'event' as event from outbox where kind = 'order.notify' and payload->>'orderId' = ${orderId} order by created_at`).toEqual([{ event: 'shipped' }, { event: 'delivered' }])
  })
  it('a prepaid order needs no cash and stays as it was paid', async () => {
    const { orderId, deliveryId } = await pickedUp('stripe')
    expect(await carry(riders[0]).delivered({ id: deliveryId, code: await codeOf(deliveryId), cashCollected: null, at: clock.toISOString(), key: 'p1' })).toBe(true)
    expect(await latest(orderId)).toMatchObject({ state: 'delivered', cash_collected_at: null })
  })
  it('refuses a wrong code, locks on the fifth, and only the merchant then marks it delivered with a reason', async () => {
    const { orderId, deliveryId } = await pickedUp()
    const code = await codeOf(deliveryId)
    const attempt = (typed: string, key: string) => carry(riders[0]).delivered({ id: deliveryId, code: typed, cashCollected: true, at: clock.toISOString(), key })
    for (let i = 1; i <= 4; i++) await expect(attempt(wrong(code), `w${i}`)).rejects.toMatchObject({ code: 'WRONG_CODE' })
    await expect(attempt(wrong(code), 'w5')).rejects.toMatchObject({ code: 'CODE_LOCKED' })
    await expect(attempt(code, 'w6')).rejects.toMatchObject({ code: 'CODE_LOCKED' })
    expect(await latest(orderId)).toMatchObject({ state: 'picked_up', code_attempts: 5 })
    expect(await db.sql`select count(*)::int as n from activity_log where target_id = ${deliveryId} and action = 'delivery.code_refused'`).toEqual([{ n: 5 }])

    const staff = await world.gql('staff', `mutation { markDeliveryDelivered(deliveryId: "${deliveryId}", reason: "Customer showed ID", cashReceived: true) }`)
    expect(staff.code).toBe('FORBIDDEN')
    const read = await world.gql('owner', `query { order(id: "${orderId}") { delivery { state codeLocked codeUnconfirmedAt } } }`)
    expect(read.data?.['order']).toEqual({ delivery: { state: 'picked_up', codeLocked: true, codeUnconfirmedAt: null } })
    const owner = await world.gql('owner', `mutation { markDeliveryDelivered(deliveryId: "${deliveryId}", reason: "Customer showed ID", cashReceived: true) }`)
    expect(owner.code).toBeUndefined()
    expect((await latest(orderId)).state).toBe('delivered')
    expect(await db.sql`select payment_state from "order" where id = ${orderId}`).toEqual([{ payment_state: 'paid' }])
    expect(await db.sql`select actor_kind,reason from activity_log where target_id = ${deliveryId} and action = 'delivery.delivered'`).toEqual([{ actor_kind: 'person', reason: 'Customer showed ID' }])
  })
  it('lets the merchant confirm only a locked or unconfirmed code, and cash only once said', async () => {
    const { deliveryId } = await pickedUp()
    await expect(carry().merchantDelivered({ id: deliveryId, reason: 'Sure', cashReceived: true }, merchantId)).rejects.toMatchObject({ code: 'CODE_NOT_LOCKED' })
    await db.sql`update delivery set code_attempts = 5 where id = ${deliveryId}`
    await expect(carry().merchantDelivered({ id: deliveryId, reason: 'Sure', cashReceived: null }, merchantId)).rejects.toMatchObject({ code: 'CASH_NOT_CONFIRMED' })
    expect(await carry().merchantDelivered({ id: deliveryId, reason: 'Cash comes tomorrow', cashReceived: false }, null)).toBe(true)
    const [o] = await db.sql<{ payment_state: string }[]>`select o.payment_state from "order" o join delivery d on d.order_id = o.id where d.id = ${deliveryId}`
    expect(o?.payment_state).toBe('pending')
  })
})

describe('steps sent late', () => {
  it('keeps a late Delivered at the rider’s time, answers a resend with the first result, and refuses a time before pickup', async () => {
    const { orderId, deliveryId } = await pickedUp()
    const pickedAt = clock
    const code = await codeOf(deliveryId)
    tick(45 * 60_000)
    const doneAt = new Date(pickedAt.getTime() + 20 * 60_000)
    await expect(carry(riders[0]).delivered({ id: deliveryId, code, cashCollected: true, at: new Date(pickedAt.getTime() - 1000).toISOString(), key: 'late-0' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(carry(riders[0]).delivered({ id: deliveryId, code, cashCollected: true, at: new Date(clock.getTime() + 60_000).toISOString(), key: 'late-0' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(await carry(riders[0]).delivered({ id: deliveryId, code, cashCollected: true, at: doneAt.toISOString(), key: 'late-1' })).toBe(true)
    expect(await latest(orderId)).toMatchObject({ state: 'delivered', delivered_at: doneAt })
    const entries = await db.sql`select count(*)::int as n from activity_log where target_id = ${deliveryId}`
    tick(5_000)
    expect(await carry(riders[0]).delivered({ id: deliveryId, code: '9999', cashCollected: true, at: doneAt.toISOString(), key: 'late-1' })).toBe(true)
    expect(await db.sql`select count(*)::int as n from activity_log where target_id = ${deliveryId}`).toEqual(entries)
    await expect(carry(riders[0]).delivered({ id: deliveryId, code, cashCollected: true, at: doneAt.toISOString(), key: 'late-2' })).rejects.toMatchObject({ code: 'NOT_PICKED_UP' })
  })
  it('a late wrong code is one try: CODE_UNCONFIRMED, the order unpaid, the merchant emailed, until the merchant confirms', async () => {
    const { orderId, deliveryId } = await pickedUp()
    const code = await codeOf(deliveryId)
    const at = clock
    tick(10 * 60_000)
    const send = () => carry(riders[0]).delivered({ id: deliveryId, code: wrong(code), cashCollected: true, at: at.toISOString(), key: 'offline-1' })
    await expect(send()).rejects.toMatchObject({ code: 'CODE_UNCONFIRMED' })
    await expect(send()).rejects.toMatchObject({ code: 'CODE_UNCONFIRMED' })
    expect(await latest(orderId)).toMatchObject({ state: 'picked_up', code_attempts: 1, code_unconfirmed_at: clock, cash_collected_at: at })
    expect(await db.sql`select payment_state from "order" where id = ${orderId}`).toEqual([{ payment_state: 'pending' }])
    expect(await db.sql`select payload->>'template' as template from outbox where kind = 'email' and payload->>'deliveryId' = ${deliveryId}`).toEqual([{ template: 'delivery-code-unconfirmed' }])
    // With signal again the rider can't move it on: the store does.
    await expect(carry(riders[0]).delivered({ id: deliveryId, code, cashCollected: true, at: clock.toISOString(), key: 'online-1' })).rejects.toMatchObject({ code: 'CODE_UNCONFIRMED' })
    expect(await carry().merchantDelivered({ id: deliveryId, reason: 'Called the customer', cashReceived: true }, merchantId)).toBe(true)
    expect(await db.sql`select payment_state from "order" where id = ${orderId}`).toEqual([{ payment_state: 'paid' }])
  })
})

describe('not delivered, recall and retry', () => {
  it('marks it not delivered with a reason, tells the customer, and a retry is a new delivery that moves no stock twice', async () => {
    const { orderId, deliveryId } = await pickedUp()
    const afterPickup = await onHand()
    await expect(carry(riders[0]).failed({ id: deliveryId, reason: 'other', note: null, at: clock.toISOString(), key: 'f0' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(await carry(riders[0]).failed({ id: deliveryId, reason: 'no_one_home', note: null, at: clock.toISOString(), key: 'f1' })).toBe(true)
    expect(await latest(orderId)).toMatchObject({ state: 'failed', failed_reason: 'no_one_home', handover_code_enc: null })
    expect(await db.sql`select payload->>'template' as template from outbox where kind = 'email' and payload->>'orderId' = ${orderId}`).toEqual([{ template: 'order-not-delivered' }])
    expect(await db.sql`select payload->>'message' as message from outbox where kind = 'push' and payload->>'orderId' = ${orderId} order by created_at`).toEqual([{ message: 'order.picked_up' }, { message: 'order.not_delivered' }])

    tick(1000)
    await dispatch().again(deliveryId)
    const retry = await latest(orderId)
    expect(retry.id).not.toBe(deliveryId)
    expect(retry.state).toBe('searching')
    await db.sql`update delivery set state = 'unassigned' where id = ${retry.id}`
    await dispatch().assign(retry.id, riders[1] ?? '')
    await carry(riders[1]).pickUp(retry.id)
    expect(await db.sql`select count(*)::int as n from fulfilment where order_id = ${orderId}`).toEqual([{ n: 1 }])
    expect(await onHand()).toEqual(afterPickup)
    expect((await latest(orderId)).fulfilment_id).not.toBeNull()
    expect(await carry(riders[1]).delivered({ id: retry.id, code: await codeOf(retry.id), cashCollected: true, at: clock.toISOString(), key: 'r1' })).toBe(true)
  })
  it('recalls a parcel in transit: failed as recalled, the rider told, their view of the customer ended', async () => {
    const { orderId, deliveryId } = await pickedUp()
    expect((await world.gql('owner', `mutation { cancelDelivery(deliveryId: "${deliveryId}") }`)).code).toBeUndefined()
    expect(await latest(orderId)).toMatchObject({ state: 'failed', failed_reason: 'recalled', handover_code_enc: null })
    expect(await db.sql`select payload->>'message' as message from outbox where kind = 'push' and payload->>'deliveryId' = ${deliveryId} and payload->'subject'->>'kind' = 'rider' order by created_at desc limit 1`).toEqual([{ message: 'rider.recalled' }])
    const seen = await riderGql(riders[0] ?? '', `{ delivery(id: "${deliveryId}") { state customer { name } lines { name } } }`)
    expect(seen.data?.['delivery']).toEqual({ state: 'failed', customer: null, lines: [] })
    // The order still can't be cancelled while something left it; the return path takes over.
    expect((await world.gql('owner', `query { order(id: "${orderId}") { delivery { failedReason } } }`)).data?.['order']).toEqual({ delivery: { failedReason: 'recalled' } })
  })
})

describe('what a rider reads', () => {
  it('never answers the handover code, and shows the customer only while the parcel is in hand', async () => {
    const { deliveryId } = await assigned()
    const code = await codeOf(deliveryId)
    const query = `{ delivery(id: "${deliveryId}") { id state area cashDueAmount feeAmount currency warehouse { name address { line1 city } latitude } lines { name quantity } customer { name phone note address { line1 } latitude } } deliveries(first: 50) { nodes { id area state } deliveredToday deliveredThisWeek } }`
    const before = await riderGql(riders[0] ?? '', query)
    expect(before.errors).toBeUndefined()
    expect(before.data?.['delivery']).toMatchObject({ area: '302017, Jaipur', cashDueAmount: '10000', feeAmount: '4000', warehouse: { address: { line1: 'Depot road' } }, lines: [{ name: 'Mug', quantity: 2 }], customer: null })
    await riderGql(riders[0] ?? '', `mutation { markPickedUp(id: "${deliveryId}") }`)
    const during = await riderGql(riders[0] ?? '', query)
    expect(during.data?.['delivery']).toMatchObject({ customer: { name: 'Secret Person', phone: '+919822222222', note: 'Ring twice', address: { line1: 'Secret street 1' }, latitude: 26.915 } })
    const done = await riderGql(riders[0] ?? '', `mutation { markDelivered(id: "${deliveryId}", code: "${code}", cashCollected: true, at: "${clock.toISOString()}", key: "read-1") }`)
    expect(done.errors).toBeUndefined()
    const after = await riderGql(riders[0] ?? '', query)
    expect(after.data?.['delivery']).toMatchObject({ state: 'delivered', customer: null, lines: [] })
    for (const answer of [before, during, done, after]) expect(JSON.stringify(answer)).not.toContain(code)
    expect(JSON.stringify(after)).not.toContain('Secret')
  })
  it('holds a rider to its own: the policies refuse another rider’s order, lines and warehouse', async () => {
    const { orderId, deliveryId } = await pickedUp()
    const readAs = (riderId: string) => withScope(db.sql, context(riderId), async (tx) => ({
      order: await tx`select id from "order" where id = ${orderId}`,
      lines: await tx`select id from order_line where order_id = ${orderId}`,
      delivery: await tx`select id from delivery where id = ${deliveryId}`,
    }))
    expect(await readAs(riders[0] ?? '')).toMatchObject({ order: [{ id: orderId }], delivery: [{ id: deliveryId }] })
    expect(await readAs(riders[1] ?? '')).toEqual({ order: [], lines: [], delivery: [] })
    expect((await riderGql(riders[1] ?? '', `{ delivery(id: "${deliveryId}") { id } }`)).data?.['delivery']).toBeNull()
    await expect(withScope(db.sql, context(riders[0]), (tx) => tx`select handover_code_enc from delivery where id = ${deliveryId}`)).rejects.toThrow(/permission denied/)
    const supplier = await world.gql('supplier', `query { order(id: "${orderId}") { delivery { id } } }`)
    expect(supplier.data?.['order'] ?? null).toBeNull()
  })
  it('counts deliveries since the start of the store’s day and its locale’s week', async () => {
    expect([firstDayOfWeek('en-US'), firstDayOfWeek('en-GB'), firstDayOfWeek('not a locale')]).toEqual([7, 1, 1])
    const page = await riderGql(riders[0] ?? '', '{ deliveries(state: [delivered], first: 2) { nodes { state } pageInfo { hasNextPage } deliveredToday deliveredThisWeek } }')
    expect(page.errors).toBeUndefined()
    const listed = page.data?.['deliveries'] as { nodes: { state: string }[]; pageInfo: { hasNextPage: boolean }; deliveredToday: number; deliveredThisWeek: number }
    expect(listed.nodes.every((n) => n.state === 'delivered')).toBe(true)
    const [mine] = await db.sql<{ n: number }[]>`select count(*)::int as n from delivery where rider_id = ${riders[0] ?? ""} and state = 'delivered'`
    expect(listed.deliveredThisWeek).toBe(mine?.n)
    expect(listed.deliveredToday).toBeLessThanOrEqual(listed.deliveredThisWeek)
  })
})
