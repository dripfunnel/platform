import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deliverySchema, type DeliveryContext } from '#apis/delivery/schema'
import { secretBox, type SecretBox } from '#auth/secretBox'
import type { TenantContext } from '#core/tenancy'
import { withSystemScope } from '#db/scoped/index'
import { createDispatch, createOwnDelivery } from '#engine/modules/ownDelivery/index'
import { catalogExportDeliverer } from '#jobs/queues/deliverers/catalogExport'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { seedStoreWorld, type StoreWorld } from './support/storeWorld'

// DL 18 (#874): the Owner exports and erases a rider's data, and the rider's own Delete my account does the same (DELIVERY §5).

let db: TestDatabase
let tenants: Tenants
let world: StoreWorld
let secrets: SecretBox
let warehouse = ''
const clock = new Date('2026-10-29T12:00:00Z')
const facts = { requestId: 'rider-data-test', ip: null, userAgent: null }
const name = 'Zed Quasarwick'
const phone = '+919800000777'
const customerLine = 'Secret street 14'
const customerPhone = '+919822222999'

const riderContext = (riderId: string): TenantContext => ({ partnerId: tenants.partnerA, storeId: tenants.storeA1, sellerScope: { kind: 'all' }, subscription: 'active', caller: { kind: 'rider', riderId } })
const dispatch = () => createDispatch({ sql: db.sql, context: { ...riderContext(''), caller: { kind: 'person', userId: world.people.owner, sessionId: 't' } }, activity: activityLog, facts, now: () => clock, secrets })
const asRider = (riderId: string, source: string) => {
  const rider = riderContext(riderId)
  const contextValue: DeliveryContext = { sql: db.sql, caller: { storeId: tenants.storeA1, partnerId: tenants.partnerA, available: true, rider: rider as never, token: null }, activity: activityLog, facts, defer: () => undefined, secrets, now: () => clock }
  return graphql({ schema: deliverySchema as GraphQLSchema, source, contextValue })
}

/** A rider with everything the erasure has to reach: a photo, a session, a phone, a position, a code, a text, an entry and an export. */
const seedRider = async (label = name, number = phone) => {
  const [r] = await db.sql<{ id: string }[]>`insert into rider (store_id, name, phone, status, vehicle_type, vehicle_number) values (${tenants.storeA1}, ${label}, ${number}, 'active', 'bike', 'RJ14 7777') returning id`
  const id = r?.id ?? ''
  const [asset] = await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum, created_by) values (${tenants.storeA1}, ${`stores/${tenants.storeA1}/assets/${crypto.randomUUID()}.png`}, 'image', 'image/png', 1, ${'0'.repeat(64)}, ${id}) returning id`
  await db.sql`update rider set photo_asset_id = ${asset?.id ?? ''} where id = ${id}`
  await db.sql`insert into rider_session (id_hash, store_id, rider_id, expires_at) values (${crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')}, ${tenants.storeA1}, ${id}, ${new Date(clock.getTime() + 86_400_000)})`
  await db.sql`insert into push_device (store_id, subject_kind, subject_id, expo_token, platform) values (${tenants.storeA1}, 'rider', ${id}, ${`ExponentPushToken[${id}]`}, 'android')`
  await db.sql`insert into rider_position (rider_id, store_id, latitude, longitude, accuracy_m, reported_at, received_at) values (${id}, ${tenants.storeA1}, 26.9, 75.8, 5, ${clock}, ${clock})`
  await db.sql`insert into rider_code (store_id, phone, code_hash, expires_at) values (${tenants.storeA1}, ${number}, ${'a'.repeat(64)}, ${new Date(clock.getTime() + 600_000)})`
  await db.sql`insert into outbox (kind, idempotency_key, payload, partner_id, store_id) values ('sms', ${`rider.invited:${id}:${crypto.randomUUID()}`}, ${db.sql.json({ message: 'rider.invited', to: number, brand: 'Store A1', vars: { link: 'https://x' } })}, ${tenants.partnerA}, ${tenants.storeA1})`
  await db.sql`insert into outbox (kind, idempotency_key, payload, partner_id, store_id) values ('push', ${`offer:${id}:${crypto.randomUUID()}`}, ${db.sql.json({ message: 'rider.offer', subject: { kind: 'rider', id } })}, ${tenants.partnerA}, ${tenants.storeA1})`
  await world.gql('owner', 'mutation I($id: ID!) { suspendRider(id: $id) { id } }', { id: id }).then(() => db.sql`update rider set status = 'active' where id = ${id}`)
  return id
}
const order = async (): Promise<string> => {
  const [o] = await db.sql<{ id: string }[]>`insert into "order" (store_id, state, number, currency, payment_method, payment_state, shipping_option, delivery_warehouse_id, total_amount, placed_at, email, phone, shipping_address)
    values (${tenants.storeA1}, 'placed', ${crypto.randomUUID().slice(0, 8)}, 'INR', 'cod', 'pending', 'own_delivery', ${warehouse}, 10000, ${clock}, 'shopper@example.com', ${customerPhone},
      ${db.sql.json({ name: 'Secret Person', line1: customerLine, city: 'Jaipur', postalCode: '302017', country: 'IN', phone: customerPhone })}) returning id`
  await db.sql`insert into payment (store_id, order_id, provider, kind, amount, currency, mode) values (${tenants.storeA1}, ${o?.id ?? ''}, 'cod', 'cod', 10000, 'INR', 'live')`
  await withSystemScope(db.sql, (tx) => createOwnDelivery(tx, activityLog, tenants.storeA1, o?.id ?? '', clock))
  return o?.id ?? ''
}
const deliveryOf = async (orderId: string) => (await db.sql<{ id: string; state: string; rider_id: string | null; offer_round: number }[]>`select id, state, rider_id, offer_round from delivery where order_id = ${orderId} order by created_at desc limit 1`)[0]
/** A delivery of this rider's in this state. */
const deliveryFor = async (riderId: string, state: 'assigned' | 'picked_up' | 'delivered') => {
  const orderId = await order()
  const d = await deliveryOf(orderId)
  await db.sql`update delivery set state = 'unassigned' where id = ${d?.id ?? ''}`
  await dispatch().assign(d?.id ?? '', riderId)
  if (state !== 'assigned') await db.sql`update delivery set state = ${state}, picked_up_at = ${clock}, delivered_at = ${state === 'delivered' ? clock : null} where id = ${d?.id ?? ''}`
  return { orderId, deliveryId: d?.id ?? '' }
}
const everywhere = async (needle: string) => {
  const tables = await db.sql<{ table_name: string }[]>`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`
  const found: string[] = []
  for (const { table_name } of tables) {
    const rows = await db.sql.unsafe(`select 1 from "${table_name}" t where t::text like $1 limit 1`, [`%${needle}%`])
    if (rows.length > 0) found.push(table_name)
  }
  return found
}
const runExport = async (riderId: string) => {
  const asked = await world.gql('owner', 'mutation E($id: ID!) { exportRider(id: $id) }', { id: riderId })
  const jobId = asked.data?.['exportRider'] as string
  const [job] = await db.sql<{ payload: unknown }[]>`select payload from outbox where kind = 'export.catalog' and payload->>'jobId' = ${jobId}`
  await catalogExportDeliverer(db.sql, () => clock).deliver({ payload: job?.payload, attempt: 1 } as never, new AbortController().signal)
  return { jobId, asked }
}

beforeAll(async () => {
  db = await createTestDatabase()
  tenants = await seedTenants(db.sql)
  secrets = await secretBox(btoa('k'.repeat(32)))
  world = await seedStoreWorld(db.sql, tenants, { now: () => clock, secrets, lookup: null })
  warehouse = (await db.sql<{ id: string }[]>`select id from warehouse where store_id = ${tenants.storeA1} and seller_id is null limit 1`)[0]?.id ?? ''
  await db.sql`update warehouse set latitude = 26.9124, longitude = 75.7873 where id = ${warehouse}`
  await db.sql`insert into store_shipping (store_id, currency, own_delivery_enabled, dispatch_when, offer_minutes) values (${tenants.storeA1}, 'INR', true, 'placed', 5) on conflict (store_id) do update set own_delivery_enabled = true`
}, 60_000)
afterAll(async () => { await db?.drop() })

describe('exporting a rider’s data', () => {
  it('holds the profile, the deliveries with their area and the sign-in times, and no customer address or phone', async () => {
    const id = await seedRider()
    await deliveryFor(id, 'delivered')
    const { jobId, asked } = await runExport(id)
    expect(asked.code).toBeUndefined()
    const read = await world.gql('owner', 'query R($id: ID!) { riderExport(id: $id) { state rows truncated csv } }', { id: jobId })
    const file = read.data?.['riderExport'] as { state: string; csv: string; rows: number }
    expect(file.state).toBe('done')
    expect(file.csv).toContain(name)
    expect(file.csv).toContain('302017, Jaipur')
    expect(file.csv).toContain('delivered')
    expect(file.csv).not.toContain(customerLine)
    expect(file.csv).not.toContain(customerPhone)
    expect(file.csv).not.toContain('Secret Person')
    expect(file.rows).toBeGreaterThanOrEqual(2)
    expect(await db.sql`select action, actor_id from activity_log where action = 'rider.data_exported' and target_id = ${id}`).toEqual([{ action: 'rider.data_exported', actor_id: world.people.owner }])
  })
})

describe('erasing a rider', () => {
  it('leaves no table holding their name, number, photo, sessions, devices, position or codes, and keeps the deliveries as Former rider', async () => {
    const id = await seedRider('Quill Marrowfield', '+919800000555')
    const { deliveryId } = await deliveryFor(id, 'delivered')
    await runExport(id)
    expect((await everywhere('Quill Marrowfield')).length).toBeGreaterThan(0)
    expect((await everywhere('+919800000555')).length).toBeGreaterThan(0)

    const erased = await world.gql('owner', 'mutation X($id: ID!, $reason: String!) { eraseRider(id: $id, reason: $reason) }', { id, reason: 'Asked to be forgotten' })
    expect(erased.code).toBeUndefined()

    expect(await everywhere('Quill Marrowfield')).toEqual([])
    expect(await everywhere('+919800000555')).toEqual([])
    expect(await db.sql`select name, phone, photo_asset_id, vehicle_type, vehicle_number, status from rider where id = ${id}`).toEqual([{ name: 'Former rider', phone: null, photo_asset_id: null, vehicle_type: null, vehicle_number: null, status: 'removed' }])
    for (const table of ['rider_session', 'rider_position']) expect(await db.sql.unsafe(`select 1 from ${table} where rider_id = $1`, [id])).toHaveLength(0)
    expect(await db.sql`select 1 from push_device where subject_id = ${id}`).toHaveLength(0)
    expect(await db.sql`select 1 from asset where created_by = ${id}`).toHaveLength(0)
    expect(await db.sql`select 1 from catalog_export where kind = 'rider' and filter->>'riderId' = ${id}`).toHaveLength(0)
    expect((await deliveryOf((await db.sql<{ order_id: string }[]>`select order_id from delivery where id = ${deliveryId}`)[0]?.order_id ?? ''))?.rider_id).toBe(id)
    expect(await db.sql`select action, reason, target_label from activity_log where action = 'rider.erased' and target_id = ${id}`).toEqual([{ action: 'rider.erased', reason: 'Asked to be forgotten', target_label: 'Former rider' }])
    expect(await db.sql`select 1 from activity_log where target_id = ${id} and target_label = 'Quill Marrowfield'`).toHaveLength(0)
  })

  it('hands an assigned delivery back to the others, and is refused while the rider carries a parcel, changing nothing', async () => {
    const assignedRider = await seedRider('Ines Handback', '+919800000556')
    const { orderId } = await deliveryFor(assignedRider, 'assigned')
    const round = (await deliveryOf(orderId))?.offer_round ?? 0
    expect((await world.gql('owner', 'mutation X($id: ID!, $reason: String!) { eraseRider(id: $id, reason: $reason) }', { id: assignedRider, reason: 'Left the store' })).code).toBeUndefined()
    expect(await deliveryOf(orderId)).toMatchObject({ state: 'searching', offer_round: round + 1 })

    const carrying = await seedRider('Pia Parcel', '+919800000557')
    await deliveryFor(carrying, 'picked_up')
    const refused = await world.gql('owner', 'mutation X($id: ID!, $reason: String!) { eraseRider(id: $id, reason: $reason) }', { id: carrying, reason: 'Left the store' })
    expect(refused.code).toBe('RIDER_HAS_PARCEL')
    expect(await db.sql`select name, phone, status from rider where id = ${carrying}`).toEqual([{ name: 'Pia Parcel', phone: '+919800000557', status: 'active' }])
    expect(await db.sql`select 1 from rider_session where rider_id = ${carrying}`).toHaveLength(1)
  })

  it('is the Owner’s alone, for this store’s riders alone, and answers another store’s rider as one that does not exist', async () => {
    const id = await seedRider('Gil Guarded', '+919800000558')
    const mutation = 'mutation X($id: ID!, $reason: String!) { eraseRider(id: $id, reason: $reason) }'
    const asked = 'mutation E($id: ID!) { exportRider(id: $id) }'
    for (const who of ['manager', 'staff', 'supplier'] as const) {
      expect((await world.gql(who, mutation, { id, reason: 'x' })).code).toBe('FORBIDDEN')
      expect((await world.gql(who, asked, { id })).code).toBe('FORBIDDEN')
    }
    const missing = (await world.gql('owner', mutation, { id: crypto.randomUUID(), reason: 'x' })).code
    for (const who of ['a2Owner', 'bOwner'] as const) {
      expect((await world.gql(who, mutation, { id, reason: 'x' })).code).toBe(missing)
      expect((await world.gql(who, asked, { id })).code).toBe(missing)
    }
    expect((await world.gql('owner', mutation, { id, reason: '   ' })).code).toBe('INVALID_INPUT')
    expect(await db.sql`select name, status from rider where id = ${id}`).toEqual([{ name: 'Gil Guarded', status: 'active' }])
    const jobId = (await runExport(id)).jobId
    expect((await world.gql('manager', 'query R($id: ID!) { riderExport(id: $id) { state } }', { id: jobId })).code).toBe('FORBIDDEN')
    expect((await world.gql('a2Owner', 'query R($id: ID!) { riderExport(id: $id) { state } }', { id: jobId })).data?.['riderExport'] ?? null).toBeNull()
  })

  it('is what a rider’s own Delete my account does, under the same rules', async () => {
    const id = await seedRider('Dara Deletes', '+919800000559')
    const { orderId } = await deliveryFor(id, 'assigned')
    expect((await asRider(id, 'mutation { deleteMyAccount }')).errors).toBeUndefined()
    expect(await everywhere('Dara Deletes')).toEqual([])
    expect(await everywhere('+919800000559')).toEqual([])
    expect(await db.sql`select name, phone, status from rider where id = ${id}`).toEqual([{ name: 'Former rider', phone: null, status: 'removed' }])
    expect(await deliveryOf(orderId)).toMatchObject({ state: 'searching' })

    const carrying = await seedRider('Pete Parcel', '+919800000560')
    await deliveryFor(carrying, 'picked_up')
    expect((await asRider(carrying, 'mutation { deleteMyAccount }')).errors?.[0]?.extensions['code']).toBe('RIDER_HAS_PARCEL')
    expect(await db.sql`select name from rider where id = ${carrying}`).toEqual([{ name: 'Pete Parcel' }])
  })
})
