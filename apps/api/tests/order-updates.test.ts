import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TenantContext } from '#core/tenancy'
import { withSystemScope } from '#db/scoped/index'
import { orderUpdateKind, queueOrderUpdate } from '#db/scoped/orderUpdates'
import { applyTracking, createFulfilmentService } from '#engine/modules/orders/index'
import { SesUnavailable, type OutgoingEmail, type SesApi } from '#integrations/ses/index'
import { emailDeliverer } from '#jobs/queues/deliverers/email'
import { orderNotifyDeliverer } from '#jobs/queues/deliverers/orderNotify'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #312 (SAPI 13), part 2: a shopper's order emails and texts (FIRST-RELEASE §7; THIRD-PARTY-ACCESS §2.8): the
// confirmation once an order goes through, and a shipment's news once it leaves and again when tracking first comes.

let db: TestDatabase
let t: Tenants
let ownerId = ''
let place = ''
let version = ''

const sent: OutgoingEmail[] = []
const ses: SesApi = {
  send: async (email) => {
    if (email.to.length === 0) throw new SesUnavailable('no one')
    sent.push(email)
    return { messageId: `m-${sent.length}` }
  },
}
const relay = async () => {
  const [clock] = await db.sql<{ now: Date }[]>`select now() as now`
  const at = new Date((clock?.now ?? new Date()).getTime() + 1000)
  const deliverers = {
    [orderUpdateKind]: orderNotifyDeliverer(db.sql, () => at),
    email: emailDeliverer(db.sql, ses, { hosts: { adminHost: 'admin.test', platformHost: 'platform.test' }, senderDomain: 'mail.test', suppressionKey: btoa('k'.repeat(32)), now: () => at }),
  }
  // Twice: the update's own row, then the email it queued.
  await relayDue(db.sql, deliverers, { ...defaultRelayOptions, now: () => at, baseDelayMs: 0 })
  await relayDue(db.sql, deliverers, { ...defaultRelayOptions, now: () => at, baseDelayMs: 0 })
}
const texts = (orderNumber: string) =>
  db.sql<{ message: string; to: string; brand: string; vars: Record<string, string> }[]>`
    select payload ->> 'message' as message, payload ->> 'to' as to, payload ->> 'brand' as brand, payload -> 'vars' as vars
    from outbox where kind = 'sms' and payload -> 'vars' ->> 'order' = ${orderNumber} order by created_at`

/** A placed order of 2 kurtas from the store's own location, paid live unless it says otherwise. */
const order = async (number: string, o: { email?: string | null; phone?: string | null; method?: string; test?: boolean; storeId?: string } = {}) => {
  const storeId = o.storeId ?? t.storeA1
  const [row] = await db.sql<{ id: string }[]>`
    insert into "order" (store_id, state, payment_state, currency, number, placed_at, paid_at, subtotal_amount, shipping_amount, total_amount, payment_method, email, phone, shipping_address)
    values (${storeId}, 'placed', 'paid', 'INR', ${number}, now(), now(), 200000, 5000, 205000, ${o.method ?? 'stripe'}, ${o.email === undefined ? 'asha@example.com' : o.email},
      ${o.phone === undefined ? '+919800000001' : o.phone}, ${db.sql.json({ name: 'Asha Rao', line1: '12 MG Road', line2: null, city: 'Pune', region: 'MH', postalCode: '411001', country: 'IN', phone: null })})
    returning id`
  const id = row?.id ?? ''
  await db.sql`insert into order_line (order_id, store_id, version_id, product_id, name, version_name, sku, quantity, unit_amount, line_total_amount, position)
    select ${id}, ${storeId}, v.id, v.product_id, 'Kurta', 'Red, M', 'K-1', 2, 100000, 200000, 0 from product_version v where v.id = ${version}`
  await db.sql`insert into order_part (order_id, store_id, seller_id, shipping_mode) values (${id}, ${storeId}, null, 'store')`
  await db.sql`insert into payment (order_id, store_id, provider, kind, state, amount, currency, mode, captured_at) values (${id}, ${storeId}, 'stripe', 'card', 'captured', 205000, 'INR', ${o.test ? 'test' : 'live'}, now())`
  return id
}
const lineOf = async (orderId: string) => (await db.sql<{ id: string }[]>`select id from order_line where order_id = ${orderId}`)[0]?.id ?? ''
const shipping = () => {
  const context: TenantContext = { caller: { kind: 'person', userId: ownerId, sessionId: '' }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' }, subscription: 'active' }
  return createFulfilmentService({ sql: db.sql, context, actor: { id: ownerId, partnerId: t.partnerA }, activity: activityLog, facts: { requestId: 'r', ip: null, userAgent: null }, now: () => new Date() })
}
const confirm = (orderId: string, storeId = t.storeA1) => withSystemScope(db.sql, (tx) => queueOrderUpdate(tx, storeId, { event: 'confirmed', orderId }, `confirmed:${orderId}`))
const mailTo = (subject: string) => sent.filter((m) => m.subject === subject)

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set name = 'Jaipur Looms', contact_email = 'hello@jaipurlooms.example' where id = ${t.storeA1}`
  ownerId = (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, 'owner@a1.example', 'Owner', 'active') returning id`)[0]?.id ?? ''
  place = (await db.sql<{ id: string }[]>`select id from warehouse where store_id = ${t.storeA1} and seller_id is null and is_default`)[0]?.id ?? ''
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${t.storeA1}, 'Kurta', 'kurta', 'visible') returning id`
  version = (await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, track_stock) values (${t.storeA1}, ${p?.id ?? ''}, 'K-1', 0, false) returning id`)[0]?.id ?? ''
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('the order confirmation', () => {
  it('emails the shopper what they ordered, from the store in its partner’s look, and texts them once', async () => {
    const id = await order('JL-1')
    await confirm(id)
    await confirm(id)
    await relay()
    const [mail, ...again] = mailTo('Your Jaipur Looms order JL-1')
    expect(again).toEqual([])
    expect(mail?.to).toEqual(['asha@example.com'])
    expect(mail?.from).toContain('Jaipur Looms')
    expect(mail?.text).toContain('2 × Kurta, Red, M: ₹2,000.00')
    expect(mail?.text).toContain('Total: ₹2,050.00')
    expect(mail?.text).toContain('It goes to Asha Rao in Pune.')
    expect(mail?.text).toContain('Questions? Contact hello@jaipurlooms.example.')
    expect(await texts('JL-1')).toEqual([{ message: 'order.confirmed', to: '+919800000001', brand: 'Jaipur Looms', vars: { order: 'JL-1' } }])
  })

  it('tells a cash-on-delivery shopper what to pay, and sends nothing for a test, cancelled or emailless order', async () => {
    const cod = await order('JL-2', { method: 'cod', phone: null })
    await confirm(cod)
    const test = await order('JL-3', { test: true })
    await confirm(test)
    const cancelled = await order('JL-4')
    await confirm(cancelled)
    await db.sql`update "order" set state = 'cancelled' where id = ${cancelled}`
    const phoneOnly = await order('JL-5', { email: null })
    await confirm(phoneOnly)
    await relay()
    expect(mailTo('Your Jaipur Looms order JL-2')[0]?.text).toContain('You pay ₹2,050.00 when it arrives.')
    expect(await texts('JL-2')).toEqual([])
    for (const n of ['JL-3', 'JL-4', 'JL-5']) expect(mailTo(`Your Jaipur Looms order ${n}`), n).toEqual([])
    expect((await texts('JL-3')).length + (await texts('JL-4')).length).toBe(0)
    expect(await texts('JL-5')).toHaveLength(1)
  })

  it('never tells one store’s order under another partner’s name', async () => {
    const theirs = await order('JL-6', { storeId: t.storeB1 })
    await withSystemScope(db.sql, (tx) => tx`insert into outbox (id, kind, idempotency_key, payload, partner_id, store_id)
      values (${crypto.randomUUID()}, ${orderUpdateKind}, 'forged', ${JSON.stringify({ event: 'confirmed', orderId: theirs })}::text::jsonb, ${t.partnerA}, ${t.storeA1})`)
    await relay()
    expect(mailTo('Your Jaipur Looms order JL-6')).toEqual([])
    expect(await texts('JL-6')).toEqual([])
  })
})

describe('forged rows', () => {
  const forge = (kind: string, payload: Record<string, unknown>, storeId = t.storeA1) =>
    withSystemScope(db.sql, (tx) => tx`insert into outbox (id, kind, idempotency_key, payload, partner_id, store_id)
      values (${crypto.randomUUID()}, ${kind}, ${`forged:${crypto.randomUUID()}`}, ${JSON.stringify(payload)}::text::jsonb, ${t.partnerA}, ${storeId})`)

  it('sends nothing for a shipment of another store’s order, nor an email row naming another store of the same partner', async () => {
    const mine = await order('JL-20')
    // Store A2 is the same partner's: only the store check tells them apart.
    const [theirs] = await db.sql<{ id: string }[]>`
      insert into "order" (store_id, state, payment_state, currency, number, placed_at, subtotal_amount, shipping_amount, total_amount, email)
      values (${t.storeA2}, 'placed', 'paid', 'INR', 'A2-1', now(), 100, 0, 100, 'other@example.com') returning id`
    const [part] = await db.sql<{ id: string }[]>`insert into order_part (order_id, store_id, shipping_mode) values (${theirs?.id ?? ''}, ${t.storeA2}, 'store') returning id`
    const [shipment] = await db.sql<{ id: string }[]>`
      insert into fulfilment (order_part_id, order_id, store_id, kind, warehouse_id, courier_name, tracking_number, tracking_url, shipped_at, created_by)
      select ${part?.id ?? ''}, ${theirs?.id ?? ''}, ${t.storeA2}, 'manual', w.id, 'Delhivery', 'X1', 'https://track.example/X1', now(), ${ownerId}
      from warehouse w where w.store_id = ${t.storeA2} and w.is_default returning id`
    await forge(orderUpdateKind, { event: 'shipped', orderId: mine, fulfilmentId: shipment?.id })
    await forge('email', { template: 'order-shipped', orderId: mine, fulfilmentId: shipment?.id })
    await forge('email', { template: 'order-confirmed', orderId: mine }, t.storeA2)
    await relay()
    expect(sent.filter((m) => m.subject.includes('JL-20'))).toEqual([])
    expect(await texts('JL-20')).toEqual([])
  })
})

describe('the shipping news', () => {
  it('emails what left with a link to track it and texts the courier and link, once', async () => {
    const id = await order('JL-10')
    const made = await shipping().ship({ orderId: id, warehouseId: place, lines: [{ lineId: await lineOf(id), quantity: 1 }], courierName: 'Delhivery', trackingNumber: 'DL123', trackingUrl: 'https://track.example/DL123' })
    expect(made.ok).toBe(true)
    await relay()
    const [mail, ...again] = mailTo('Your Jaipur Looms order JL-10 is on its way')
    expect(again).toEqual([])
    expect(mail?.text).toContain('1 × Kurta, Red, M')
    expect(mail?.text).toContain('With Delhivery, tracking number DL123.')
    expect(mail?.text).toContain('Track your parcel: https://track.example/DL123')
    expect(await texts('JL-10')).toEqual([{ message: 'order.shipped', to: '+919800000001', brand: 'Jaipur Looms', vars: { order: 'JL-10', courier: 'Delhivery', link: 'https://track.example/DL123' } }])
  })

  it('tells them again when tracking first comes, never on a correction', async () => {
    const id = await order('JL-11')
    const made = await shipping().ship({ orderId: id, warehouseId: place, lines: [{ lineId: await lineOf(id), quantity: 2 }], courierName: null, trackingNumber: null, trackingUrl: null })
    const shipment = made.ok ? (made.value[0] ?? '') : ''
    await relay()
    expect(mailTo('Your Jaipur Looms order JL-11 is on its way').map((m) => m.text.includes('Track your parcel'))).toEqual([false])
    // No courier or link yet, and the registered text needs both.
    expect(await texts('JL-11')).toEqual([])
    expect((await shipping().addTracking(shipment, { courierName: 'Blue Dart', trackingNumber: 'BD9', trackingUrl: 'https://track.example/BD9' })).ok).toBe(true)
    expect((await shipping().addTracking(shipment, { courierName: 'Blue Dart', trackingNumber: 'BD10', trackingUrl: null })).ok).toBe(true)
    await relay()
    expect(mailTo('Your Jaipur Looms order JL-11 is on its way').map((m) => m.text.includes('Track your parcel: https://track.example/BD'))).toEqual([false, true])
    expect((await texts('JL-11')).map((m) => m.message)).toEqual(['order.shipped'])
  })

  it('queues nothing for a test order’s shipment', async () => {
    const id = await order('JL-12', { test: true })
    await db.sql`update "order" set payment_state = 'paid' where id = ${id}`
    await shipping().ship({ orderId: id, warehouseId: place, lines: [{ lineId: await lineOf(id), quantity: 1 }], courierName: null, trackingNumber: null, trackingUrl: null })
    expect(await db.sql`select 1 from outbox where kind = ${orderUpdateKind} and payload ->> 'orderId' = ${id}`).toHaveLength(0)
  })
})

describe('the delivery news (#311)', () => {
  it('emails what arrived and texts the tracking link once a booked parcel is delivered, and once only', async () => {
    const id = await order('JL-40')
    const made = await shipping().ship({ orderId: id, warehouseId: place, lines: [{ lineId: await lineOf(id), quantity: 2 }], courierName: 'Delhivery', trackingNumber: 'AWB40', trackingUrl: 'https://shiprocket.co/tracking/AWB40' })
    const shipment = made.ok ? (made.value[0] ?? '') : ''
    // As a label booked through the courier would be (migration 0130).
    await db.sql`update fulfilment set kind = 'booked', courier_provider = 'shiprocket', provider_ref = 'sr-40', booked_at = now() where id = ${shipment}`
    const delivered = { providerRef: null, trackingNumber: 'AWB40', status: 'delivered' as const, at: new Date('2026-10-12T10:00:00Z') }
    expect(await applyTracking({ sql: db.sql, activity: activityLog }, t.partnerA, 'shiprocket', [delivered])).toBe(1)
    expect(await applyTracking({ sql: db.sql, activity: activityLog }, t.partnerA, 'shiprocket', [{ ...delivered, at: new Date('2026-10-12T11:00:00Z') }])).toBe(1)
    await relay()
    const [mail, ...again] = mailTo('Your Jaipur Looms order JL-40 was delivered')
    expect(again).toEqual([])
    expect(mail?.text).toContain('2 × Kurta, Red, M')
    expect((await texts('JL-40')).filter((m) => m.message === 'order.delivered')).toEqual([{ message: 'order.delivered', to: '+919800000001', brand: 'Jaipur Looms', vars: { order: 'JL-40', link: 'https://shiprocket.co/tracking/AWB40' } }])
  })

  it('tells nobody when the store switched that courier’s tracking emails off', async () => {
    const id = await order('JL-41')
    const made = await shipping().ship({ orderId: id, warehouseId: place, lines: [{ lineId: await lineOf(id), quantity: 1 }], courierName: 'Delhivery', trackingNumber: 'AWB41', trackingUrl: null })
    const shipment = made.ok ? (made.value[0] ?? '') : ''
    await db.sql`update fulfilment set kind = 'booked', courier_provider = 'shiprocket', provider_ref = 'sr-41', booked_at = now() where id = ${shipment}`
    await db.sql`insert into store_courier (store_id, provider, role, label_size, tracking_emails) values (${t.storeA1}, 'shiprocket', 'pricing', 'a6', false)`
    expect(await applyTracking({ sql: db.sql, activity: activityLog }, t.partnerA, 'shiprocket', [{ providerRef: null, trackingNumber: 'AWB41', status: 'delivered', at: new Date() }])).toBe(1)
    expect(await db.sql`select 1 from outbox where kind = ${orderUpdateKind} and payload ->> 'event' = 'delivered' and payload ->> 'orderId' = ${id}`).toHaveLength(0)
    await db.sql`delete from store_courier where store_id = ${t.storeA1}`
  })
})
