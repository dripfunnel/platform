import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import type { AssetStore } from '#engine/modules/catalog/index'
import { courierHookOf, handleCourierHook } from '#hooks/couriers'
import { localCouriers, localCourierHookSecret } from '#integrations/local/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #311 (SAPI 12), part 2: a test label booked through the local stand-in and tracked by its courier's hook, verified
// with the partner's secret and applied once, forward in time, to that partner's parcels only (FIRST-RELEASE §19).

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
  const response = await handleCourierHook(new Request(`https://hooks.example${path}`, { method: 'POST', body, headers }), hook, { sql: db.sql, activity: activityLog, couriers, now: () => new Date() }, allow)
  return response.status
}
const shiprocket = (partnerId: string, awb: string, status: string, at: string, token = localCourierHookSecret) =>
  post(`/couriers/shiprocket/${partnerId}`, JSON.stringify({ awb, current_status: status, current_timestamp: at, order_id: 'x' }), { 'x-api-key': token })
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
    expect(await shiprocket(t.partnerA, awb, 'PICKUP SCHEDULED', '2026-10-11 09:00:00')).toBe(200)
    expect((await shipment(parcel))?.tracking_status).toBeNull()
    expect(await shiprocket(t.partnerA, awb, 'IN TRANSIT', '2026-10-11 18:00:00')).toBe(200)
    expect(await shipment(parcel)).toMatchObject({ tracking_status: 'in_transit', tracking_status_at: new Date('2026-10-11T12:30:00Z'), delivered_at: null })
    expect(await shiprocket(t.partnerA, awb, 'DELIVERED', '2026-10-12 11:00:00')).toBe(200)
    // The same hook again, and an older one arriving late, change nothing.
    expect(await shiprocket(t.partnerA, awb, 'DELIVERED', '2026-10-12 11:00:00')).toBe(200)
    expect(await shiprocket(t.partnerA, awb, 'IN TRANSIT', '2026-10-11 20:00:00')).toBe(200)
    expect(await shipment(parcel)).toMatchObject({ tracking_status: 'delivered', delivered_at: new Date('2026-10-12T05:30:00Z') })
    expect(await delivered(id)).toEqual([{ payload: { event: 'delivered', orderId: id, fulfilmentId: parcel } }])
    const entries = await db.sql`select action, actor_kind, seller_id from activity_log where target_id = ${id} and action = 'order.delivered'`
    expect(entries).toEqual([{ action: 'order.delivered', actor_kind: 'job', seller_id: null }])
    const read = (await gql(`{ order(id: "${id}") { shipments { trackingStatus deliveredAt } } }`, 'owner')).data?.['order'] as { shipments: unknown[] }
    expect(read.shipments).toEqual([{ trackingStatus: 'delivered', deliveredAt: '2026-10-12T05:30:00.000Z' }])
  })

  it('refuses a hook without the partner’s token, and applies another partner’s hook to none of this partner’s parcels', async () => {
    const { shipments } = await order('T-2', [{ version: house, seller: null, at: main }])
    const [parcel = ''] = shipments
    const awb = await awbOf(parcel)
    expect(await shiprocket(t.partnerA, awb, 'DELIVERED', '2026-10-12 11:00:00', 'wrong')).toBe(400)
    expect(await post(`/couriers/shiprocket/${t.partnerA}`, JSON.stringify({ awb, current_status: 'DELIVERED' }), {})).toBe(400)
    expect(await shiprocket(t.partnerB, awb, 'DELIVERED', '2026-10-12 11:00:00')).toBe(200)
    expect(await shipment(parcel)).toMatchObject({ tracking_status: null, delivered_at: null })
  })

  it('tells a supplier’s parcel’s delivery in the store’s log and the supplier’s own', async () => {
    const { id, shipments } = await order('T-3', [{ version: scarf, seller: t.sellerA1First, at: dropPlace }])
    expect(await shiprocket(t.partnerA, await awbOf(shipments[0] ?? ''), 'DELIVERED', '2026-10-12 11:00:00')).toBe(200)
    const entries = await db.sql`select seller_id from activity_log where target_id = ${id} and action = 'order.delivered' order by seller_id nulls first`
    expect(entries).toEqual([{ seller_id: null }, { seller_id: t.sellerA1First }])
  })

  it('reads EasyPost’s signed tracker events, and refuses a bad signature, a throttled caller, a GET and an unknown address', async () => {
    const { shipments } = await order('T-4', [{ version: house, seller: null, at: main }])
    const [parcel = ''] = shipments
    // A US parcel through EasyPost, as a USPS label would be.
    await db.sql`update fulfilment set courier_provider = 'usps', provider_ref = 'shp_t4' where id = ${parcel}`
    const body = JSON.stringify({ description: 'tracker.updated', result: { tracking_code: 'EZ1', shipment_id: 'shp_t4', status: 'out_for_delivery', updated_at: '2026-10-12T08:00:00Z' } })
    expect(await post(`/couriers/easypost/${t.partnerA}`, body, { 'x-hmac-signature': await signed(body, 'not-the-secret') })).toBe(400)
    expect(await post(`/couriers/easypost/${t.partnerA}`, body, { 'x-hmac-signature': await signed(body) }, async () => false)).toBe(429)
    expect(await post(`/couriers/easypost/${t.partnerA}`, body, { 'x-hmac-signature': await signed(body) })).toBe(200)
    expect(await shipment(parcel)).toMatchObject({ tracking_status: 'out_for_delivery', delivered_at: null })
    const hook = courierHookOf(`/couriers/easypost/${t.partnerA}`)
    if (!hook) throw new Error('no hook')
    expect((await handleCourierHook(new Request('https://hooks.example/x'), hook, { sql: db.sql, activity: activityLog, couriers, now: () => new Date() }, async () => true)).status).toBe(405)
    expect(courierHookOf('/couriers/dhl/x')).toBeNull()
    expect(courierHookOf(`/couriers/shiprocket/${t.partnerA}/extra`)).toBeNull()
  })
})

describe('a delivery nobody is told of (#563)', () => {
  const deliver = async (number: string, before: (orderId: string) => Promise<unknown>) => {
    const { id, shipments } = await order(number, [{ version: house, seller: null, at: main }])
    await before(id)
    expect(await shiprocket(t.partnerA, await awbOf(shipments[0] ?? ''), 'DELIVERED', '2026-10-12 11:00:00')).toBe(200)
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
  it('counts unproven posts against their sender alone, so a flood of bad signatures leaves the partner’s real hooks through', async () => {
    const { shipments } = await order('T-20', [{ version: house, seller: null, at: main }])
    const awb = await awbOf(shipments[0] ?? '')
    const used = new Map<string, number>()
    // Three a key, as a limiter would allow in its window.
    const allow = async (key: string) => {
      used.set(key, (used.get(key) ?? 0) + 1)
      return (used.get(key) ?? 0) <= 3
    }
    const body = (status: string) => JSON.stringify({ awb, current_status: status, current_timestamp: '2026-10-12 11:00:00' })
    const junk = await Promise.all([1, 2, 3, 4, 5].map(() => post(`/couriers/shiprocket/${t.partnerA}`, body('DELIVERED'), { 'x-api-key': 'guess', 'cf-connecting-ip': '203.0.113.9' }, allow)))
    expect(junk).toEqual([400, 400, 400, 429, 429])
    expect(used.get(`courier-hook:${t.partnerA}`)).toBeUndefined()
    expect(await post(`/couriers/shiprocket/${t.partnerA}`, body('IN TRANSIT'), { 'x-api-key': localCourierHookSecret, 'cf-connecting-ip': '198.51.100.7' }, allow)).toBe(200)
    expect(used.get(`courier-hook:${t.partnerA}`)).toBe(1)
    expect((await shipment(shipments[0] ?? ''))?.tracking_status).toBe('in_transit')
  })

  it('never lets one partner’s burst of proven hooks from a courier’s shared address refuse another partner’s', async () => {
    const used = new Map<string, number>()
    const allow = async (key: string) => {
      used.set(key, (used.get(key) ?? 0) + 1)
      return (used.get(key) ?? 0) <= 3
    }
    const courierIp = { 'x-api-key': localCourierHookSecret, 'cf-connecting-ip': '192.0.2.50' }
    const body = JSON.stringify({ awb: 'NONE', current_status: 'IN TRANSIT', current_timestamp: '2026-10-12 11:00:00' })
    const busy = await Promise.all([1, 2, 3, 4].map(() => post(`/couriers/shiprocket/${t.partnerA}`, body, courierIp, allow)))
    expect(busy).toEqual([200, 200, 200, 429])
    expect(await post(`/couriers/shiprocket/${t.partnerB}`, body, courierIp, allow)).toBe(200)
  })
})
