import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { handleDocument } from '#apis/store/documents'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { CourierRejected, CourierUnavailable, type BookedLabel, type CourierDirectory, type CourierProvider, type LabelRequest } from '#core/couriers'
import { withSystemScope } from '#db/scoped/index'
import type { AssetStore } from '#engine/modules/catalog/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #311 (SAPI 12), part 1: a label booked through the store's courier on its partner's account, its file kept as the
// order's document, and the courier's pickup (FIRST-RELEASE §6; THIRD-PARTY-ACCESS §4), for each seat and owner (ACCESS §11).

let db: TestDatabase
let t: Tenants
type Who = 'owner' | 'staff' | 'drop' | 'hub' | 'reader' | 'other'
const cookies = {} as Record<Who, string>
const places = { main: '', drop: '', hub: '', bare: '' }
const versions = { house: '', scarf: '', stole: '' }
let reader = ''

// The courier: what it answers next, what it was asked, and a pause to hold a booking open while another arrives.
type Answer = 'label' | 'unserved' | 'rejected' | 'down'
const courier = { answer: 'label' as Answer, booked: [] as { provider: CourierProvider; request: LabelRequest }[], pickups: [] as string[], pauseMs: 0 }
const label = (request: LabelRequest): BookedLabel => ({
  providerRef: `ref-${request.reference}`,
  trackingNumber: `AWB${request.reference.slice(0, 8)}`,
  trackingUrl: `https://shiprocket.co/tracking/AWB${request.reference.slice(0, 8)}`,
  courierName: 'Delhivery Surface',
  label: { bytes: new TextEncoder().encode(`%PDF-1.4 ${request.reference}`), mime: 'application/pdf' },
  pickup: request.pickup === 'scheduled' ? { ref: 'PU-1', date: '2026-10-12' } : null,
})
const couriers: CourierDirectory = {
  forPartner: async () => ({
    accounts: new Set(['shiprocket'] as const),
    gateway: {
      quote: async () => null,
      book: async (provider, request) => {
        courier.booked.push({ provider, request })
        if (courier.pauseMs) await new Promise((resolve) => setTimeout(resolve, courier.pauseMs))
        if (courier.answer === 'unserved') return null
        if (courier.answer === 'rejected') throw new CourierRejected('login refused')
        if (courier.answer === 'down') throw new CourierUnavailable('no answer')
        return label(request)
      },
      pickup: async (_, shipment) => {
        courier.pickups.push(shipment.providerRef)
        if (courier.pauseMs) await new Promise((resolve) => setTimeout(resolve, courier.pauseMs))
        if (courier.answer === 'down') throw new CourierUnavailable('no answer')
        return { ref: 'PU-2', date: '2026-10-13' }
      },
      readHook: async () => null,
    },
  }),
}
const kept = new Map<string, Uint8Array<ArrayBuffer>>()
const files: AssetStore = {
  put: async (key, value) => {
    kept.set(key, new Uint8Array(value))
  },
  get: async (key) => {
    const bytes = kept.get(key)
    return bytes ? { body: new Response(bytes).body ?? new ReadableStream() } : null
  },
}

const level = async (versionId: string, warehouseId: string) =>
  (await db.sql<{ on_hand: number; reserved: number }[]>`select on_hand, reserved from stock_level where version_id = ${versionId} and warehouse_id = ${warehouseId}`)[0]

const order = async (number: string, lines: { version: string; seller: string | null; quantity: number; heldAt: string }[]) => {
  const store = t.storeA1
  const [row] = await db.sql<{ id: string }[]>`
    insert into "order" (store_id, state, payment_state, currency, number, placed_at, total_amount, payment_method, shipping_option, stock_reserved, email, phone, shipping_address)
    values (${store}, 'placed', 'pending', 'INR', ${number}, now(), 1000, 'cod', 'courier', true, 'priya@example.com', '+919800000001',
      ${db.sql.json({ name: 'Priya Shah', line1: '1 MG Road', line2: null, city: 'Pune', region: 'Maharashtra', postalCode: '411001', country: 'IN', phone: '+919800000001' })})
    returning id`
  const id = row?.id ?? ''
  for (const [position, l] of lines.entries()) {
    const [v] = await db.sql<{ product_id: string }[]>`select product_id from product_version where id = ${l.version}`
    await db.sql`insert into order_line (order_id, store_id, seller_id, version_id, product_id, name, sku, quantity, unit_amount, line_total_amount, weight_grams, reserved_warehouse_id, position)
      values (${id}, ${store}, ${l.seller}, ${l.version}, ${v?.product_id ?? ''}, 'Kurta', 'KUR-1', ${l.quantity}, 49900, ${49900 * l.quantity}, 300, ${l.heldAt}, ${position})`
    await db.sql`update stock_level set reserved = reserved + ${l.quantity} where version_id = ${l.version} and warehouse_id = ${l.heldAt}`
  }
  for (const seller of new Set(lines.map((l) => l.seller))) {
    const mode = seller ? ((await db.sql<{ m: string }[]>`select shipping_mode as m from seller where id = ${seller}`)[0]?.m ?? 'to-store') : 'store'
    await db.sql`insert into order_part (order_id, store_id, seller_id, shipping_mode) values (${id}, ${store}, ${seller}, ${mode})`
  }
  await db.sql`insert into payment (order_id, store_id, provider, kind, state, amount, currency, mode) values (${id}, ${store}, 'cod', 'cod', 'pending', 1000, 'INR', 'live')`
  return id
}
const lineOf = async (orderId: string, versionId: string) => (await db.sql<{ id: string }[]>`select id from order_line where order_id = ${orderId} and version_id = ${versionId}`)[0]?.id ?? ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  for (const store of [t.storeA1, t.storeA2]) {
    await db.sql`update store set country = 'IN', address = ${db.sql.json({ street: '4 Johari Bazaar', city: 'Jaipur', postal: '302003', region: 'Rajasthan' })}, contact_phone = '+911412000000', contact_email = 'hello@a.example' where id = ${store}`
    await db.sql`insert into store_courier (store_id, provider, role, label_size) values (${store}, 'shiprocket', 'pricing', 'a6')`
  }
  await db.sql`update seller set shipping_mode = 'to-shopper', access_level = 'vendor-orders-fulfil' where id = ${t.sellerA1First}`
  await db.sql`update seller set shipping_mode = 'to-store', access_level = 'vendor-orders-fulfil' where id = ${t.sellerA1Second}`
  reader = (await db.sql<{ id: string }[]>`insert into seller (store_id, name, access_level, shipping_mode, status) values (${t.storeA1}, 'Chawla Crafts', 'vendor-orders-read', 'to-shopper', 'active') returning id`)[0]?.id ?? ''
  places.main = (await db.sql<{ id: string }[]>`select id from warehouse where store_id = ${t.storeA1} and seller_id is null and is_default`)[0]?.id ?? ''
  const address = db.sql.json({ line1: '9 Udyog Vihar', city: 'Gurugram', region: 'Haryana', postalCode: '122016', country: 'IN' })
  places.drop = (await db.sql<{ id: string }[]>`insert into warehouse (store_id, seller_id, name, is_default, address) values (${t.storeA1}, ${t.sellerA1First}, 'Anand works', true, ${address}) returning id`)[0]?.id ?? ''
  places.hub = (await db.sql<{ id: string }[]>`insert into warehouse (store_id, seller_id, name, is_default, address) values (${t.storeA1}, ${t.sellerA1Second}, 'Bhatia mill', true, ${address}) returning id`)[0]?.id ?? ''
  places.bare = (await db.sql<{ id: string }[]>`insert into warehouse (store_id, seller_id, name) values (${t.storeA1}, ${t.sellerA1First}, 'No address yet') returning id`)[0]?.id ?? ''
  const version = async (seller: string | null, sku: string) => {
    const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, seller_id, name, slug, visibility) values (${t.storeA1}, ${seller}, ${sku}, ${sku}, 'visible') returning id`
    return (await db.sql<{ id: string }[]>`insert into product_version (store_id, seller_id, product_id, sku, position, track_stock) values (${t.storeA1}, ${seller}, ${p?.id ?? ''}, ${sku}, 0, true) returning id`)[0]?.id ?? ''
  }
  versions.house = await version(null, 'house')
  versions.scarf = await version(t.sellerA1First, 'scarf')
  versions.stole = await version(t.sellerA1Second, 'stole')
  await db.sql`insert into stock_level (version_id, warehouse_id, store_id, seller_id, on_hand) values
    (${versions.house}, ${places.main}, ${t.storeA1}, null, 50), (${versions.scarf}, ${places.drop}, ${t.storeA1}, ${t.sellerA1First}, 50),
    (${versions.scarf}, ${places.bare}, ${t.storeA1}, ${t.sellerA1First}, 50), (${versions.stole}, ${places.hub}, ${t.storeA1}, ${t.sellerA1Second}, 50)`

  const person = async (email: string, role: string, seller: string | null = null, storeId = t.storeA1) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, ${email.split('@')[0] ?? ''}, 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${u?.id ?? ''}, ${storeId}, ${seller}, ${role}, 'active')`
    return withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
  }
  cookies.owner = await person('owner@a1.example', 'owner')
  cookies.staff = await person('staff@a1.example', 'staff')
  cookies.drop = await person('anand@a1.example', 'supplier-admin', t.sellerA1First)
  cookies.hub = await person('bhatia@a1.example', 'supplier-member', t.sellerA1Second)
  cookies.reader = await person('chawla@a1.example', 'supplier-admin', reader)
  cookies.other = await person('owner@a2.example', 'owner', null, t.storeA2)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

beforeEach(() => {
  courier.answer = 'label'
  courier.booked = []
  courier.pickups = []
  courier.pauseMs = 0
})

const sellerOf: Partial<Record<Who, () => string>> = { drop: () => t.sellerA1First, hub: () => t.sellerA1Second, reader: () => reader }
const contextFor = async (who: Who, as: { support?: 'read'; couriers?: CourierDirectory | null } = {}): Promise<StoreContext> => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const seller = sellerOf[who]?.()
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: who === 'other' ? t.storeA2 : t.storeA1, ...(seller ? { [supplierHeader]: seller } : {}) }
  const resolved = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  const standing = as.support && resolved.kind === 'acting'
    ? { ...resolved, caller: { ...resolved.caller, context: { ...resolved.caller.context, caller: { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: as.support } } } }
    : resolved
  return { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, couriers: as.couriers === undefined ? couriers : as.couriers, files, now: () => new Date() }
}
const gql = async (source: string, who: Who, as: { support?: 'read'; couriers?: CourierDirectory | null } = {}) => {
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue: await contextFor(who, as) })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const book = (who: Who, orderId: string, warehouseId: string, lines: { id: string; quantity: number }[], provider = 'shiprocket', as: { support?: 'read'; couriers?: CourierDirectory | null } = {}) =>
  gql(`mutation { bookLabel(orderId: "${orderId}", warehouseId: "${warehouseId}", courier: "${provider}", lines: [${lines.map((l) => `{ lineId: "${l.id}", quantity: ${l.quantity} }`).join(', ')}]) }`, who, as)
const pickup = (who: Who, shipmentId: string, as: { support?: 'read' } = {}) => gql(`mutation { requestPickup(shipmentId: "${shipmentId}") }`, who, as)
const documentStatus = async (who: Who, id: string) => (await handleDocument(new Request(`https://store.example/api/documents/${id}`), await contextFor(who), files)).status
const shipments = async (who: Who, orderId: string) =>
  ((await gql(`{ order(id: "${orderId}") { shipments { id kind supplierId courier courierName trackingNumber trackingUrl labelDocumentId pickupRequestedAt pickupDate pickupReference lines { quantity } } } }`, who)).data?.['order'] as { shipments: Record<string, unknown>[] } | null)?.shipments
const count = async (orderId: string) => Number((await db.sql<{ n: string }[]>`select count(*) as n from fulfilment where order_id = ${orderId}`)[0]?.n ?? 0)

describe('the store books a label for its own lines', () => {
  let id = ''
  let house = ''
  let shipment = ''
  beforeAll(async () => {
    id = await order('L-1001', [{ version: versions.house, seller: null, quantity: 3, heldAt: places.main }, { version: versions.scarf, seller: t.sellerA1First, quantity: 2, heldAt: places.drop }])
    house = await lineOf(id, versions.house)
  })

  it('buys it through the courier from the store’s address to the shopper’s, and keeps the shipment, its stock and its file', async () => {
    const made = await book('staff', id, places.main, [{ id: house, quantity: 2 }])
    expect(made.code).toBeUndefined()
    shipment = String(made.data?.['bookLabel'])
    expect(courier.booked).toHaveLength(1)
    const asked = courier.booked[0]?.request
    expect(asked).toMatchObject({
      reference: shipment,
      // The main location has no address of its own, so it leaves from Store info's.
      from: { locationId: places.main, name: 'Store A1', line1: '4 Johari Bazaar', city: 'Jaipur', postal: '302003', country: 'IN', phone: '+911412000000' },
      to: { name: 'Priya Shah', line1: '1 MG Road', city: 'Pune', postal: '411001', country: 'IN', phone: '+919800000001', email: 'priya@example.com' },
      weightGrams: 600,
      value: { amount: 99800n, currency: 'INR' },
      labelSize: 'a6',
      pickup: 'scheduled',
    })
    expect(asked?.items).toEqual([{ name: 'Kurta', sku: 'KUR-1', quantity: 2, unitAmount: 49900n, hsCode: null }])
    expect(await level(versions.house, places.main)).toEqual({ on_hand: 48, reserved: 1 })
    const [row] = await shipments('owner', id) ?? []
    expect(row).toMatchObject({
      id: shipment, kind: 'booked', supplierId: null, courier: 'shiprocket', courierName: 'Delhivery Surface', trackingNumber: `AWB${shipment.slice(0, 8)}`,
      trackingUrl: `https://shiprocket.co/tracking/AWB${shipment.slice(0, 8)}`, pickupDate: '2026-10-12', pickupReference: 'PU-1', lines: [{ quantity: 2 }],
    })
    // Scheduled pickups: the courier was asked with the label, so it isn't asked again.
    expect(row?.['pickupRequestedAt']).toEqual(expect.any(String))
    expect(await documentStatus('owner', String(row?.['labelDocumentId']))).toBe(200)
    expect(await documentStatus('staff', String(row?.['labelDocumentId']))).toBe(200)
    const [entry] = await db.sql`select action, reason from activity_log where target_id = ${id} order by occurred_at desc limit 1`
    expect(entry).toEqual({ action: 'order.shipped', reason: 'booked' })
    const [notice] = await db.sql`select kind, payload from outbox where idempotency_key like ${`order.notify:%:shipped:${shipment}`}`
    expect(notice).toEqual({ kind: 'order.notify', payload: { event: 'shipped', orderId: id, fulfilmentId: shipment } })
    expect((await pickup('owner', shipment)).code).toBe('PICKUP_ASKED')
    expect(courier.pickups).toEqual([])
  })

  it('takes no tracking by hand on a booked label, whose tracking is the courier’s', async () => {
    expect((await gql(`mutation { addTracking(shipmentId: "${shipment}", trackingNumber: "X1") }`, 'owner')).code).toBe('NOT_SHIPPABLE')
  })

  it('writes nothing when the courier won’t take the parcel, refuses the account or doesn’t answer', async () => {
    for (const [answer, code] of [['unserved', 'UNSERVED'], ['rejected', 'COURIER_REJECTED'], ['down', 'COURIER_UNAVAILABLE']] as const) {
      courier.answer = answer
      expect((await book('owner', id, places.main, [{ id: house, quantity: 1 }])).code).toBe(code)
    }
    expect(courier.booked).toHaveLength(3)
    expect(await count(id)).toBe(1)
    expect(await level(versions.house, places.main)).toEqual({ on_hand: 48, reserved: 1 })
    expect(kept.size).toBe(1)
  })

  it('refuses a courier the store hasn’t connected or its partner doesn’t hold, and asks nobody', async () => {
    expect((await book('owner', id, places.main, [{ id: house, quantity: 1 }], 'usps')).code).toBe('NOT_CONNECTED')
    expect((await book('owner', id, places.main, [{ id: house, quantity: 1 }], 'shiprocket', { couriers: null })).code).toBe('NOT_CONNECTED')
    await db.sql`update store_courier set role = 'off' where store_id = ${t.storeA1}`
    expect((await book('owner', id, places.main, [{ id: house, quantity: 1 }])).code).toBe('NOT_CONNECTED')
    await db.sql`update store_courier set role = 'pricing' where store_id = ${t.storeA1}`
    expect((await book('owner', id, places.main, [{ id: house, quantity: 1 }], 'dhl')).code).toBe('INVALID_INPUT')
    expect(courier.booked).toEqual([])
  })

  it('refuses a read-only support session, a supplier on the store’s lines, another store and the read-only tier', async () => {
    expect((await book('owner', id, places.main, [{ id: house, quantity: 1 }], 'shiprocket', { support: 'read' })).code).toBe('READ_ONLY')
    expect((await book('drop', id, places.drop, [{ id: house, quantity: 1 }])).code).toBe('NOT_FOUND')
    expect((await book('other', id, places.main, [{ id: house, quantity: 1 }])).code).toBe('NOT_FOUND')
    expect((await book('reader', id, places.main, [{ id: house, quantity: 1 }])).code).toBe('FORBIDDEN')
    expect((await pickup('owner', shipment, { support: 'read' })).code).toBe('READ_ONLY')
    expect(courier.booked).toEqual([])
  })

  it('books one label for two requests for the same units at once, the second finding them gone', async () => {
    courier.pauseMs = 150
    const [a, b] = await Promise.all([book('owner', id, places.main, [{ id: house, quantity: 1 }]), book('staff', id, places.main, [{ id: house, quantity: 1 }])])
    expect([a.code, b.code].filter(Boolean)).toEqual(['TOO_MANY'])
    expect(courier.booked).toHaveLength(1)
    expect(await count(id)).toBe(2)
  })
})

describe('a supplier books its own labels', () => {
  let id = ''
  let scarf = ''
  beforeAll(async () => {
    id = await order('L-1002', [{ version: versions.house, seller: null, quantity: 1, heldAt: places.main }, { version: versions.scarf, seller: t.sellerA1First, quantity: 3, heldAt: places.drop }, { version: versions.stole, seller: t.sellerA1Second, quantity: 1, heldAt: places.hub }])
    scarf = await lineOf(id, versions.scarf)
  })

  it('books its to-shopper lines through the store’s account from its own location, and reads only its own label', async () => {
    const made = await book('drop', id, places.drop, [{ id: scarf, quantity: 1 }])
    expect(made.code).toBeUndefined()
    expect(courier.booked[0]?.request.from).toMatchObject({ locationId: places.drop, line1: '9 Udyog Vihar', city: 'Gurugram', postal: '122016' })
    const mine = await shipments('drop', id)
    expect(mine).toHaveLength(1)
    const document = String(mine?.[0]?.['labelDocumentId'])
    expect(await documentStatus('drop', document)).toBe(200)
    // The store reads its supplier's label; another supplier, and another store, find nothing.
    expect(await documentStatus('owner', document)).toBe(200)
    expect(await documentStatus('hub', document)).toBe(404)
    expect(await documentStatus('reader', document)).toBe(404)
    expect(await documentStatus('other', document)).toBe(404)
    const [doc] = await db.sql`select d.seller_id, a.seller_id as file_owner, a.kind from order_document d join asset a on a.id = d.asset_id where d.id = ${document}`
    expect(doc).toEqual({ seller_id: t.sellerA1First, file_owner: t.sellerA1First, kind: 'document' })
  })

  it('never reads the store’s label, which a supplier’s query of the order doesn’t list', async () => {
    const house = await lineOf(id, versions.house)
    const made = await book('owner', id, places.main, [{ id: house, quantity: 1 }])
    const storeDoc = (await shipments('owner', id))?.find((s) => s['id'] === made.data?.['bookLabel'])?.['labelDocumentId']
    expect(await documentStatus('drop', String(storeDoc))).toBe(404)
    expect((await shipments('drop', id))?.map((s) => s['supplierId'])).toEqual([t.sellerA1First])
  })

  it('refuses a location with no address, its own courier account, a hand-off to the store, and lines of two parts', async () => {
    expect((await book('drop', id, places.bare, [{ id: scarf, quantity: 1 }])).code).toBe('NO_ADDRESS')
    await db.sql`update seller set label_account = 'own' where id = ${t.sellerA1First}`
    expect((await book('drop', id, places.drop, [{ id: scarf, quantity: 1 }])).code).toBe('OWN_LABELS')
    await db.sql`update seller set label_account = 'store' where id = ${t.sellerA1First}`
    const stole = await lineOf(id, versions.stole)
    expect((await book('hub', id, places.hub, [{ id: stole, quantity: 1 }])).code).toBe('INVALID_INPUT')
    // Handed over, the store ships the stole on: with its own line that is two parts, so two parcels.
    const second = await order('L-1003', [{ version: versions.house, seller: null, quantity: 1, heldAt: places.main }, { version: versions.stole, seller: t.sellerA1Second, quantity: 1, heldAt: places.hub }])
    const stole2 = await lineOf(second, versions.stole)
    expect((await gql(`mutation { shipItems(orderId: "${second}", warehouseId: "${places.hub}", lines: [{ lineId: "${stole2}", quantity: 1 }]) }`, 'hub')).code).toBeUndefined()
    expect((await book('owner', second, places.main, [{ id: await lineOf(second, versions.house), quantity: 1 }, { id: stole2, quantity: 1 }])).code).toBe('ONE_PART')
    expect(courier.booked).toEqual([])
  })
})

describe('a pickup on request', () => {
  let id = ''
  let shipment = ''
  let manual = ''
  beforeAll(async () => {
    await db.sql`update store_courier set pickup_mode = 'on_request' where store_id = ${t.storeA1}`
    id = await order('L-1004', [{ version: versions.house, seller: null, quantity: 2, heldAt: places.main }, { version: versions.scarf, seller: t.sellerA1First, quantity: 1, heldAt: places.drop }])
    const house = await lineOf(id, versions.house)
    shipment = String((await book('owner', id, places.main, [{ id: house, quantity: 1 }])).data?.['bookLabel'])
    manual = String(((await gql(`mutation { shipItems(orderId: "${id}", warehouseId: "${places.main}", lines: [{ lineId: "${house}", quantity: 1 }]) }`, 'owner')).data?.['shipItems'] as string[])[0])
  })
  afterAll(async () => {
    await db.sql`update store_courier set pickup_mode = 'scheduled' where store_id = ${t.storeA1}`
  })

  it('isn’t asked with the label, and is refused to a supplier, another store and a shipment not booked here', async () => {
    expect((await shipments('owner', id))?.find((s) => s['id'] === shipment)).toMatchObject({ pickupRequestedAt: null, pickupDate: null })
    expect((await pickup('drop', shipment)).code).toBe('NOT_FOUND')
    expect((await pickup('other', shipment)).code).toBe('NOT_FOUND')
    expect((await pickup('reader', shipment)).code).toBe('FORBIDDEN')
    expect((await pickup('owner', manual)).code).toBe('NOT_BOOKED')
    expect(courier.pickups).toEqual([])
  })

  it('keeps nothing when the courier doesn’t answer', async () => {
    courier.answer = 'down'
    expect((await pickup('owner', shipment)).code).toBe('COURIER_UNAVAILABLE')
    expect((await shipments('owner', id))?.find((s) => s['id'] === shipment)?.['pickupRequestedAt']).toBeNull()
  })

  it('asks nothing of a courier the store has switched off since the label was booked', async () => {
    await db.sql`update store_courier set role = 'off' where store_id = ${t.storeA1}`
    expect((await pickup('owner', shipment)).code).toBe('NOT_CONNECTED')
    await db.sql`update store_courier set role = 'pricing' where store_id = ${t.storeA1}`
    expect(courier.pickups).toEqual([])
    expect((await shipments('owner', id))?.find((s) => s['id'] === shipment)?.['pickupRequestedAt']).toBeNull()
  })

  it('is asked once, however many ask at once', async () => {
    courier.pauseMs = 150
    const [a, b] = await Promise.all([pickup('owner', shipment), pickup('staff', shipment)])
    expect([a.code, b.code].filter(Boolean)).toEqual(['PICKUP_ASKED'])
    expect(courier.pickups).toEqual([`ref-${shipment}`])
    expect((await shipments('owner', id))?.find((s) => s['id'] === shipment)).toMatchObject({ pickupDate: '2026-10-13', pickupReference: 'PU-2' })
    const [entry] = await db.sql`select action from activity_log where target_id = ${id} order by occurred_at desc limit 1`
    expect(entry).toEqual({ action: 'order.pickup_requested' })
  })

  it('lets a supplier ask for its own label’s pickup', async () => {
    const scarf = await lineOf(id, versions.scarf)
    const own = String((await book('drop', id, places.drop, [{ id: scarf, quantity: 1 }])).data?.['bookLabel'])
    expect((await pickup('owner', own)).code).toBe('NOT_FOUND')
    expect((await pickup('drop', own)).code).toBeUndefined()
  })
})

describe('the document address', () => {
  it('answers nothing for a malformed or unknown id, and refuses a caller signed out of the store', async () => {
    expect(await documentStatus('owner', 'not-an-id')).toBe(404)
    expect(await documentStatus('owner', crypto.randomUUID())).toBe(404)
    const signedOut = await handleDocument(new Request(`https://store.example/api/documents/${crypto.randomUUID()}`), { ...(await contextFor('owner')), standing: { kind: 'signed-out' } }, files)
    expect(signedOut.status).toBe(401)
  })
})
