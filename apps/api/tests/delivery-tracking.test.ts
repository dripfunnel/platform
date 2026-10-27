import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { graphql, type GraphQLSchema } from 'graphql'
import { carryPorts } from '#apis/graphql/carryPorts'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveShopper } from '#auth/shopCaller'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { hashSessionId } from '#auth/session'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { selectShopAsset } from '#db/scoped/shop'
import { cancelOrderDelivery, createCarry, createDispatch, createOwnDelivery, createShopDevices, createTracking, etaKind, etaRefreshMs } from '#engine/modules/ownDelivery/index'
import { RoutesUnavailable, type GoogleRoutes } from '#integrations/googleRoutes/index'
import { deliveryEtaDeliverer } from '#jobs/queues/deliverers/deliveryEta'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { seedStoreWorld } from './support/storeWorld'

// SH 5 (#858): following an own delivery, the arrival estimate's refresh rule, the phones of customers and guest orders, and the
// pushes about it (DELIVERY §6, §7).

let db: TestDatabase
let tenants: Tenants
let secrets: SecretBox
let warehouse = ''
let version = ''
let photo = ''
const riders: string[] = []
let clock = new Date('2026-10-27T12:00:00Z')
const facts = { requestId: 'tracking-test', ip: null, userAgent: null }
const merchantId = '00000000-0000-4000-8000-000000000001'
const tick = (ms: number) => { clock = new Date(clock.getTime() + ms) }

const merchant = (riderId?: string): TenantContext => ({
  partnerId: tenants.partnerA, storeId: tenants.storeA1, sellerScope: { kind: 'all' }, subscription: 'active',
  caller: riderId ? { kind: 'rider', riderId } : { kind: 'person', userId: merchantId, sessionId: 'test' },
})
const base = { sql: () => db.sql, activity: activityLog, facts, now: () => clock, secrets: () => secrets }
const deps = (riderId?: string) => ({ sql: db.sql, context: merchant(riderId), activity: base.activity, facts, now: base.now, secrets })
const carry = (riderId: string) => createCarry({ ...deps(riderId), ports: carryPorts })
const dispatch = () => createDispatch(deps())

const customerContext = (customerId: string, storeId = tenants.storeA1): TenantContext => ({ caller: { kind: 'shopper', customerId, orderTokenHash: null }, partnerId: tenants.partnerA, storeId, sellerScope: { kind: 'all' }, subscription: 'active' })
const guestContext = async (token: string | null, storeId = tenants.storeA1): Promise<TenantContext> => ({ caller: { kind: 'shopper', customerId: null, orderTokenHash: token ? await hashSessionId(token) : null }, partnerId: tenants.partnerA, storeId, sellerScope: { kind: 'all' }, subscription: 'active' })
const tracking = (context: TenantContext, estimates = true) => createTracking({ sql: db.sql, context, secrets, estimates, now: () => clock })
const devices = (context: TenantContext) => createShopDevices({ sql: db.sql, context, activity: activityLog, facts, now: () => clock })

const customer = async (email: string, storeId = tenants.storeA1) =>
  (await db.sql<{ id: string }[]>`insert into customer (store_id, email, name, status) values (${storeId}, ${email}, 'Shopper', 'active') returning id`)[0]?.id ?? ''

/** An own-delivery order held by a signed-in customer, or by a guest's token, with its delivery searching for a rider. */
const placed = async (owner: { customerId: string } | { token: string }) => {
  const tokenHash = 'token' in owner ? await hashSessionId(owner.token) : null
  const customerId = 'customerId' in owner ? owner.customerId : null
  const [o] = await db.sql<{ id: string }[]>`insert into "order"(store_id,state,number,currency,payment_method,payment_state,shipping_option,delivery_warehouse_id,total_amount,shipping_amount,placed_at,email,phone,stock_reserved,customer_id,access_token_hash,shipping_address)
    values (${tenants.storeA1},'placed',${crypto.randomUUID().slice(0, 8)},'INR','cod','pending','own_delivery',${warehouse},10000,4000,${clock},'shopper@example.com','+919811111111',true,${customerId},${tokenHash},
      ${db.sql.json({ name: 'Ana', line1: '1 Lake Rd', city: 'Jaipur', postalCode: '302017', country: 'IN', latitude: 26.915, longitude: 75.79 })}) returning id`
  if (!o) throw new Error('no order')
  const [v] = await db.sql<{ product_id: string }[]>`select product_id from product_version where id = ${version}`
  await db.sql`insert into order_part(order_id,store_id,seller_id,shipping_mode) values(${o.id},${tenants.storeA1},null,'store')`
  await db.sql`insert into order_line(order_id,store_id,version_id,product_id,name,quantity,unit_amount,line_total_amount,reserved_warehouse_id) values(${o.id},${tenants.storeA1},${version},${v?.product_id ?? ''},'Mug',1,3000,3000,${warehouse})`
  await db.sql`update stock_level set reserved = reserved + 1 where version_id = ${version} and warehouse_id = ${warehouse}`
  await db.sql`insert into payment(store_id,order_id,provider,kind,amount,currency,mode) values(${tenants.storeA1},${o.id},'cod','cod',10000,'INR','live')`
  await withSystemScope(db.sql, (tx) => createOwnDelivery(tx, activityLog, tenants.storeA1, o.id, clock))
  const [d] = await db.sql<{ id: string }[]>`select id from delivery where order_id = ${o.id} order by created_at desc limit 1`
  return { orderId: o.id, deliveryId: d?.id ?? '' }
}
const assign = async (deliveryId: string, rider = riders[0] ?? '') => {
  await db.sql`update delivery set state = 'unassigned' where id = ${deliveryId}`
  await dispatch().assign(deliveryId, rider)
}
const position = (rider = riders[0] ?? '') =>
  db.sql`insert into rider_position(rider_id,store_id,latitude,longitude,accuracy_m,reported_at,received_at) values(${rider},${tenants.storeA1},26.9124,75.7873,5,${clock},${clock})
    on conflict (rider_id) do update set latitude = excluded.latitude, longitude = excluded.longitude, reported_at = excluded.reported_at, received_at = excluded.received_at`
const codeOf = async (deliveryId: string) => {
  const [row] = await db.sql<{ handover_code_enc: string | null }[]>`select handover_code_enc from delivery where id = ${deliveryId}`
  return (row?.handover_code_enc ? await secrets.open(row.handover_code_enc) : null)?.split(':')[1] ?? ''
}
const etaJobs = async (deliveryId: string) => (await db.sql<{ id: string }[]>`select id from outbox where kind = ${etaKind} and payload->>'deliveryId' = ${deliveryId}`).length
const pushes = async (orderId: string) => (await db.sql<{ message: string; kind: string }[]>`select payload->>'message' as message, payload->'subject'->>'kind' as kind from outbox where kind = 'push' and payload->>'orderId' = ${orderId} order by created_at, id`)

beforeAll(async () => {
  db = await createTestDatabase()
  tenants = await seedTenants(db.sql)
  secrets = await secretBox(btoa('k'.repeat(32)))
  await seedStoreWorld(db.sql, tenants, { now: () => clock, secrets, lookup: null })
  const [w] = await db.sql<{ id: string }[]>`select id from warehouse where store_id = ${tenants.storeA1} and seller_id is null limit 1`
  warehouse = w?.id ?? ''
  await db.sql`update warehouse set latitude = 26.9124, longitude = 75.7873, address = ${db.sql.json({ line1: 'Depot road', city: 'Jaipur', country: 'IN' })} where id = ${warehouse}`
  await db.sql`insert into store_shipping(store_id,currency,own_delivery_enabled,dispatch_when,offer_minutes) values(${tenants.storeA1},'INR',true,'placed',5) on conflict(store_id) do update set own_delivery_enabled = true,dispatch_when = 'placed',offer_minutes = 5`
  const [p] = await db.sql<{ id: string }[]>`insert into product(store_id,name,slug,visibility) values(${tenants.storeA1},'Mug','track-mug','visible') returning id`
  const [v] = await db.sql<{ id: string }[]>`insert into product_version(store_id,product_id,sku,position,track_stock) values(${tenants.storeA1},${p?.id ?? ''},'TRACK-MUG',0,true) returning id`
  version = v?.id ?? ''
  await db.sql`insert into stock_level(version_id,warehouse_id,store_id,seller_id,on_hand) values(${version},${warehouse},${tenants.storeA1},null,100)`
  photo = (await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum) values (${tenants.storeA1}, ${`stores/${tenants.storeA1}/assets/${crypto.randomUUID()}.png`}, 'image', 'image/png', 1, ${'0'.repeat(64)}) returning id`)[0]?.id ?? ''
  for (let i = 0; i < 2; i++) {
    const [r] = await db.sql<{ id: string }[]>`insert into rider(store_id,name,phone,status,vehicle_type,vehicle_number,photo_asset_id) values(${tenants.storeA1},${`Rider${i} Singh`},${`+91970000000${i}`},'active','bike',${`RJ14 000${i}`},${i === 0 ? photo : null}) returning id`
    riders.push(r?.id ?? '')
  }
}, 60_000)
afterAll(async () => { await db?.drop() })

describe('what the order’s customer reads, state by state', () => {
  it('shows each field only while its state shows it, and nothing once the delivery ends', async () => {
    const token = 'guest-a'
    const { orderId, deliveryId } = await placed({ token })
    const read = async () => tracking(await guestContext(token)).read(orderId)

    const searching = await read()
    expect(searching).toMatchObject({ state: 'searching', rider: null, position: null, etaAt: null, handoverCode: null })
    expect(searching?.steps.map((s) => s.state)).toEqual(['packing', 'searching'])

    await assign(deliveryId)
    const assigned = await read()
    expect(assigned).toMatchObject({ state: 'assigned', position: null, etaAt: null })
    expect(assigned?.rider).toEqual({ firstName: 'Rider0', phone: '+919700000000', photoAssetId: photo, vehicleType: 'bike', vehicleNumber: 'RJ14 0000' })
    expect(assigned?.handoverCode).toMatch(/^\d{4}$/)
    expect(assigned?.handoverCode).toBe(await codeOf(deliveryId))

    await position()
    tick(60_000)
    await carry(riders[0] ?? '').pickUp(deliveryId)
    const onTheWay = await read()
    expect(onTheWay).toMatchObject({ state: 'picked_up', position: { latitude: 26.9124, longitude: 75.7873 }, handoverCode: await codeOf(deliveryId) })
    expect(onTheWay?.rider?.firstName).toBe('Rider0')

    tick(60_000)
    await carry(riders[0] ?? '').delivered({ id: deliveryId, code: await codeOf(deliveryId), cashCollected: true, at: clock.toISOString(), key: 'track-1' })
    const done = await read()
    expect(done).toMatchObject({ state: 'delivered', rider: null, position: null, etaAt: null, handoverCode: null })
    expect(done?.steps.map((s) => s.state)).toEqual(['packing', 'searching', 'assigned', 'picked_up', 'delivered'])
    await db.sql`delete from rider_position where rider_id = ${riders[0] ?? ''}`
  })

  it('drops the rider and the code when the delivery fails or is cancelled', async () => {
    const token = 'guest-b'
    const failed = await placed({ token })
    await assign(failed.deliveryId)
    await carry(riders[0] ?? '').pickUp(failed.deliveryId)
    await carry(riders[0] ?? '').failed({ id: failed.deliveryId, reason: 'refused', note: null, at: clock.toISOString(), key: 'fail-1' })
    expect(await tracking(await guestContext(token)).read(failed.orderId)).toMatchObject({ state: 'failed', rider: null, position: null, handoverCode: null })

    const cancelled = await placed({ token: 'guest-c' })
    await assign(cancelled.deliveryId, riders[1] ?? '')
    await withSystemScope(db.sql, (tx) => cancelOrderDelivery(tx, { storeId: tenants.storeA1, partnerId: tenants.partnerA, activity: activityLog, now: clock }, cancelled.orderId))
    expect(await tracking(await guestContext('guest-c')).read(cancelled.orderId)).toMatchObject({ state: 'cancelled', rider: null, handoverCode: null })
  })

  it('reads a signed-in customer’s order by their account', async () => {
    const ana = await customer('ana@example.com')
    const { orderId, deliveryId } = await placed({ customerId: ana })
    await assign(deliveryId)
    const view = await tracking(customerContext(ana)).read(orderId)
    expect(view?.handoverCode).toBe(await codeOf(deliveryId))
    expect(view?.rider?.firstName).toBe('Rider0')
  })
})

describe('who reads it', () => {
  it('gives the code and the rider to the order’s own reader only', async () => {
    const ana = await customer('ana2@example.com')
    const bo = await customer('bo@example.com')
    const { orderId, deliveryId } = await placed({ customerId: ana })
    await assign(deliveryId, riders[1] ?? '')
    expect((await tracking(customerContext(ana)).read(orderId))?.handoverCode).toMatch(/^\d{4}$/)
    // Another customer of the store, another store's customer, and the guest paths: nothing, not even that there is a delivery.
    expect(await tracking(customerContext(bo)).read(orderId)).toBeNull()
    expect(await tracking(customerContext(await customer('ana2@example.com', tenants.storeA2), tenants.storeA2)).read(orderId)).toBeNull()
    expect(await tracking(await guestContext(null)).read(orderId)).toBeNull()
    expect(await tracking(await guestContext('a-guess')).read(orderId)).toBeNull()
  })

  it('shows a guest only the order its token was placed with', async () => {
    const mine = await placed({ token: 'mine-1' })
    const theirs = await placed({ token: 'theirs-1' })
    await assign(mine.deliveryId, riders[1] ?? '')
    expect(await tracking(await guestContext('mine-1')).read(mine.orderId)).not.toBeNull()
    expect(await tracking(await guestContext('mine-1')).read(theirs.orderId)).toBeNull()
  })

  it('grants a shopper no column of the delivery that is not on the card, and never the sealed code', async () => {
    const context = await guestContext('mine-1')
    await expect(withScope(db.sql, context, (tx) => tx`select handover_code_enc from delivery`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, context, (tx) => tx`select code_attempts from delivery`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, context, (tx) => tx`select cash_due_amount from delivery`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, context, (tx) => tx`update delivery set state = 'delivered'`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, context, (tx) => tx`select accuracy_m from rider_position`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, context, (tx) => tx`select status from rider`)).rejects.toThrow(/permission denied/)
  })

  it('shows a rider’s details only while its delivery is held, and its photo only to that order with no shared caching', async () => {
    const ana = await customer('ana3@example.com')
    const { orderId, deliveryId } = await placed({ customerId: ana })
    const bo = await customer('bo3@example.com')
    const asset = (who: TenantContext) => withScope(db.sql, who, (tx) => selectShopAsset(tx, tenants.storeA1, photo))
    expect(await asset(customerContext(ana))).toBeNull()
    await assign(deliveryId)
    expect(await asset(customerContext(ana))).toMatchObject({ rider_photo: true })
    expect(await asset(customerContext(bo))).toBeNull()
    expect(await withScope(db.sql, customerContext(bo), (tx) => tx`select name from rider`)).toHaveLength(0)
    await db.sql`update delivery set state = 'cancelled', cancelled_at = ${clock} where id = ${deliveryId}`
    expect(await asset(customerContext(ana))).toBeNull()
    expect((await tracking(customerContext(ana)).read(orderId))?.rider).toBeNull()
  })
})

describe('the arrival estimate', () => {
  const onTheWay = async (token: string) => {
    const o = await placed({ token })
    await assign(o.deliveryId, riders[1] ?? '')
    await position(riders[1] ?? '')
    await carry(riders[1] ?? '').pickUp(o.deliveryId)
    return { ...o, context: await guestContext(token) }
  }

  it('is asked for once at pickup, and not again until a reader finds it older than two minutes', async () => {
    const { orderId, deliveryId, context } = await onTheWay('eta-1')
    expect(await etaJobs(deliveryId)).toBe(1)
    // Nobody reads for a while: nothing is asked, however long it is.
    tick(10 * 60_000)
    expect(await etaJobs(deliveryId)).toBe(1)
    // A first read finds it stale and queues one; a second, at once, finds it claimed.
    await tracking(context).read(orderId)
    await tracking(context).read(orderId)
    expect(await etaJobs(deliveryId)).toBe(2)
    tick(etaRefreshMs - 1000)
    await tracking(context).read(orderId)
    expect(await etaJobs(deliveryId)).toBe(2)
    tick(1000)
    await tracking(context).read(orderId)
    expect(await etaJobs(deliveryId)).toBe(3)
  })

  it('is never asked for without a Routes key, or without a position to ask from, or before pickup', async () => {
    const { orderId, deliveryId, context } = await onTheWay('eta-2')
    tick(5 * 60_000)
    await tracking(context, false).read(orderId)
    expect(await etaJobs(deliveryId)).toBe(1)
    await db.sql`delete from rider_position where rider_id = ${riders[1] ?? ''}`
    await tracking(context).read(orderId)
    expect(await etaJobs(deliveryId)).toBe(1)

    const beforePickup = await placed({ token: 'eta-3' })
    await assign(beforePickup.deliveryId, riders[0] ?? '')
    await tracking(await guestContext('eta-3')).read(beforePickup.orderId)
    expect(await etaJobs(beforePickup.deliveryId)).toBe(0)
  })

  it('is stored by the job from the rider’s point to the order’s pin, shown only while picked up, and left empty when Google has none', async () => {
    const { orderId, deliveryId, context } = await onTheWay('eta-4')
    const asked: unknown[] = []
    const routes: GoogleRoutes = { durationSeconds: async (from, to) => { asked.push({ from, to }); return 754 } }
    const effect = { id: crypto.randomUUID(), kind: etaKind, idempotencyKey: 'k', payload: { deliveryId }, partnerId: tenants.partnerA, storeId: tenants.storeA1, attempt: 1 }
    await deliveryEtaDeliverer(db.sql, routes, () => clock).deliver(effect, new AbortController().signal)
    expect(asked).toEqual([{ from: { latitude: 26.9124, longitude: 75.7873 }, to: { latitude: 26.915, longitude: 75.79 } }])
    expect((await tracking(context, false).read(orderId))?.etaAt).toEqual(new Date(clock.getTime() + 754_000))

    const before = (await tracking(context, false).read(orderId))?.etaAt
    tick(60_000)
    await deliveryEtaDeliverer(db.sql, { durationSeconds: async () => { throw new RoutesUnavailable('down') } }, () => clock).deliver(effect, new AbortController().signal)
    await deliveryEtaDeliverer(db.sql, { durationSeconds: async () => null }, () => clock).deliver(effect, new AbortController().signal)
    await deliveryEtaDeliverer(db.sql, null, () => clock).deliver(effect, new AbortController().signal)
    expect((await tracking(context, false).read(orderId))?.etaAt).toEqual(before)

    await db.sql`update delivery set state = 'delivered', delivered_at = ${clock} where id = ${deliveryId}`
    expect((await tracking(context, false).read(orderId))?.etaAt).toBeNull()
  })
})

describe('the phones of customers and guest orders', () => {
  const token = 'ExponentPushToken[abc123_def-456]'
  const other = 'ExponentPushToken[zzz999]'
  const rows = () => db.sql<{ subject_kind: string; subject_id: string; platform: string }[]>`select subject_kind, subject_id, platform from push_device where expo_token = ${token} and store_id = ${tenants.storeA1}`

  it('registers a signed-in customer’s phone for every order, and moves it to whoever registers it next', async () => {
    const ana = await customer('ana4@example.com')
    const bo = await customer('bo4@example.com')
    expect(await devices(customerContext(ana)).register({ token, platform: 'android' })).toEqual({ ok: true, value: true })
    expect(await rows()).toEqual([{ subject_kind: 'customer', subject_id: ana, platform: 'android' }])
    await devices(customerContext(ana)).register({ token, platform: 'android' })
    await devices(customerContext(bo)).register({ token, platform: 'ios' })
    expect(await rows()).toEqual([{ subject_kind: 'customer', subject_id: bo, platform: 'ios' }])
    // Another customer's unregister of it deletes nothing, and says so no differently.
    expect(await devices(customerContext(ana)).unregister({ token })).toEqual({ ok: true, value: true })
    expect(await rows()).toHaveLength(1)
    await devices(customerContext(bo)).unregister({ token })
    expect(await rows()).toHaveLength(0)
  })

  it('registers a guest’s phone for the order they hold the token of, and for no other', async () => {
    const mine = await placed({ token: 'phone-guest' })
    const theirs = await placed({ token: 'phone-other' })
    const guest = await guestContext('phone-guest')
    expect(await devices(guest).register({ token, platform: 'ios', orderId: mine.orderId })).toEqual({ ok: true, value: true })
    expect(await rows()).toEqual([{ subject_kind: 'order', subject_id: mine.orderId, platform: 'ios' }])
    expect(await devices(guest).register({ token: other, platform: 'ios', orderId: theirs.orderId })).toEqual({ ok: false, reason: 'NOT_FOUND' })
    expect(await devices(guest).register({ token: other, platform: 'ios' })).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    expect(await devices(await guestContext(null)).register({ token: other, platform: 'ios', orderId: mine.orderId })).toEqual({ ok: false, reason: 'SIGNED_OUT' })
    expect(await devices(await guestContext('phone-guest', tenants.storeA2)).register({ token: other, platform: 'ios', orderId: mine.orderId })).toEqual({ ok: false, reason: 'NOT_FOUND' })
    expect(await db.sql`select 1 from push_device where expo_token = ${other}`).toHaveLength(0)
    await devices(guest).unregister({ token, orderId: mine.orderId })
    expect(await rows()).toHaveLength(0)
  })

  it('refuses a token that is not an Expo push token, and logs a new phone without ever writing the token', async () => {
    const ana = await customer('ana5@example.com')
    expect(await devices(customerContext(ana)).register({ token: 'not-a-token', platform: 'ios' })).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    expect(await devices(customerContext(ana)).register({ token, platform: 'blackberry' })).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    await devices(customerContext(ana)).register({ token, platform: 'android' })
    await devices(customerContext(ana)).unregister({ token })
    const log = await db.sql<{ action: string; api: string; actor_kind: string; changes: unknown }[]>`select action, api, actor_kind, changes from activity_log where action like 'customer.push_device_%' and customer_id = ${ana} order by occurred_at, id`
    expect(log.map((l) => [l.action, l.api, l.actor_kind])).toEqual([['customer.push_device_registered', 'shop', 'customer'], ['customer.push_device_removed', 'shop', 'customer']])
    expect(JSON.stringify(log)).not.toContain('abc123')
  })
})

describe('the pushes about the delivery', () => {
  it('queues rider assigned, picked up, delivered and not delivered for the customer, and the same for a guest order', async () => {
    const ana = await customer('ana6@example.com')
    const signedIn = await placed({ customerId: ana })
    await assign(signedIn.deliveryId)
    await carry(riders[0] ?? '').pickUp(signedIn.deliveryId)
    await carry(riders[0] ?? '').delivered({ id: signedIn.deliveryId, code: await codeOf(signedIn.deliveryId), cashCollected: true, at: clock.toISOString(), key: 'push-1' })
    expect(await pushes(signedIn.orderId)).toEqual([
      { message: 'order.rider_assigned', kind: 'customer' }, { message: 'order.picked_up', kind: 'customer' }, { message: 'order.delivered', kind: 'customer' },
    ])

    const guest = await placed({ token: 'push-guest' })
    await assign(guest.deliveryId, riders[1] ?? '')
    await carry(riders[1] ?? '').pickUp(guest.deliveryId)
    await carry(riders[1] ?? '').failed({ id: guest.deliveryId, reason: 'no_one_home', note: null, at: clock.toISOString(), key: 'push-2' })
    expect((await pushes(guest.orderId)).map((p) => [p.message, p.kind])).toEqual([['order.rider_assigned', 'order'], ['order.picked_up', 'order'], ['order.not_delivered', 'order']])
  })

  it('tells the customer of a new rider after a hand-back, once for each assignment and not at the hand-back', async () => {
    const { orderId, deliveryId } = await placed({ token: 'handback' })
    await assign(deliveryId, riders[0] ?? '')
    await carry(riders[0] ?? '').handBack(deliveryId)
    expect((await pushes(orderId)).map((p) => p.message)).toEqual(['order.rider_assigned'])
    await assign(deliveryId, riders[1] ?? '')
    expect((await pushes(orderId)).map((p) => p.message)).toEqual(['order.rider_assigned', 'order.rider_assigned'])
    expect((await tracking(await guestContext('handback')).read(orderId))?.rider?.firstName).toBe('Rider1')
  })

  it('carries no handover code in any push payload or email wording, and no free text', async () => {
    const { orderId, deliveryId } = await placed({ token: 'nocode' })
    await assign(deliveryId, riders[0] ?? '')
    const code = await codeOf(deliveryId)
    const payloads = await db.sql<{ payload: unknown }[]>`select payload from outbox where kind in ('push', 'order.notify') and payload::text like ${`%${orderId}%`}`
    expect(JSON.stringify(payloads)).not.toContain(code)
    expect(Object.keys((payloads[0]?.payload ?? {}) as object).sort()).toEqual(['message', 'orderId', 'subject'])
  })
})

describe('through the Shop API', () => {
  // The cart token header is 64 hex characters (auth/shopCaller.ts).
  const guestToken = 'a'.repeat(64)
  const phoneToken = 'b'.repeat(64)
  const host = async () => `${(await db.sql<{ code: string }[]>`select code from store where id = ${tenants.storeA1}`)[0]?.code ?? ''}.shop.example`
  const shop = async (source: string, cart: string | null) => {
    await db.sql`update partner set state = 'live' where id = ${tenants.partnerA}`
    const found = await resolveShopper(db.sql, new Request(`https://${await host()}/shop-api`, { headers: cart ? { 'x-shop-cart': cart } : {} }), await host(), 'shop.example')
    if (found.kind !== 'found') throw new Error('no store')
    const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${await host()}`, activity: activityLog, facts, couriers: null, secrets, estimates: false, allowAttempt: async () => true, allowNewCart: async () => true, now: () => clock }
    const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
    return { data: result.data as ShopData | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
  }
  type ShopData = { order?: { delivery: ({ rider: { photoUrl: string } } & Record<string, unknown>) | null } | null; registerPushDevice?: boolean; unregisterPushDevice?: boolean }
  const query = (orderId: string) => `{ order(id: "${orderId}") { delivery { state handoverCode steps { state } rider { firstName phone photoUrl vehicleType vehicleNumber } position { latitude } etaAt } } }`

  it('answers order(id).delivery to the guest who holds the order’s token, and nothing to anyone else', async () => {
    const { orderId, deliveryId } = await placed({ token: guestToken })
    await assign(deliveryId)
    const delivery = (await shop(query(orderId), guestToken)).data?.['order']?.delivery
    expect(delivery).toMatchObject({ state: 'assigned', handoverCode: await codeOf(deliveryId), rider: { firstName: 'Rider0', phone: '+919700000000', vehicleType: 'bike', vehicleNumber: 'RJ14 0000' }, position: null, etaAt: null })
    expect(delivery?.rider.photoUrl).toBe(`https://${await host()}/shop-api/assets/${photo}`)
    expect((await shop(query(orderId), null)).data?.['order']).toBeNull()
    expect((await shop(query(orderId), 'f'.repeat(64))).data?.['order']).toBeNull()
  })

  it('registers and unregisters a guest order’s phone, refusing a guest who does not hold the order', async () => {
    const { orderId } = await placed({ token: phoneToken })
    const token = 'ExponentPushToken[gql_phone_1]'
    const mutation = (name: string, extra = '') => `mutation { ${name}(token: "${token}", ${extra} orderId: "${orderId}") }`
    expect((await shop(mutation('registerPushDevice', 'platform: ios,'), phoneToken)).data?.['registerPushDevice']).toBe(true)
    expect(await db.sql`select subject_kind, subject_id from push_device where expo_token = ${token}`).toEqual([{ subject_kind: 'order', subject_id: orderId }])
    expect((await shop(mutation('registerPushDevice', 'platform: ios,'), 'e'.repeat(64))).code).toBe('NOT_FOUND')
    expect((await shop(mutation('registerPushDevice', 'platform: ios,'), null)).code).toBe('SIGNED_OUT')
    expect((await shop(mutation('unregisterPushDevice'), phoneToken)).data?.['unregisterPushDevice']).toBe(true)
    expect(await db.sql`select 1 from push_device where expo_token = ${token}`).toHaveLength(0)
  })
})
