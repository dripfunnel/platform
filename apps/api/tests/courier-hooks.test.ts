import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import type { AssetStore } from '#engine/modules/catalog/index'
import { courierHookOf, handleCourierHook } from '#hooks/couriers'
import { courierTrackDeliverer, courierTrackKind, queueCourierTracking } from '#jobs/queues/deliverers/courierTrack'
import { localCouriers, localCourierHookSecret } from '#integrations/local/index'
import { activityLog } from '#saas/activity/index'
import { CourierRejected, type CourierDirectory, type TrackingEvent } from '#core/couriers'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #311 (SAPI 12), part 2: a test label booked through the local stand-in and tracked by its courier's hook, verified
// with the store's secret and applied once, forward in time, to that store's parcels only (FIRST-RELEASE §19; #1489).

let db: TestDatabase
let t: Tenants
type Who = 'owner' | 'drop'
const cookies = {} as Record<Who, string>
let main = ''
let dropPlace = ''
let house = ''
let scarf = ''
const couriers = localCouriers()
const files: AssetStore = { put: async () => undefined, get: async () => null }

const gql = async (source: string, who: Who) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: t.storeA1, ...(who === 'drop' ? { [supplierHeader]: t.sellerA1First } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, couriers, files, now: () => new Date() }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

const post = async (path: string, body: string, headers: Record<string, string>, allow: (key: string) => Promise<boolean> = async () => true) => {
  const hook = courierHookOf(path)
  if (!hook) return 404
  const response = await handleCourierHook(new Request(`https://hooks.example${path}`, { method: 'POST', body, headers }), hook, { sql: db.sql, activity: activityLog, couriers }, allow)
  return response.status
}
const shiprocket = (storeId: string, awb: string, status: string, at: string, token = localCourierHookSecret) =>
  post(`/couriers/shiprocket/${storeId}`, JSON.stringify({ awb, current_status: status, current_timestamp: at, order_id: 'x' }), { 'x-api-key': token })
const signed = async (body: string, secret = localCourierHookSecret) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
  return `hmac-sha256-hex=${[...mac].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}
const shipment = async (id: string) =>
  (await db.sql<{ tracking_status: string | null; tracking_status_at: Date | null; delivered_at: Date | null }[]>`select tracking_status, tracking_status_at, delivered_at from fulfilment where id = ${id}`)[0]
const delivered = (orderId: string) => db.sql`select payload from outbox where kind = 'order.notify' and payload ->> 'event' = 'delivered' and payload ->> 'orderId' = ${orderId}`

const order = async (number: string, lines: { version: string; seller: string | null; at: string }[]) => {
  const [row] = await db.sql<{ id: string }[]>`
    insert into "order" (store_id, state, payment_state, currency, number, placed_at, total_amount, payment_method, shipping_option, email, phone, shipping_address)
    values (${t.storeA1}, 'placed', 'pending', 'INR', ${number}, now(), 1000, 'cod', 'courier', 'priya@example.com', '+919800000001',
      ${db.sql.json({ name: 'Priya Shah', line1: '1 MG Road', line2: null, city: 'Pune', region: 'Maharashtra', postalCode: '411001', country: 'IN', phone: '+919800000001' })})
    returning id`
  const id = row?.id ?? ''
  for (const [position, l] of lines.entries()) {
    await db.sql`insert into order_line (order_id, store_id, seller_id, version_id, product_id, name, quantity, unit_amount, line_total_amount, position)
      select ${id}, ${t.storeA1}, ${l.seller}, v.id, v.product_id, 'Kurta', 1, 49900, 49900, ${position} from product_version v where v.id = ${l.version}`
  }
  for (const seller of new Set(lines.map((l) => l.seller))) await db.sql`insert into order_part (order_id, store_id, seller_id, shipping_mode) values (${id}, ${t.storeA1}, ${seller}, ${seller ? 'to-shopper' : 'store'})`
  await db.sql`insert into payment (order_id, store_id, provider, kind, state, amount, currency, mode) values (${id}, ${t.storeA1}, 'cod', 'cod', 'pending', 1000, 'INR', 'live')`
  const ids: string[] = []
  for (const l of lines) {
    const line = (await db.sql<{ id: string }[]>`select id from order_line where order_id = ${id} and version_id = ${l.version}`)[0]?.id ?? ''
    const made = await gql(`mutation { bookLabel(orderId: "${id}", warehouseId: "${l.at}", courier: "shiprocket", lines: [{ lineId: "${line}", quantity: 1 }]) }`, l.seller ? 'drop' : 'owner')
    expect(made.code).toBeUndefined()
    ids.push(String(made.data?.['bookLabel']))
  }
  return { id, shipments: ids }
}
const awbOf = async (fulfilmentId: string) => (await db.sql<{ n: string }[]>`select tracking_number as n from fulfilment where id = ${fulfilmentId}`)[0]?.n ?? ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set country = 'IN', address = ${db.sql.json({ street: '4 Johari Bazaar', city: 'Jaipur', postal: '302003', region: 'Rajasthan' })} where id = ${t.storeA1}`
  await db.sql`insert into store_courier (store_id, provider, role, label_size) values (${t.storeA1}, 'shiprocket', 'pricing', 'a6')`
  await db.sql`update seller set shipping_mode = 'to-shopper', access_level = 'vendor-orders-fulfil' where id = ${t.sellerA1First}`
  main = (await db.sql<{ id: string }[]>`select id from warehouse where store_id = ${t.storeA1} and seller_id is null and is_default`)[0]?.id ?? ''
  dropPlace = (await db.sql<{ id: string }[]>`insert into warehouse (store_id, seller_id, name, is_default, address) values (${t.storeA1}, ${t.sellerA1First}, 'Anand works', true,
    ${db.sql.json({ line1: '9 Udyog Vihar', city: 'Gurugram', postalCode: '122016', country: 'IN' })}) returning id`)[0]?.id ?? ''
  const version = async (seller: string | null, sku: string) => {
    const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, seller_id, name, slug, visibility) values (${t.storeA1}, ${seller}, ${sku}, ${sku}, 'visible') returning id`
    return (await db.sql<{ id: string }[]>`insert into product_version (store_id, seller_id, product_id, sku, position, track_stock) values (${t.storeA1}, ${seller}, ${p?.id ?? ''}, ${sku}, 0, false) returning id`)[0]?.id ?? ''
  }
  house = await version(null, 'house')
  scarf = await version(t.sellerA1First, 'scarf')
  const person = async (email: string, role: string, seller: string | null) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, ${email}, 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${u?.id ?? ''}, ${t.storeA1}, ${seller}, ${role}, 'active')`
    return withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
  }
  cookies.owner = await person('owner@a1.example', 'owner', null)
  cookies.drop = await person('anand@a1.example', 'supplier-admin', t.sellerA1First)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('a test label booked and tracked', () => {
  it('moves the parcel on with each verified status, tells the shopper of the delivery once, and never goes back', async () => {
    const { id, shipments } = await order('T-1', [{ version: house, seller: null, at: main }])
    const [parcel = ''] = shipments
    const awb = await awbOf(parcel)
    expect(awb).toMatch(/^LOCAL/)
    expect(await shiprocket(t.storeA1, awb, 'PICKUP SCHEDULED', '2026-10-11 09:00:00')).toBe(200)
    expect((await shipment(parcel))?.tracking_status).toBeNull()
    expect(await shiprocket(t.storeA1, awb, 'IN TRANSIT', '2026-10-11 18:00:00')).toBe(200)
    expect(await shipment(parcel)).toMatchObject({ tracking_status: 'in_transit', tracking_status_at: new Date('2026-10-11T12:30:00Z'), delivered_at: null })
    expect(await shiprocket(t.storeA1, awb, 'DELIVERED', '2026-10-12 11:00:00')).toBe(200)
    // The same hook again, and an older one arriving late, change nothing.
    expect(await shiprocket(t.storeA1, awb, 'DELIVERED', '2026-10-12 11:00:00')).toBe(200)
    expect(await shiprocket(t.storeA1, awb, 'IN TRANSIT', '2026-10-11 20:00:00')).toBe(200)
    expect(await shipment(parcel)).toMatchObject({ tracking_status: 'delivered', delivered_at: new Date('2026-10-12T05:30:00Z') })
    expect(await delivered(id)).toEqual([{ payload: { event: 'delivered', orderId: id, fulfilmentId: parcel } }])
    const entries = await db.sql`select action, actor_kind, seller_id from activity_log where target_id = ${id} and action = 'order.delivered'`
    expect(entries).toEqual([{ action: 'order.delivered', actor_kind: 'job', seller_id: null }])
    const read = (await gql(`{ order(id: "${id}") { shipments { trackingStatus deliveredAt } } }`, 'owner')).data?.['order'] as { shipments: unknown[] }
    expect(read.shipments).toEqual([{ trackingStatus: 'delivered', deliveredAt: '2026-10-12T05:30:00.000Z' }])
  })

  it('never moves a parcel delivered in the past back with a hook that has no time of the courier’s own', async () => {
    const { shipments } = await order('T-5', [{ version: house, seller: null, at: main }])
    const [parcel = ''] = shipments
    const awb = await awbOf(parcel)
    expect(await shiprocket(t.storeA1, awb, 'DELIVERED', '2026-01-05 11:00:00')).toBe(200)
    for (const time of [undefined, 'soon']) {
      expect(await post(`/couriers/shiprocket/${t.storeA1}`, JSON.stringify({ awb, current_status: 'IN TRANSIT', current_timestamp: time }), { 'x-api-key': localCourierHookSecret })).toBe(200)
    }
    expect(await shipment(parcel)).toMatchObject({ tracking_status: 'delivered', delivered_at: new Date('2026-01-05T05:30:00Z') })
  })

  it('refuses a hook without the store’s token, and applies another store’s hook to none of this store’s parcels, a store of the same partner included', async () => {
    const { shipments } = await order('T-2', [{ version: house, seller: null, at: main }])
    const [parcel = ''] = shipments
    const awb = await awbOf(parcel)
    expect(await shiprocket(t.storeA1, awb, 'DELIVERED', '2026-10-12 11:00:00', 'wrong')).toBe(400)
    expect(await post(`/couriers/shiprocket/${t.storeA1}`, JSON.stringify({ awb, current_status: 'DELIVERED' }), {})).toBe(400)
    expect(await shiprocket(t.storeB1, awb, 'DELIVERED', '2026-10-12 11:00:00')).toBe(200)
    expect(await shiprocket(t.storeA2, awb, 'DELIVERED', '2026-10-12 11:00:00')).toBe(200)
    expect(await shipment(parcel)).toMatchObject({ tracking_status: null, delivered_at: null })
    expect(await post(`/couriers/shiprocket/${crypto.randomUUID()}`, JSON.stringify({ awb, current_status: 'DELIVERED' }), { 'x-api-key': localCourierHookSecret })).toBe(400)
  })

  it('tells a supplier’s parcel’s delivery in the store’s log and the supplier’s own', async () => {
    const { id, shipments } = await order('T-3', [{ version: scarf, seller: t.sellerA1First, at: dropPlace }])
    expect(await shiprocket(t.storeA1, await awbOf(shipments[0] ?? ''), 'DELIVERED', '2026-10-12 11:00:00')).toBe(200)
    const entries = await db.sql`select seller_id from activity_log where target_id = ${id} and action = 'order.delivered' order by seller_id nulls first`
    expect(entries).toEqual([{ seller_id: null }, { seller_id: t.sellerA1First }])
  })

  it('reads EasyPost’s signed tracker events, and refuses a bad signature, a throttled caller, a GET and an unknown address', async () => {
    const { shipments } = await order('T-4', [{ version: house, seller: null, at: main }])
    const [parcel = ''] = shipments
    // A US parcel through EasyPost, as a USPS label would be.
    await db.sql`update fulfilment set courier_provider = 'usps', provider_ref = 'shp_t4' where id = ${parcel}`
    const body = JSON.stringify({ description: 'tracker.updated', result: { tracking_code: 'EZ1', shipment_id: 'shp_t4', status: 'out_for_delivery', updated_at: '2026-10-12T08:00:00Z' } })
    expect(await post(`/couriers/easypost/${t.storeA1}`, body, { 'x-hmac-signature': await signed(body, 'not-the-secret') })).toBe(400)
    expect(await post(`/couriers/easypost/${t.storeA1}`, body, { 'x-hmac-signature': await signed(body) }, async () => false)).toBe(429)
    expect(await post(`/couriers/easypost/${t.storeA1}`, body, { 'x-hmac-signature': await signed(body) })).toBe(200)
    expect(await shipment(parcel)).toMatchObject({ tracking_status: 'out_for_delivery', delivered_at: null })
    const hook = courierHookOf(`/couriers/easypost/${t.storeA1}`)
    if (!hook) throw new Error('no hook')
    expect((await handleCourierHook(new Request('https://hooks.example/x'), hook, { sql: db.sql, activity: activityLog, couriers }, async () => true)).status).toBe(405)
    expect(courierHookOf('/couriers/dhl/x')).toBeNull()
    expect(courierHookOf(`/couriers/shiprocket/${t.storeA1}/extra`)).toBeNull()
  })
})

describe('a delivery nobody is told of (#563)', () => {
  const deliver = async (number: string, before: (orderId: string) => Promise<unknown>) => {
    const { id, shipments } = await order(number, [{ version: house, seller: null, at: main }])
    await before(id)
    expect(await shiprocket(t.storeA1, await awbOf(shipments[0] ?? ''), 'DELIVERED', '2026-10-12 11:00:00')).toBe(200)
    return { id, parcel: shipments[0] ?? '' }
  }
  const stillRecorded = async (id: string, parcel: string) => {
    expect((await shipment(parcel))?.delivered_at).toEqual(new Date('2026-10-12T05:30:00Z'))
    expect(await db.sql`select 1 from activity_log where target_id = ${id} and action = 'order.delivered'`).toHaveLength(1)
    expect(await delivered(id)).toEqual([])
  }

  it('tells no shopper of a test-mode order’s or a cancelled order’s delivery, yet records it', async () => {
    const test = await deliver('T-10', (id) => db.sql`update payment set mode = 'test' where order_id = ${id}`)
    await stillRecorded(test.id, test.parcel)
    const cancelled = await deliver('T-11', (id) => db.sql`update "order" set state = 'cancelled' where id = ${id}`)
    await stillRecorded(cancelled.id, cancelled.parcel)
  })

  it('tells no shopper when the store has that courier’s Tracking emails off, yet records it', async () => {
    const off = await deliver('T-12', () => db.sql`update store_courier set tracking_emails = false where store_id = ${t.storeA1}`)
    await stillRecorded(off.id, off.parcel)
    await db.sql`update store_courier set tracking_emails = true where store_id = ${t.storeA1}`
  })
})

describe('the hook’s rate limits (#563)', () => {
  it('counts unproven posts against their sender alone, so a flood of bad signatures leaves the store’s real hooks through', async () => {
    const { shipments } = await order('T-20', [{ version: house, seller: null, at: main }])
    const awb = await awbOf(shipments[0] ?? '')
    const used = new Map<string, number>()
    // Three a key, as a limiter would allow in its window.
    const allow = async (key: string) => {
      used.set(key, (used.get(key) ?? 0) + 1)
      return (used.get(key) ?? 0) <= 3
    }
    const body = (status: string) => JSON.stringify({ awb, current_status: status, current_timestamp: '2026-10-12 11:00:00' })
    const junk = await Promise.all([1, 2, 3, 4, 5].map(() => post(`/couriers/shiprocket/${t.storeA1}`, body('DELIVERED'), { 'x-api-key': 'guess', 'cf-connecting-ip': '203.0.113.9' }, allow)))
    expect(junk).toEqual([400, 400, 400, 429, 429])
    expect(used.get(`courier-hook:${t.storeA1}`)).toBeUndefined()
    expect(await post(`/couriers/shiprocket/${t.storeA1}`, body('IN TRANSIT'), { 'x-api-key': localCourierHookSecret, 'cf-connecting-ip': '198.51.100.7' }, allow)).toBe(200)
    expect(used.get(`courier-hook:${t.storeA1}`)).toBe(1)
    expect((await shipment(shipments[0] ?? ''))?.tracking_status).toBe('in_transit')
  })

  it('never lets one store’s burst of proven hooks from a courier’s shared address refuse another store’s', async () => {
    const used = new Map<string, number>()
    const allow = async (key: string) => {
      used.set(key, (used.get(key) ?? 0) + 1)
      return (used.get(key) ?? 0) <= 3
    }
    const courierIp = { 'x-api-key': localCourierHookSecret, 'cf-connecting-ip': '192.0.2.50' }
    const body = JSON.stringify({ awb: 'NONE', current_status: 'IN TRANSIT', current_timestamp: '2026-10-12 11:00:00' })
    const busy = await Promise.all([1, 2, 3, 4].map(() => post(`/couriers/shiprocket/${t.storeA1}`, body, courierIp, allow)))
    expect(busy).toEqual([200, 200, 200, 429])
    expect(await post(`/couriers/shiprocket/${t.storeB1}`, body, courierIp, allow)).toBe(200)
  })
})

describe('Shiprocket tracking asked for', () => {
  it('queues each store with a parcel on its way once a half hour, and applies what Shiprocket answers as a hook would', async () => {
    const { shipments } = await order('T-30', [{ version: house, seller: null, at: main }])
    const [parcel = ''] = shipments
    const ref = (await db.sql<{ provider_ref: string }[]>`select provider_ref from fulfilment where id = ${parcel}`)[0]?.provider_ref ?? ''
    await db.sql`insert into courier_account (store_id, provider, email, credentials_sealed, connected_by) values (${t.storeA1}, 'shiprocket', 'api@a1.example', 'v1.sealed', ${t.storeA1}) on conflict do nothing`
    const now = new Date('2026-10-13T06:00:00Z')
    expect(await queueCourierTracking(db.sql, now)).toBe(1)
    expect(await queueCourierTracking(db.sql, now)).toBe(1)
    const queued = await db.sql<{ store_id: string; partner_id: string }[]>`select store_id, partner_id from outbox where kind = ${courierTrackKind}`
    expect(queued).toEqual([{ store_id: t.storeA1, partner_id: t.partnerA }])

    const asked: string[][] = []
    const answer: TrackingEvent[] = [{ providerRef: ref, trackingNumber: null, status: 'out_for_delivery', at: new Date('2026-10-13T04:00:00Z') }]
    const directory: CourierDirectory = { ...couriers, forStore: async (id) => ({ ...(await couriers.forStore(id)), gateway: { ...(await couriers.forStore(id)).gateway, track: async (_, refs) => (asked.push([...refs]), answer) } }) }
    const deliverer = courierTrackDeliverer(db.sql, directory, activityLog, () => now)
    const effect = { id: crypto.randomUUID(), kind: courierTrackKind, idempotencyKey: 'k', payload: {}, partnerId: t.partnerA, storeId: t.storeA1, attempt: 0 }
    await deliverer.deliver(effect, AbortSignal.timeout(5000))
    expect(asked.some((refs) => refs.includes(ref))).toBe(true)
    expect(await shipment(parcel)).toMatchObject({ tracking_status: 'out_for_delivery', tracking_status_at: new Date('2026-10-13T04:00:00Z') })
    // Asked now, it waits half an hour before it is asked again.
    asked.length = 0
    await deliverer.deliver(effect, AbortSignal.timeout(5000))
    expect(asked.some((refs) => refs.includes(ref))).toBe(false)
  })
})

describe('Shiprocket COD remittance asked for', () => {
  const deliveredAgo = async (fulfilmentId: string, status = 'delivered') => {
    const at = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await db.sql`update fulfilment set tracking_status = ${status}, tracking_status_at = ${at}, delivered_at = ${status === 'delivered' ? at : null}, tracking_polled_at = null where id = ${fulfilmentId}`
  }
  const refOf = async (fulfilmentId: string) => (await db.sql<{ r: string }[]>`select provider_ref as r from fulfilment where id = ${fulfilmentId}`)[0]?.r ?? ''
  const paymentOf = async (orderId: string) => (await db.sql<{ s: string }[]>`select payment_state as s from "order" where id = ${orderId}`)[0]?.s
  const withRemitted = (answer: (refs: readonly string[]) => Promise<string[]>, asked: string[][]): CourierDirectory => ({
    ...couriers,
    forStore: async (id) => {
      const store = await couriers.forStore(id)
      return { ...store, gateway: { ...store.gateway, track: async () => [], remitted: async (_, refs) => (asked.push([...refs]), answer(refs)) } }
    },
  })
  const effect = () => ({ id: crypto.randomUUID(), kind: courierTrackKind, idempotencyKey: crypto.randomUUID(), payload: {}, partnerId: t.partnerA, storeId: t.storeA1, attempt: 0 })

  it('marks a delivered COD order paid once Shiprocket has remitted its cash, as a job, and asks about no returned or paid one', async () => {
    await db.sql`insert into courier_account (store_id, provider, email, credentials_sealed, connected_by) values (${t.storeA1}, 'shiprocket', 'api@a1.example', 'v1.sealed', ${t.storeA1}) on conflict do nothing`
    const remitted = await order('T-40', [{ version: house, seller: null, at: main }])
    const waiting = await order('T-41', [{ version: house, seller: null, at: main }])
    const returned = await order('T-42', [{ version: house, seller: null, at: main }])
    const paid = await order('T-43', [{ version: house, seller: null, at: main }])
    for (const o of [remitted, waiting, paid]) await deliveredAgo(o.shipments[0] ?? '')
    await deliveredAgo(returned.shipments[0] ?? '', 'returned')
    await db.sql`update "order" set payment_state = 'paid' where id = ${paid.id}`
    const [remittedRef, waitingRef, returnedRef, paidRef] = await Promise.all([remitted, waiting, returned, paid].map((o) => refOf(o.shipments[0] ?? '')))

    expect(await queueCourierTracking(db.sql, new Date())).toBeGreaterThan(0)
    const asked: string[][] = []
    const deliverer = courierTrackDeliverer(db.sql, withRemitted(async (refs) => refs.filter((r) => r === remittedRef), asked), activityLog)
    await deliverer.deliver(effect(), AbortSignal.timeout(5000))
    expect(asked.flat()).toEqual(expect.arrayContaining([remittedRef, waitingRef]))
    expect(asked.flat()).not.toContain(returnedRef)
    expect(asked.flat()).not.toContain(paidRef)
    expect(await paymentOf(remitted.id)).toBe('paid')
    expect(await paymentOf(waiting.id)).toBe('pending')
    expect(await paymentOf(returned.id)).toBe('pending')
    const entries = await db.sql`select actor_kind, actor_id, actor_label from activity_log where target_id = ${remitted.id} and action = 'order.marked_paid'`
    expect(entries).toEqual([{ actor_kind: 'job', actor_id: null, actor_label: 'Shiprocket remittance' }])

    // Asked now, the one still waiting isn't asked again for six hours; the paid one never again.
    asked.length = 0
    await deliverer.deliver(effect(), AbortSignal.timeout(5000))
    expect(asked.flat()).not.toContain(waitingRef)
    expect(asked.flat()).not.toContain(remittedRef)
  })

  it('marks nothing paid when Shiprocket refuses the login, and asks again next time', async () => {
    const o = await order('T-44', [{ version: house, seller: null, at: main }])
    await deliveredAgo(o.shipments[0] ?? '')
    const deliverer = courierTrackDeliverer(db.sql, withRemitted(async () => Promise.reject(new CourierRejected('shiprocket: remittance refused')), []), activityLog)
    await deliverer.deliver(effect(), AbortSignal.timeout(5000))
    expect(await paymentOf(o.id)).toBe('pending')
  })
})
