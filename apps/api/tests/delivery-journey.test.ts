import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deliverySchema, type DeliveryContext } from '#apis/delivery/schema'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveRider } from '#auth/riderCaller'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { resolveShopper } from '#auth/shopCaller'
import { sweepDispatch, offerKind } from '#engine/modules/ownDelivery/index'
import { deliveryOfferDeliverer } from '#jobs/queues/deliverers/deliveryOffer'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { seedStoreWorld, type StoreWorld } from './support/storeWorld'

// DL 17 (#873): the whole own-delivery journey through the three public APIs, as the apps call them (DELIVERY §3, §4, §7, §8).

type Answer = { data: Record<string, unknown> | null | undefined; code: string | undefined }

let db: TestDatabase
let tenants: Tenants
let world: StoreWorld
let secrets: SecretBox
let warehouse = ''
let version = ''
let clock = new Date('2026-10-29T09:00:00Z')
const host = 'store-a1.shop.example'
const hostB = 'store-b1.shop.example'
const shopDomain = 'shop.example'
const pin = { latitude: 26.9124, longitude: 75.7873 }
const door = { latitude: 26.915, longitude: 75.79 }
const phones = ['+919811100001', '+919811100002']
const tokens: string[] = []
const riderIds: string[] = []
let tokenB = ''
const tick = (ms: number) => { clock = new Date(clock.getTime() + ms) }
const now = () => clock

const store = (source: string, variables: Record<string, unknown> = {}) => world.gql('owner', source, variables)
const refused = async (call: Promise<Answer>) => (await call).code

const asRider = async (token: string | null, source: string, variables: Record<string, unknown> = {}, at = host): Promise<Answer> => {
  const caller = await resolveRider(db.sql, new Request(`https://${at}/delivery-api/`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), at, shopDomain, clock)
  if (!caller) throw new Error('no store on that host')
  const deferred: Promise<unknown>[] = []
  const contextValue: DeliveryContext = { sql: db.sql, caller, activity: activityLog, facts: { requestId: 'journey', ip: '203.0.113.7', userAgent: null }, allowAttempt: async () => true, defer: (work) => deferred.push(work), secrets, now }
  const result = await graphql({ schema: deliverySchema as GraphQLSchema, source, contextValue, variableValues: variables })
  await Promise.all(deferred)
  return { data: result.data as Answer['data'], code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const asShopper = async (cart: string | null, source: string, at = host): Promise<Answer> => {
  const found = await resolveShopper(db.sql, new Request(`https://${at}/shop-api`, { headers: cart ? { 'x-shop-cart': cart } : {} }), at, shopDomain)
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${at}`, activity: activityLog, facts: { requestId: 'journey', ip: '203.0.113.5', userAgent: null }, couriers: null, allowAttempt: async () => true, allowNewCart: async () => true, secrets, now }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Answer['data'], code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

const signIn = async (phone: string, at = host) => {
  await asRider(null, 'mutation R($phone: String!) { requestCode(phone: $phone) }', { phone }, at)
  const [sms] = await db.sql<{ payload: { vars: { code: string } } }[]>`select payload from outbox where kind = 'sms' and payload->>'to' = ${phone} order by created_at desc limit 1`
  const session = await asRider(null, 'mutation S($phone: String!, $code: String!) { signIn(phone: $phone, code: $code) { sessionToken } }', { phone, code: sms?.payload.vars.code ?? '' }, at)
  const token = (session.data?.['signIn'] as { sessionToken: string } | null | undefined)?.sessionToken
  if (!token) throw new Error(`sign-in refused: ${session.code ?? ''}`)
  return token
}
/** Both riders online, with a fresh position at the warehouse's pin. */
const goOnline = async () => {
  for (const token of tokens) {
    await asRider(token, 'mutation { setOnline(online: true) }')
    tick(11_000)
    await report(token)
  }
}
const report = (token: string) => asRider(token, 'mutation P($lat: Float!, $lng: Float!, $at: String!) { reportPosition(lat: $lat, lng: $lng, accuracy: 5, at: $at) }', { lat: pin.latitude, lng: pin.longitude, at: clock.toISOString() })

/** The offer job, then the pushes it queued, as the relay runs them; `pushed` is every push payload it handed over. */
const pushed: { message: string; deliveryId?: string }[] = []
const relay = async () => {
  const deliverers = { [offerKind]: deliveryOfferDeliverer(db.sql, activityLog, now), push: { deliver: async (effect: { payload: unknown }) => void pushed.push(effect.payload as { message: string; deliveryId?: string }) } }
  await relayDue(db.sql, deliverers, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
}
const offersOf = async (token: string) => ((await asRider(token, '{ offers { nodes { id deliveryId } } }')).data?.['offers'] as { nodes: { id: string; deliveryId: string }[] }).nodes

/** A guest's cart delivered to the pin, checked out and placed. */
const place = async (provider: 'cod' | 'bank_transfer' = 'cod') => {
  const added = await asShopper(null, `mutation { addToCart(versionId: "${version}", quantity: 2) { cartToken } }`)
  const cart = (added.data?.['addToCart'] as { cartToken: string }).cartToken
  await asShopper(cart, 'mutation { setCartContact(email: "asha@example.com") { cart { id } } }')
  await asShopper(cart, `mutation { setShippingAddress(address: { name: "Asha Mehta", line1: "1 MI Road", city: "Jaipur", region: "Rajasthan", postalCode: "302001", country: "IN", phone: "+919822222222", latitude: ${door.latitude}, longitude: ${door.longitude} }) { cart { id } } }`)
  await asShopper(cart, 'mutation { setShippingOption(option: "own_delivery") { cart { id } } }')
  await asShopper(cart, 'mutation { checkout { id } }')
  const placed = await asShopper(cart, `mutation { placeOrder(provider: "${provider}") { orderId } }`)
  const orderId = (placed.data?.['placeOrder'] as { orderId: string } | null)?.orderId
  if (!orderId) throw new Error(`placeOrder refused: ${placed.code ?? ''}`)
  return { cart, orderId }
}
const deliveryOf = async (orderId: string) => {
  const [d] = await db.sql<{ id: string; state: string; rider_id: string | null; offer_round: number }[]>`select id, state, rider_id, offer_round from delivery where order_id = ${orderId} order by created_at desc, id desc limit 1`
  if (!d) throw new Error('no delivery')
  return d
}
const codeOf = async (deliveryId: string) => {
  const [row] = await db.sql<{ handover_code_enc: string | null }[]>`select handover_code_enc from delivery where id = ${deliveryId}`
  return (row?.handover_code_enc ? await secrets.open(row.handover_code_enc) : null)?.split(':')[1] ?? ''
}
const wrong = (code: string) => (code === '0000' ? '1111' : '0000')
const customerRead = async (cart: string, orderId: string) =>
  (await asShopper(cart, `{ order(id: "${orderId}") { delivery { state handoverCode etaAt rider { firstName phone vehicleNumber } position { latitude longitude } steps { state } } } }`)).data?.['order'] as {
    delivery: { state: string; handoverCode: string | null; rider: { firstName: string; phone: string | null } | null; position: { latitude: number } | null; steps: { state: string }[] } | null
  }
const riderRead = async (token: string, deliveryId: string) =>
  (await asRider(token, `{ delivery(id: "${deliveryId}") { state customer { name phone address { line1 } latitude note } cashDueAmount } }`)).data?.['delivery'] as { state: string; customer: { name: string | null; phone: string | null } | null; cashDueAmount: string | null } | null
const stock = async () => (await db.sql<{ on_hand: number; reserved: number }[]>`select on_hand, reserved from stock_level where version_id = ${version} and warehouse_id = ${warehouse}`)[0]
const movements = async (orderId: string) => (await db.sql`select 1 from stock_movement where source_id = ${orderId}`).length
const logged = async (deliveryId: string) => (await db.sql<{ action: string }[]>`select action from activity_log where target_id = ${deliveryId} order by occurred_at, id`).map((r) => r.action)
const nothingLeaks = async (code: string) => {
  const payloads = await db.sql<{ payload: unknown }[]>`select payload from outbox where kind in ('push', 'sms', 'email') or kind like 'order.%' or kind like 'delivery%'`
  const text = [...payloads.map((p) => JSON.stringify(p.payload)), ...pushed.map((p) => JSON.stringify(p))].join('\n')
  expect(text).not.toMatch(new RegExp(`(?<![0-9a-zA-Z-])${code}(?![0-9a-zA-Z-])`))
}

/** An order placed, offered to both riders, and accepted by the first to answer; the other's answer is TAKEN. */
const accepted = async (provider: 'cod' | 'bank_transfer' = 'cod') => {
  await goOnline()
  const { cart, orderId } = await place(provider)
  if (provider === 'bank_transfer') {
    expect(await db.sql`select id from delivery where order_id = ${orderId}`).toHaveLength(0)
    expect(await refused(store(`mutation { markOrderPaid(orderId: "${orderId}") }`))).toBeUndefined()
  }
  await relay()
  const [first, second] = await Promise.all(tokens.map(offersOf))
  expect(first).toHaveLength(1)
  expect(second).toHaveLength(1)
  const win = await asRider(tokens[0] ?? null, `mutation { acceptOffer(id: "${first?.[0]?.id ?? ''}") }`)
  const lose = await asRider(tokens[1] ?? null, `mutation { acceptOffer(id: "${second?.[0]?.id ?? ''}") }`)
  expect(win.code).toBeUndefined()
  expect(lose.code).toBe('TAKEN')
  return { cart, orderId, deliveryId: first?.[0]?.deliveryId ?? '' }
}

beforeAll(async () => {
  db = await createTestDatabase()
  tenants = await seedTenants(db.sql)
  secrets = await secretBox(btoa('k'.repeat(32)))
  world = await seedStoreWorld(db.sql, tenants, { now, secrets, lookup: null, extra: { domains: { edgeZone: 'dripfunnel.example', localHosts: false, shopDomain } } })
  await db.sql`update partner set state = 'live' where id = ${tenants.partnerA}`
  await db.sql`update store set status = 'active', country = 'IN', pricing_currency = 'INR' where id = ${tenants.storeA1}`
  const [sub] = await db.sql<{ plan_id: string; plan_version: number }[]>`select plan_id, plan_version from store_subscription where store_id = ${tenants.storeA1}`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled, amount) values (${sub?.plan_id ?? ''}, ${tenants.partnerA}, ${sub?.plan_version ?? 1}, 'own_delivery', true, null), (${sub?.plan_id ?? ''}, ${tenants.partnerA}, ${sub?.plan_version ?? 1}, 'riders', null, 20)`
  await db.sql`insert into payment_provider_account (store_id, provider, mode, status, bank_details) values (${tenants.storeA1}, 'cod', 'live', 'live', null), (${tenants.storeA1}, 'bank_transfer', 'live', 'live', 'Journey Bank 0001')`
  warehouse = (await db.sql<{ id: string }[]>`select id from warehouse where store_id = ${tenants.storeA1} and seller_id is null limit 1`)[0]?.id ?? ''
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${tenants.storeA1}, 'Mug', 'journey-mug', 'visible') returning id`
  version = (await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, track_stock) values (${tenants.storeA1}, ${p?.id ?? ''}, 'JOURNEY-MUG', 0, true) returning id`)[0]?.id ?? ''
  await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${version}, ${tenants.storeA1}, 'INR', 3000)`
  await db.sql`insert into stock_level (version_id, warehouse_id, store_id, seller_id, on_hand) values (${version}, ${warehouse}, ${tenants.storeA1}, null, 100)`

  // The Owner's side: two riders invited, a pinned delivering location, own delivery on.
  for (const [i, phone] of phones.entries()) {
    const invited = await store('mutation I($name: String!, $phone: String!) { inviteRider(name: $name, phone: $phone) { id } }', { name: `Rider ${i}`, phone })
    riderIds.push((invited.data?.['inviteRider'] as { id: string }).id)
    tokens.push(await signIn(phone))
  }
  // Another partner's store, with a rider of its own, for the isolation case.
  await db.sql`update partner set state = 'live' where id = ${tenants.partnerB}`
  await db.sql`update store set status = 'active', country = 'IN', pricing_currency = 'INR' where id = ${tenants.storeB1}`
  const [subB] = await db.sql<{ plan_id: string; plan_version: number }[]>`select plan_id, plan_version from store_subscription where store_id = ${tenants.storeB1}`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled, amount) values (${subB?.plan_id ?? ''}, ${tenants.partnerB}, ${subB?.plan_version ?? 1}, 'own_delivery', true, null), (${subB?.plan_id ?? ''}, ${tenants.partnerB}, ${subB?.plan_version ?? 1}, 'riders', null, 20)`
  await world.gql('bOwner', 'mutation I($name: String!, $phone: String!) { inviteRider(name: $name, phone: $phone) { id } }', { name: 'Rider B', phone: '+919811100009' })
  tokenB = await signIn('+919811100009', hostB)
  const revision = (await db.sql<{ revision: number }[]>`select revision from warehouse where id = ${warehouse}`)[0]?.revision ?? 0
  const saved = await store('mutation W($id: ID, $r: Int, $i: WarehouseInput!) { saveWarehouse(id: $id, revision: $r, input: $i) }', { id: warehouse, r: revision, i: { name: 'Depot', ...pin, ownDelivery: true, deliveryRadiusM: 10000, deliveryFeeAmount: '4000' } })
  expect(saved.code).toBeUndefined()
  await saveShipping({ ownDelivery: true, dispatchWhen: 'placed' })
}, 90_000)
afterAll(async () => { await db?.drop() })

const saveShipping = async (input: Record<string, unknown>) => {
  const settings = (await store('{ shippingSettings { revision } }')).data?.['shippingSettings'] as { revision: number }
  const saved = await store('mutation S($r: Int!, $i: ShippingInput!) { saveShipping(revision: $r, input: $i) }', { r: settings.revision, i: { courierRate: false, flatRate: true, flatAmount: '4900', pickup: true, pickupHours: 'Mon–Sat', freeMode: 'never', areaMode: 'everywhere', ...input } })
  expect(saved.code).toBeUndefined()
}

describe.each([['cod' as const], ['bank_transfer' as const]])('the journey, paid by %s', (provider) => {
  it('goes from the order to delivered, and the customer and the rider each see only their part', async () => {
    const { cart, orderId, deliveryId } = await accepted(provider)
    const before = await stock()

    // Accepting reveals no customer to the rider, and the customer sees the rider and the handover code.
    expect((await riderRead(tokens[0] ?? '', deliveryId))?.customer).toBeNull()
    const assigned = await customerRead(cart, orderId)
    expect(assigned.delivery).toMatchObject({ state: 'assigned', rider: { firstName: 'Rider' }, position: null })
    const code = assigned.delivery?.handoverCode ?? ''
    expect(code).toMatch(/^\d{4}$/)
    expect(code).toBe(await codeOf(deliveryId))
    expect((await asRider(tokens[1] ?? null, `{ delivery(id: "${deliveryId}") { state } }`)).data?.['delivery']).toBeNull()

    // Pickup moves the stock once; the position is shown from then on, and the customer's details reach the rider.
    expect((await asRider(tokens[0] ?? null, `mutation { markPickedUp(id: "${deliveryId}") }`)).code).toBeUndefined()
    expect(await stock()).toEqual({ on_hand: (before?.on_hand ?? 0) - 2, reserved: (before?.reserved ?? 0) - 2 })
    expect(await movements(orderId)).toBe(1)
    tick(15_000)
    await report(tokens[0] ?? '')
    expect((await customerRead(cart, orderId)).delivery).toMatchObject({ state: 'picked_up', position: { latitude: pin.latitude } })
    expect((await riderRead(tokens[0] ?? '', deliveryId))?.customer).toMatchObject({ name: 'Asha Mehta', phone: '+919822222222' })

    // A wrong code, then the right one (with the cash when it is cash on delivery).
    tick(60_000)
    const at = clock.toISOString()
    const cashCollected = provider === 'cod'
    expect(await refused(asRider(tokens[0] ?? null, `mutation { markDelivered(id: "${deliveryId}", code: "${wrong(code)}", cashCollected: ${cashCollected}, at: "${at}", key: "k-wrong") }`))).toBe('WRONG_CODE')
    expect((await deliveryOf(orderId)).state).toBe('picked_up')
    if (cashCollected) expect(await refused(asRider(tokens[0] ?? null, `mutation { markDelivered(id: "${deliveryId}", code: "${code}", at: "${at}", key: "k-nocash") }`))).toBe('CASH_NOT_CONFIRMED')
    expect(await refused(asRider(tokens[0] ?? null, `mutation { markDelivered(id: "${deliveryId}", code: "${code}", cashCollected: ${cashCollected}, at: "${at}", key: "k-right") }`))).toBeUndefined()
    expect((await deliveryOf(orderId)).state).toBe('delivered')
    expect(await db.sql`select payment_state from "order" where id = ${orderId}`).toEqual([{ payment_state: 'paid' }])

    // After the end the customer loses the rider's details, position and code, and the rider loses the customer's.
    expect((await customerRead(cart, orderId)).delivery).toMatchObject({ state: 'delivered', rider: null, position: null, handoverCode: null })
    expect((await riderRead(tokens[0] ?? '', deliveryId))?.customer).toBeNull()

    expect(await logged(deliveryId)).toEqual(expect.arrayContaining(['delivery.created', 'delivery.accepted', 'delivery.picked_up', 'delivery.code_refused', 'delivery.delivered']))
    await nothingLeaks(code)
  })
})

describe('when the store dispatches when ready', () => {
  it('offers nothing until Ready for pickup', async () => {
    await saveShipping({ ownDelivery: true, dispatchWhen: 'ready' })
    await goOnline()
    const { orderId } = await place()
    expect((await deliveryOf(orderId)).state).toBe('packing')
    await relay()
    expect(await Promise.all(tokens.map(offersOf))).toEqual([[], []])
    expect(await refused(store(`mutation { markReadyForPickup(orderId: "${orderId}") }`))).toBeUndefined()
    await relay()
    expect((await Promise.all(tokens.map(offersOf))).map((o) => o.length)).toEqual([1, 1])
    await saveShipping({ ownDelivery: true, dispatchWhen: 'placed' })
    await sweepDispatch(db.sql, activityLog, new Date(clock.getTime() + 3_600_000))
  })
})

describe('another store', () => {
  it('reads and changes nothing of this store’s delivery, and answers as it would for one that does not exist', async () => {
    const { cart, orderId, deliveryId } = await accepted()
    const [offerId] = (await db.sql<{ id: string }[]>`select id from delivery_offer where delivery_id = ${deliveryId} limit 1`).map((o) => o.id)
    const nobody = crypto.randomUUID()
    const asB = (source: string) => asRider(tokenB, source, {}, hostB)

    expect((await asB(`{ delivery(id: "${deliveryId}") { state } }`)).data?.['delivery']).toBeNull()
    expect((await asB('{ offers { nodes { id } } }')).data?.['offers']).toMatchObject({ nodes: [] })
    for (const step of ['acceptOffer', 'declineOffer', 'markPickedUp', 'handBack']) {
      const real = await asB(`mutation { ${step}(id: "${step.endsWith('Offer') ? offerId ?? '' : deliveryId}") }`)
      const none = await asB(`mutation { ${step}(id: "${nobody}") }`)
      expect(real.code).toBeDefined()
      expect(real.code).toBe(none.code)
    }
    expect((await deliveryOf(orderId)).state).toBe('assigned')

    // The customer's order is not readable from another store's shop, by its own token either.
    expect((await asShopper(cart, `{ order(id: "${orderId}") { delivery { state } } }`, hostB)).data?.['order'] ?? null).toBeNull()
    expect((await customerRead(cart, orderId)).delivery?.state).toBe('assigned')
    await db.sql`update delivery set state = 'cancelled' where id = ${deliveryId}`
  })
})

/** Whoever has an open offer takes it; the index of the rider who got the delivery. */
const claim = async () => {
  await relay()
  for (const [i, token] of tokens.entries()) {
    const [offer] = await offersOf(token)
    if (!offer) continue
    expect((await asRider(token, `mutation { acceptOffer(id: "${offer.id}") }`)).code).toBeUndefined()
    return i
  }
  throw new Error('nobody was offered it')
}
const pickUp = async (token: string, deliveryId: string) => expect(await refused(asRider(token, `mutation { markPickedUp(id: "${deliveryId}") }`))).toBeUndefined()
const offerRoundOf = async (orderId: string) => (await deliveryOf(orderId)).offer_round
const openOffers = async () => (await Promise.all(tokens.map(offersOf))).map((o) => o.length)

describe('the branches', () => {
  beforeAll(async () => {
    await db.sql`update delivery set state = 'cancelled' where state in ('packing', 'searching', 'unassigned', 'assigned')`
    await goOnline()
  })

  it('Not delivered, then Offer again: a new delivery with a new code, and no second stock movement', async () => {
    const { cart, orderId, deliveryId } = await accepted()
    expect(await codeOf(deliveryId)).toMatch(/^\d{4}$/)
    await pickUp(tokens[0] ?? '', deliveryId)
    tick(60_000)
    expect(await refused(asRider(tokens[0] ?? null, `mutation { markFailed(id: "${deliveryId}", reason: refused, at: "${clock.toISOString()}", key: "k-failed") }`))).toBeUndefined()
    expect((await deliveryOf(orderId)).state).toBe('failed')
    expect((await riderRead(tokens[0] ?? '', deliveryId))?.customer).toBeNull()
    // The ended delivery's code is gone; the next one is sealed afresh (a 1-in-10,000 repeat of the digits is not a failure).
    expect(await codeOf(deliveryId)).toBe('')
    expect(await refused(store(`mutation { offerDeliveryAgain(deliveryId: "${deliveryId}") }`))).toBeUndefined()

    const again = await deliveryOf(orderId)
    expect(again).toMatchObject({ state: 'searching' })
    expect(again.id).not.toBe(deliveryId)
    await goOnline()
    const winner = await claim()
    const second = await deliveryOf(orderId)
    expect(second.state).toBe('assigned')
    const secondCode = await codeOf(second.id)
    expect(secondCode).toMatch(/^\d{4}$/)
    expect(await codeOf(deliveryId)).toBe('')
    expect((await customerRead(cart, orderId)).delivery?.steps.length).toBeGreaterThan(1)
    const onHand = (await stock())?.on_hand
    await pickUp(tokens[winner] ?? '', second.id)
    expect(await movements(orderId)).toBe(1)
    expect((await stock())?.on_hand).toBe(onHand)
    tick(30_000)
    await asRider(tokens[winner] ?? null, `mutation { markDelivered(id: "${second.id}", code: "${secondCode}", cashCollected: true, at: "${clock.toISOString()}", key: "k-second") }`)
    expect((await deliveryOf(orderId)).state).toBe('delivered')
  })

  it('hand back, then Offer again: the same riders are offered it again in a new round', async () => {
    await goOnline()
    const { orderId, deliveryId } = await accepted()
    const round = await offerRoundOf(orderId)
    expect(await refused(asRider(tokens[0] ?? null, `mutation { handBack(id: "${deliveryId}") }`))).toBeUndefined()
    expect(await offerRoundOf(orderId)).toBe(round + 1)
    await relay()
    expect(await openOffers()).toEqual([0, 1])
    tick(11 * 60_000)
    await sweepDispatch(db.sql, activityLog, clock)
    expect((await deliveryOf(orderId)).state).toBe('unassigned')
    expect(await refused(store(`mutation { offerDeliveryAgain(deliveryId: "${deliveryId}") }`))).toBeUndefined()
    await goOnline()
    await relay()
    expect(await openOffers()).toEqual([1, 1])
    expect(await offerRoundOf(orderId)).toBeGreaterThan(round + 1)
    await db.sql`update delivery set state = 'cancelled' where order_id = ${orderId}`
  })

  it('a wrong code that arrives late is CODE_UNCONFIRMED, and the merchant confirms it with the cash', async () => {
    await goOnline()
    const { cart, orderId, deliveryId } = await accepted()
    const code = await codeOf(deliveryId)
    await pickUp(tokens[0] ?? '', deliveryId)
    tick(10 * 60_000)
    const late = new Date(clock.getTime() - 5 * 60_000).toISOString()
    const send = (key: string) => asRider(tokens[0] ?? null, `mutation { markDelivered(id: "${deliveryId}", code: "${wrong(code)}", cashCollected: true, at: "${late}", key: "${key}") }`)
    expect(await refused(send('k-late'))).toBe('CODE_UNCONFIRMED')
    expect(await refused(send('k-late-2'))).toBe('CODE_UNCONFIRMED')
    expect(await db.sql`select payload->>'template' as template from outbox where kind = 'email' and payload->>'deliveryId' = ${deliveryId}`).toEqual([{ template: 'delivery-code-unconfirmed' }])
    expect((await deliveryOf(orderId)).state).toBe('picked_up')
    expect(await refused(store(`mutation { markDeliveryDelivered(deliveryId: "${deliveryId}", reason: "Customer confirmed by phone", cashReceived: true) }`))).toBeUndefined()
    expect((await deliveryOf(orderId)).state).toBe('delivered')
    expect(await db.sql`select payment_state from "order" where id = ${orderId}`).toEqual([{ payment_state: 'paid' }])
    expect((await customerRead(cart, orderId)).delivery).toMatchObject({ state: 'delivered', rider: null, handoverCode: null })
    await nothingLeaks(code)
  })

  it('a recall after pickup ends the rider’s access to the customer and tells them to bring the parcel back', async () => {
    await goOnline()
    const { orderId, deliveryId } = await accepted()
    await pickUp(tokens[0] ?? '', deliveryId)
    expect((await riderRead(tokens[0] ?? '', deliveryId))?.customer).toMatchObject({ name: 'Asha Mehta' })
    expect(await refused(store(`mutation { cancelDelivery(deliveryId: "${deliveryId}") }`))).toBeUndefined()
    expect(await deliveryOf(orderId)).toMatchObject({ state: 'failed' })
    expect((await riderRead(tokens[0] ?? '', deliveryId))?.customer).toBeNull()
    expect(await logged(deliveryId)).toContain('delivery.recalled')
    expect(await db.sql`select 1 from outbox where kind = 'push' and payload->>'message' = 'rider.recalled' and payload->>'deliveryId' = ${deliveryId}`).toHaveLength(1)
  })

  it('suspending a rider hands their assigned delivery to the others, and is refused while they carry a parcel', async () => {
    await goOnline()
    const { orderId, deliveryId } = await accepted()
    const round = await offerRoundOf(orderId)
    const suspended = await store(`mutation { suspendRider(id: "${riderIds[0] ?? ''}") { id } }`)
    expect(suspended.code).toBeUndefined()
    expect(await offerRoundOf(orderId)).toBe(round + 1)
    expect((await deliveryOf(orderId)).state).toBe('searching')
    expect((await asRider(tokens[0] ?? null, '{ me { id } }')).data?.['me']).toBeNull()
    await store(`mutation { restoreRider(id: "${riderIds[0] ?? ''}") { id } }`)
    tokens[0] = await signIn(phones[0] ?? '')
    await goOnline()
    await db.sql`update delivery set state = 'cancelled' where id = ${deliveryId}`

    const carried = await accepted()
    await pickUp(tokens[0] ?? '', carried.deliveryId)
    expect((await store(`mutation { suspendRider(id: "${riderIds[0] ?? ''}") { id } }`)).code).toBe('RIDER_HAS_PARCEL')
    expect(await db.sql`select status from rider where id = ${riderIds[0] ?? ''}`).toEqual([{ status: 'active' }])
  })
})
