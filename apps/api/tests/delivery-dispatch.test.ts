import { graphql, type GraphQLSchema } from 'graphql'
import { deliverySchema, type DeliveryContext } from '#apis/delivery/schema'
import { createServer } from '#apis/graphql/server'
import { seedStoreWorld, type StoreWorld } from './support/storeWorld'
import { markPaid, applyOutcome } from '#engine/modules/checkout/index'
import { cancelOrderDelivery } from '#engine/modules/ownDelivery/index'
import { hashSessionId } from '#auth/session'
import { prepareEmail } from '#saas/email/index'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DispatchRefused } from '#core/dispatch'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { createDispatch, createOwnDelivery, createRiders, broadcastDelivery, sweepDispatch, releaseRiderDeliveries } from '#engine/modules/ownDelivery/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

let db: TestDatabase
let tenants: Tenants
let world: StoreWorld
let warehouse = ''
const riders: string[] = []
let clock = new Date('2026-10-26T12:00:00Z')
const facts = { requestId: 'dispatch-test', ip: null, userAgent: null }
const context = (riderId?: string, storeId = tenants.storeA1): TenantContext => ({
  partnerId: tenants.partnerA, storeId, sellerScope: { kind: 'all' }, subscription: 'active',
  caller: riderId ? { kind: 'rider', riderId } : { kind: 'person', userId: '00000000-0000-4000-8000-000000000001', sessionId: 'test' },
})
const service = (riderId?: string, storeId = tenants.storeA1) => createDispatch({ sql: db.sql, context: context(riderId, storeId), activity: activityLog, facts, now: () => clock })
const jobFacts = () => ({ storeId: tenants.storeA1, partnerId: tenants.partnerA, activity: activityLog, now: clock })
const order = async (method = 'cod', paid = false, mode = 'live') => {
  const [o] = await db.sql<{ id: string }[]>`insert into "order"(store_id,state,number,currency,payment_method,payment_state,shipping_option,delivery_warehouse_id,total_amount,placed_at,shipping_address)
    values(${tenants.storeA1},'placed',${crypto.randomUUID()},'INR',${method},${paid ? 'paid' : 'pending'},'own_delivery',${warehouse},10000,${clock},'{"line1":"secret street","city":"Jaipur","postalCode":"302017","name":"Secret person"}') returning id`
  if (!o) throw new Error('no order')
  if (method !== 'gift_card') await db.sql`insert into payment(store_id,order_id,provider,kind,amount,currency,mode) values(${tenants.storeA1},${o.id},${method},${method === 'stripe' ? 'card' : method},7500,'INR',${mode})`
  await withSystemScope(db.sql, (tx) => createOwnDelivery(tx, activityLog, tenants.storeA1, o.id, clock))
  return o.id
}
const delivery = async (orderId: string) => {
  const [d] = await db.sql<{ id: string; state: string; offer_round: number; cash_due_amount: string | null; rider_id: string | null }[]>`select id,state,offer_round,cash_due_amount::text,rider_id from delivery where order_id = ${orderId} order by created_at desc,id desc limit 1`
  if (!d) throw new Error('no delivery')
  return d
}
const broadcast = async (orderId: string) => {
  const d = await delivery(orderId)
  await broadcastDelivery(db.sql, jobFacts(), d.id, d.offer_round)
  return d
}
const available = async () => {
  await db.sql`update delivery set state = 'cancelled' where state in ('assigned','searching','unassigned','packing')`
  for (const rider of riders) {
    await service(rider).online(true)
    clock = new Date(clock.getTime() + 11_000)
    await service(rider).report({ lat: 26.9124, lng: 75.7873, accuracy: 5, at: clock.toISOString() })
  }
}

beforeAll(async () => {
  db = await createTestDatabase()
  tenants = await seedTenants(db.sql)
  world = await seedStoreWorld(db.sql, tenants, { now: () => clock, secrets: null, lookup: null })
  const [w] = await db.sql<{ id: string }[]>`select id from warehouse where store_id = ${tenants.storeA1} and seller_id is null limit 1`
  if (!w) throw new Error('no warehouse')
  warehouse = w.id
  await db.sql`update warehouse set latitude = 26.9124, longitude = 75.7873 where id = ${warehouse}`
  await db.sql`insert into store_shipping(store_id,currency,own_delivery_enabled,dispatch_when,offer_minutes) values(${tenants.storeA1},'INR',true,'placed',1) on conflict(store_id) do update set own_delivery_enabled = true,dispatch_when = 'placed',offer_minutes = 1`
  const [sub] = await db.sql<{ plan_id: string; partner_id: string; plan_version: number }[]>`select plan_id,partner_id,plan_version from store_subscription where store_id = ${tenants.storeA1}`
  if (sub) await db.sql`insert into plan_entitlement(plan_id,partner_id,version,key,enabled) values(${sub.plan_id},${sub.partner_id},${sub.plan_version},'own_delivery',true) on conflict(plan_id,version,key) do update set enabled = true`
  for (let i = 0; i < 2; i++) {
    const [r] = await db.sql<{ id: string }[]>`insert into rider(store_id,name,phone,status) values(${tenants.storeA1},${`Rider ${i}`},${`+91980000000${i}`},'active') returning id`
    if (!r) throw new Error('no rider')
    riders.push(r.id)
  }
}, 60_000)
afterAll(async () => { await db?.drop() })

describe('dispatch creation', () => {
  it('creates COD with the remaining payment, and prepaid including full gift card, but waits for transfers and cards', async () => {
    expect(await delivery(await order())).toMatchObject({ state: 'searching', cash_due_amount: '7500', offer_round: 1 })
    for (const method of ['stripe', 'bank_transfer']) {
      const id = await order(method)
      expect(await db.sql`select id from delivery where order_id = ${id}`).toHaveLength(0)
      await db.sql`update "order" set payment_state = 'paid' where id = ${id}`
      await withSystemScope(db.sql, (tx) => createOwnDelivery(tx, activityLog, tenants.storeA1, id, clock))
      expect((await delivery(id)).state).toBe('searching')
    }
    expect((await delivery(await order('gift_card', true))).cash_due_amount).toBeNull()
    const preview = await order('cod', false, 'test')
    expect(await db.sql`select id from delivery where order_id = ${preview}`).toHaveLength(0)
  })
  it('waits in packing until ready, and makes creation idempotent', async () => {
    await db.sql`update store_shipping set dispatch_when = 'ready' where store_id = ${tenants.storeA1}`
    const id = await order()
    expect((await delivery(id)).state).toBe('packing')
    await withSystemScope(db.sql, (tx) => createOwnDelivery(tx, activityLog, tenants.storeA1, id, clock))
    expect(await db.sql`select id from delivery where order_id = ${id}`).toHaveLength(1)
    await service().ready(id)
    expect((await delivery(id)).state).toBe('searching')
    await expect(service().ready(id)).rejects.toMatchObject({ code: 'NOT_PACKING' })
    await db.sql`update store_shipping set dispatch_when = 'placed' where store_id = ${tenants.storeA1}`
  })
})

describe('broadcast, race and rounds', () => {
  it('offers nearby riders once, without customer details, and exactly one parallel accept wins', async () => {
    await available()
    const id = await order()
    await broadcast(id)
    await broadcast(id)
    const offers = await db.sql<{ id: string; rider_id: string }[]>`select id,rider_id from delivery_offer where delivery_id = ${(await delivery(id)).id} order by rider_id`
    expect(offers).toHaveLength(2)
    const page = await service(riders[0]).offers({ limit: 20, after: null, before: null })
    expect(JSON.stringify(page)).not.toMatch(/secret street|Secret person/)
    expect(page[0]?.area).toBe('302017, Jaipur')
    const results = await Promise.allSettled(offers.map((o) => service(o.rider_id).answer(o.id, true)))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    expect((await delivery(id)).state).toBe('assigned')
  })
  it('declines only one offer, re-offers decliners next round, and refuses old round accepts', async () => {
    await available()
    const id = await order()
    const d = await broadcast(id)
    const [offer] = await db.sql<{ id: string; rider_id: string }[]>`select id,rider_id from delivery_offer where delivery_id = ${d.id} limit 1`
    if (!offer) throw new Error('no offer')
    await service(offer.rider_id).answer(offer.id, false)
    clock = new Date(clock.getTime() + 61_000)
    await sweepDispatch(db.sql, activityLog, clock)
    expect((await delivery(id)).state).toBe('unassigned')
    await service().again(d.id)
    await broadcast(id)
    expect(await db.sql`select id from delivery_offer where delivery_id = ${d.id} and rider_id = ${offer.rider_id}`).toHaveLength(2)
    await expect(service(offer.rider_id).answer(offer.id, true)).rejects.toMatchObject({ code: 'TAKEN' })
    expect(await db.sql`select id from outbox where kind = 'email' and payload->>'deliveryId' = ${d.id}`).toHaveLength(1)
  })
  it('hands back on offline without re-offering that rider; blocks hand-back while carrying a parcel', async () => {
    await available()
    const id = await order()
    const d = await broadcast(id)
    await db.sql`update delivery set state = 'unassigned' where id = ${d.id}`
    const riderId = riders[0] ?? ''
    await service().assign(d.id, riderId)
    await service(riderId).online(false)
    await broadcast(id)
    expect(await db.sql`select id from delivery_offer where delivery_id = ${d.id} and offer_round = 2 and rider_id = ${riderId}`).toHaveLength(0)
    await db.sql`update delivery set state = 'picked_up',rider_id = ${riderId} where id = ${d.id}`
    await expect(withSystemScope(db.sql, (tx) => releaseRiderDeliveries(tx, jobFacts(), riderId, 'test'))).rejects.toBeInstanceOf(DispatchRefused)
    await db.sql`update delivery set state = 'cancelled' where id = ${d.id}`
  })
  it('unassigns with no riders, permits manual assignment, cancels and starts a new attempt', async () => {
    await available()
    for (const r of riders) await service(r).online(false)
    const id = await order()
    const d = await broadcast(id)
    expect((await delivery(id)).state).toBe('unassigned')
    await service().assign(d.id, riders[0] ?? '')
    await service().cancel(d.id)
    await service().again(d.id)
    expect(await db.sql`select id from delivery where order_id = ${id}`).toHaveLength(2)
  })
})

describe('position and isolation', () => {
  it('suspension, removal, account deletion and sign-out protect parcels and hand assigned work back atomically', async () => {
    for (const [index, action] of ['suspendRider', 'removeRider', 'deleteMyAccount', 'signOut'].entries()) {
      const [rider] = await db.sql<{ id: string }[]>`insert into rider(store_id,name,phone,status,online_at) values(${tenants.storeA1},'Lifecycle rider',${`+91981111110${index}`},'active',${clock}) returning id`
      if (!rider) throw new Error('no rider')
      const token = crypto.randomUUID().replaceAll('-', '').repeat(2)
      await db.sql`insert into rider_session(id_hash,store_id,rider_id,expires_at) values(${await hashSessionId(token)},${tenants.storeA1},${rider.id},${new Date(clock.getTime() + 86400000)})`
      await db.sql`insert into rider_position(rider_id,store_id,latitude,longitude,accuracy_m,reported_at,received_at) values(${rider.id},${tenants.storeA1},26.9,75.7,5,${clock},${clock})`
      const id = await order()
      const d = await delivery(id)
      await db.sql`update delivery set state = 'picked_up',rider_id = ${rider.id} where id = ${d.id}`
      const riderContext = { ...context(rider.id), caller: { kind: 'rider' as const, riderId: rider.id } }
      const contextValue: DeliveryContext = { sql: db.sql, caller: { storeId: tenants.storeA1, partnerId: tenants.partnerA, available: true, rider: riderContext, token }, activity: activityLog, facts, now: () => clock, defer: () => undefined }
      const run = async () => {
        if (action === 'suspendRider' || action === 'removeRider') return world.gql('owner', `mutation { ${action}(id: "${rider.id}") ${action === 'suspendRider' ? '{ id }' : ''} }`)
        const answer = await graphql({ schema: deliverySchema as GraphQLSchema, source: `mutation { ${action} }`, contextValue })
        return { code: answer.errors?.[0]?.extensions['code'], data: answer.data }
      }
      expect((await run()).code).toBe('RIDER_HAS_PARCEL')
      expect(await db.sql`select id_hash from rider_session where rider_id = ${rider.id} and ended_at is null`).toHaveLength(1)
      await db.sql`update delivery set state = 'assigned' where id = ${d.id}`
      expect((await run()).code).toBeUndefined()
      expect(await delivery(id)).toMatchObject({ state: 'searching', offer_round: 2, rider_id: null })
      expect(await db.sql`select rider_id from rider_position where rider_id = ${rider.id}`).toHaveLength(0)
    }
  })
  it('answers a refusal with its code through the server, which masks any other error', async () => {
    const [rider] = await db.sql<{ id: string }[]>`insert into rider(store_id,name,phone,status,online_at) values(${tenants.storeA1},'Server rider','+919833333300','active',${clock}) returning id`
    if (!rider) throw new Error('no rider')
    const token = crypto.randomUUID().replaceAll('-', '').repeat(2)
    await db.sql`insert into rider_session(id_hash,store_id,rider_id,expires_at) values(${await hashSessionId(token)},${tenants.storeA1},${rider.id},${new Date(clock.getTime() + 86400000)})`
    const d = await delivery(await order())
    await db.sql`update delivery set state = 'picked_up',rider_id = ${rider.id} where id = ${d.id}`
    const riderContext = { ...context(rider.id), caller: { kind: 'rider' as const, riderId: rider.id } }
    const contextValue: DeliveryContext = { sql: db.sql, caller: { storeId: tenants.storeA1, partnerId: tenants.partnerA, available: true, rider: riderContext, token }, activity: activityLog, facts, now: () => clock, defer: () => undefined }
    const server = createServer<DeliveryContext>(deliverySchema as GraphQLSchema, '/delivery-api')
    const ask = async (query: string) => {
      const answer = await server.fetch(new Request('http://localhost/delivery-api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) }), contextValue)
      return ((await answer.json()) as { errors?: { message: string; extensions: { code: string } }[] }).errors?.[0]
    }
    expect((await ask('mutation { acceptOffer(id: "00000000-0000-4000-8000-000000000000") }'))?.extensions.code).toBe('TAKEN')
    const signOut = await ask('mutation { signOut }')
    expect(signOut?.extensions.code).toBe('RIDER_HAS_PARCEL')
    expect(signOut?.message).not.toMatch(/unexpected/i)
  })
  it('shows the rider phone to a person with orders.read and never to an API key with orders.read only', async () => {
    const id = await order()
    const d = await delivery(id)
    await db.sql`update delivery set state = 'assigned', rider_id = ${riders[1] ?? ''}, assigned_at = ${clock} where id = ${d.id}`
    const query = 'query O($id: ID!) { order(id: $id) { delivery { rider { name phone } } } }'
    const riderOf = (data: Record<string, unknown> | null | undefined) => (data?.['order'] as { delivery: { rider: { name: string; phone: string | null } } } | undefined)?.delivery.rider
    expect(riderOf((await world.gql('staff', query, { id })).data)).toEqual({ name: 'Rider 1', phone: '+919800000001' })
    const made = await world.gql('owner', 'mutation { createApiKey(name: "Ledger", scopes: ["orders.read"]) { secret } }')
    const secret = (made.data?.['createApiKey'] as { secret: string } | undefined)?.secret ?? ''
    const byKey = await world.bearer(secret, `query { order(id: "${id}") { delivery { rider { name phone } } } }`, tenants.partnerA)
    expect(byKey.code).toBeUndefined()
    expect(riderOf(byKey.data)).toEqual({ name: 'Rider 1', phone: null })
    await db.sql`update delivery set state = 'cancelled' where id = ${d.id}`
  })
  it('lets only the owning store merchant suspend or remove a rider, and refuses suppliers and read-only support', async () => {
    const [rider] = await db.sql<{ id: string }[]>`insert into rider(store_id,name,phone,status) values(${tenants.storeA1},'Guarded rider','+919822222200','active') returning id`
    if (!rider) throw new Error('no rider')
    expect((await world.gql('a2Owner', `mutation { suspendRider(id: "${rider.id}") { id } }`)).code).toBe('NOT_FOUND')
    const as = (caller: TenantContext['caller'], sellerScope: TenantContext['sellerScope'] = { kind: 'all' }) => createRiders({
      sql: db.sql, context: { ...context(), caller, sellerScope }, actor: { id: world.people.owner, partnerId: tenants.partnerA }, activity: activityLog, facts,
      plan: { ownDelivery: async () => true, allowance: async () => 10 }, shopDomain: null, send: async () => undefined, now: () => clock,
    })
    const refused = { ok: false, reason: 'FORBIDDEN' }
    expect(await as(context().caller, { kind: 'seller', sellerId: tenants.sellerA1First }).suspend(rider.id)).toEqual(refused)
    expect(await as({ kind: 'support', supportSessionId: 's', partnerUserId: 'p', access: 'read' }).remove(rider.id)).toEqual(refused)
    expect(await db.sql`select status from rider where id = ${rider.id}`).toEqual([{ status: 'active' }])
  })
  it('composes the unassigned email for active fulfilment seats in the partner look and waits for its portal', async () => {
    const d = await delivery(await order())
    const row = { storeId: tenants.storeA1, partnerId: tenants.partnerA, payload: { template: 'delivery-unassigned', deliveryId: d.id } }
    const hosts = { adminHost: 'admin.example', platformHost: 'platform.example', shopDomain: 'shop.example' }
    await expect(withSystemScope(db.sql, (tx) => prepareEmail(tx, row, hosts, clock))).rejects.toMatchObject({ code: 'no_portal_host' })
    await db.sql`insert into partner_domain(partner_id,kind,host,status,record_type,expected) values(${tenants.partnerA},'portal','portal.dispatch.example','live','CNAME','example')`
    const email = await withSystemScope(db.sql, (tx) => prepareEmail(tx, row, hosts, clock))
    expect(email.send).toBe(true)
    if (!email.send) throw new Error('email not prepared')
    expect([...email.to].sort()).toEqual(['manager@a.example', 'owner@a.example', 'staff@a.example'])
    expect(email.voice.kind).toBe('partner')
    expect(email.content.subject).toMatch(/^Nobody took order /)
    expect(email.content.action?.url).toContain('https://portal.dispatch.example/orders/')
    const foreign = await withSystemScope(db.sql, (tx) => prepareEmail(tx, { ...row, partnerId: tenants.partnerB }, hosts, clock))
    expect(foreign).toMatchObject({ send: false, reason: 'tenant_mismatch' })
  })
  it('keeps an assigned delivery when a position expires, but never offers stale or distant riders new work', async () => {
    await available()
    const id = await order()
    const d = await broadcast(id)
    const [offer] = await db.sql<{ id: string; rider_id: string }[]>`select id,rider_id from delivery_offer where delivery_id = ${d.id} limit 1`
    if (!offer) throw new Error('no offer')
    await service(offer.rider_id).answer(offer.id, true)
    clock = new Date(clock.getTime() + 601_000)
    await sweepDispatch(db.sql, activityLog, clock)
    expect((await delivery(id)).state).toBe('assigned')
    await available()
    const far = riders[0] ?? ''
    clock = new Date(clock.getTime() + 11_000)
    await service(far).report({ lat: 28.6139, lng: 77.209, accuracy: 5, at: clock.toISOString() })
    const next = await broadcast(await order())
    expect(await db.sql`select id from delivery_offer where delivery_id = ${next.id} and rider_id = ${far}`).toHaveLength(0)
  })
  it('cannot win two simultaneous automatic assignments on different orders', async () => {
    await available()
    const ids = [await order(), await order()]
    for (const id of ids) await broadcast(id)
    const rider = riders[0] ?? ''
    const ds = await Promise.all(ids.map(delivery))
    const offers = await db.sql<{ id: string }[]>`select id from delivery_offer where rider_id = ${rider} and delivery_id in (${ds[0]?.id ?? ''},${ds[1]?.id ?? ''})`
    const answers = await Promise.allSettled(offers.map((o) => service(rider).answer(o.id, true)))
    expect(answers.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(answers.filter((r) => r.status === 'rejected')).toHaveLength(1)
  })
  it('uses the actual transfer mark-paid and card settlement paths', async () => {
    const id = await order('bank_transfer')
    const result = await markPaid({ sql: db.sql, context: context(), actor: { id: world.people.owner, partnerId: tenants.partnerA }, activity: activityLog, facts, now: () => clock }, id)
    expect(result.ok).toBe(true)
    expect((await delivery(id)).state).toBe('searching')
    const card = await order('stripe')
    const reference = crypto.randomUUID()
    await db.sql`update payment set provider_ref = ${reference} where order_id = ${card}`
    expect(await applyOutcome({ sql: db.sql, activity: activityLog, now: () => clock }, 'stripe', reference, { state: 'captured', amount: { amount: 7500n, currency: 'INR' } })).toBe('paid')
    expect((await delivery(card)).state).toBe('searching')
  })
  it('exposes the Delivery API with capped pages and enforces the rider boundary', async () => {
    await available()
    for (let i = 0; i < 51; i++) await broadcast(await order())
    const id = riders[0] ?? ''
    const rider = { ...context(id), caller: { kind: 'rider' as const, riderId: id } }
    const contextValue: DeliveryContext = { sql: db.sql, caller: { storeId: tenants.storeA1, partnerId: tenants.partnerA, available: true, rider, token: null }, activity: activityLog, facts, now: () => clock, defer: () => undefined }
    const result = await graphql({ schema: deliverySchema as GraphQLSchema, source: '{ offers(first: 999) { nodes { id area itemCount distanceM warehouse } pageInfo { hasNextPage } } }', contextValue })
    expect(result.errors).toBeUndefined()
    const page = (result.data as { offers: { nodes: unknown[]; pageInfo: { hasNextPage: boolean } } }).offers
    expect(page.nodes).toHaveLength(50)
    expect(page.pageInfo.hasNextPage).toBe(true)
    expect(JSON.stringify(result.data)).not.toMatch(/secret street|Secret person/)
    const signedOut = await graphql({ schema: deliverySchema as GraphQLSchema, source: 'mutation { setOnline(online: true) }', contextValue: { ...contextValue, caller: { ...contextValue.caller, rider: null } } })
    expect(signedOut.errors?.[0]?.extensions['code']).toBe('UNAUTHENTICATED')
  }, 120_000)
  it('exposes merchant dispatch only in the acting store and excludes supplier reads', async () => {
    const id = await order()
    const d = await delivery(id)
    const query = 'query O($id: ID!) { order(id: $id) { delivery { id state steps { state } } } }'
    const own = await world.gql('owner', query, { id })
    expect(own.code).toBeUndefined()
    expect(JSON.stringify(own.data)).toContain(d.id)
    const foreign = await world.gql('a2Owner', query, { id })
    expect(JSON.stringify(foreign.data)).not.toContain(d.id)
    const denied = await world.gql('supplier', 'mutation A($id: ID!, $r: ID!) { assignDelivery(deliveryId: $id, riderId: $r) }', { id: d.id, r: riders[0] })
    expect(denied.code).toBe('FORBIDDEN')
    expect(JSON.stringify((await world.gql('supplier', query, { id })).data)).not.toContain(d.id)
    await withSystemScope(db.sql, (tx) => cancelOrderDelivery(tx, jobFacts(), id))
    expect((await delivery(id)).state).toBe('cancelled')
  })
  it('serializes writes, ignores old points, rejects future reports and expires stale positions', async () => {
    await available()
    const r = riders[0] ?? ''
    await expect(service(r).report({ lat: 1, lng: 2, accuracy: 3, at: new Date(clock.getTime() + 100_000).toISOString() })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    clock = new Date(clock.getTime() + 11_000)
    await db.sql`create table dispatch_position_write_count (writes integer not null)`
    await db.sql`grant select,update on dispatch_position_write_count to app_system`
    await db.sql`insert into dispatch_position_write_count values(0)`
    await db.sql`create function count_dispatch_position_write() returns trigger language plpgsql as $$ begin update dispatch_position_write_count set writes = writes + 1; return new; end $$`
    await db.sql`create trigger dispatch_position_write_counter after insert or update on rider_position for each row execute function count_dispatch_position_write()`
    const results = await Promise.allSettled([1, 2].map((n) => service(r).report({ lat: n, lng: 2, accuracy: 3, at: new Date(clock.getTime() + n).toISOString() })))
    expect(results.some((v) => v.status === 'fulfilled')).toBe(true)
    // An older point can succeed without writing if the newer parallel request won first (#842).
    expect(await db.sql`select writes from dispatch_position_write_count`).toEqual([{ writes: 1 }])
    await db.sql`drop trigger dispatch_position_write_counter on rider_position`
    await db.sql`drop function count_dispatch_position_write()`
    await db.sql`drop table dispatch_position_write_count`
    await service(r).online(false)
    await service(r).online(true)
    await expect(service(r).report({ lat: 3, lng: 2, accuracy: 3, at: new Date(clock.getTime() + 5).toISOString() })).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    clock = new Date(clock.getTime() + 601_000)
    await sweepDispatch(db.sql, activityLog, clock)
    expect(await db.sql`select rider_id from rider_position`).toHaveLength(0)
    expect(await db.sql`select id from rider where online_at is not null and store_id = ${tenants.storeA1}`).toHaveLength(0)
  })
  it('does not expose or accept foreign offers and keeps rider rows isolated by RLS', async () => {
    await available()
    const id = await order()
    const d = await broadcast(id)
    const [o] = await db.sql<{ id: string }[]>`select id from delivery_offer where delivery_id = ${d.id} and rider_id = ${riders[0] ?? ''}`
    await expect(service(riders[1]).answer(o?.id ?? '', true)).rejects.toMatchObject({ code: 'TAKEN' })
    expect(await withScope(db.sql, context(riders[0], tenants.storeA2), (tx) => tx`select id from delivery_offer`)).toHaveLength(0)
    const own = await withScope(db.sql, context(riders[0]), (tx) => tx<{ rider_id: string }[]>`select rider_id from delivery_offer`)
    expect(own.every((row) => row.rider_id === riders[0])).toBe(true)
  })
})
