import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CallerContext, SellerScope } from '#core/tenancy'
import { withScope } from '#db/scoped/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// DELIVERY §3 and DATA-MODEL §3.6: the merchant reads its own store's deliveries, offers and positions, a rider reads
// only its own and writes only its own position, and no other caller reads them (migration 0364).

let db: TestDatabase
let t: Tenants
const riders = { a1: '', a1Other: '', a2: '' }
const deliveries = { a1: '', a1Other: '', a2: '' }

const insertOne = async (query: Promise<{ id: string }[]>): Promise<string> => {
  const [row] = await query
  if (!row) throw new Error('seed row missing')
  return row.id
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  const sql = db.sql
  const seed = async (storeId: string, name: string, phone: string) => {
    const warehouse = await insertOne(sql`insert into warehouse (store_id, name, is_default) values (${storeId}, 'Depot', false) returning id`)
    const rider = await insertOne(sql`insert into rider (store_id, name, phone, status) values (${storeId}, ${name}, ${phone}, 'active') returning id`)
    const order = await insertOne(sql`insert into "order" (store_id, state, number, currency, payment_method, payment_state, shipping_option, delivery_warehouse_id, total_amount, placed_at, shipping_address)
      values (${storeId}, 'placed', ${crypto.randomUUID()}, 'INR', 'cod', 'pending', 'own_delivery', ${warehouse}, 10000, now(), '{"city":"Jaipur"}') returning id`)
    const delivery = await insertOne(sql`insert into delivery (store_id, order_id, warehouse_id, state, rider_id, currency, offer_round, handover_code_enc)
      values (${storeId}, ${order}, ${warehouse}, 'assigned', ${rider}, 'INR', 1, 'sealed') returning id`)
    await sql`insert into delivery_offer (delivery_id, store_id, offer_round, rider_id, distance_m, sent_at) values (${delivery}, ${storeId}, 1, ${rider}, 100, now())`
    await sql`insert into rider_position (rider_id, store_id, latitude, longitude, accuracy_m, reported_at, received_at) values (${rider}, ${storeId}, 26.9, 75.8, 5, now(), now())`
    return { rider, delivery }
  }
  const a1 = await seed(t.storeA1, 'Rider A1', '+919800000001')
  const a1Other = await seed(t.storeA1, 'Rider A1 other', '+919800000002')
  const a2 = await seed(t.storeA2, 'Rider A2', '+919800000003')
  riders.a1 = a1.rider
  riders.a1Other = a1Other.rider
  riders.a2 = a2.rider
  deliveries.a1 = a1.delivery
  deliveries.a1Other = a1Other.delivery
  deliveries.a2 = a2.delivery
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const store = (storeId: string, sellerScope: SellerScope = { kind: 'all' }): CallerContext => ({
  caller: { kind: 'person', userId: '00000000-0000-4000-8000-0000000000aa', sessionId: 's' },
  partnerId: t.partnerA,
  storeId,
  sellerScope,
  subscription: 'active',
})
const rider = (riderId: string, storeId = t.storeA1): CallerContext => ({
  caller: { kind: 'rider', riderId },
  partnerId: t.partnerA,
  storeId,
  sellerScope: { kind: 'all' },
  subscription: 'active',
})

const tables = ['delivery', 'delivery_offer', 'rider_position'] as const
const countAll = (context: CallerContext) =>
  withScope(db.sql, context, async (tx) => {
    const counts: Record<string, number> = {}
    for (const table of tables) {
      const [row] = await tx<{ n: string }[]>`select count(*)::text as n from ${tx(table)}`
      counts[table] = Number(row?.n)
    }
    return counts
  })

describe('the merchant side', () => {
  it('reads its own store’s rows and nothing of a sibling store', async () => {
    expect(await countAll(store(t.storeA1))).toEqual({ delivery: 2, delivery_offer: 2, rider_position: 2 })
    expect(await countAll(store(t.storeA2))).toEqual({ delivery: 1, delivery_offer: 1, rider_position: 1 })
  })

  it('cannot write any of them', async () => {
    await expect(withScope(db.sql, store(t.storeA1), (tx) => tx`update delivery set state = 'cancelled' where id = ${deliveries.a1}`)).rejects.toThrow(/permission denied/i)
    await expect(withScope(db.sql, store(t.storeA1), (tx) => tx`delete from rider_position where rider_id = ${riders.a1}`)).rejects.toThrow(/permission denied/i)
  })

  it('never reads the handover code or its attempts', async () => {
    await expect(withScope(db.sql, store(t.storeA1), (tx) => tx`select handover_code_enc from delivery`)).rejects.toThrow(/permission denied/i)
    await expect(withScope(db.sql, store(t.storeA1), (tx) => tx`select code_attempts from delivery`)).rejects.toThrow(/permission denied/i)
    await expect(withScope(db.sql, store(t.storeA1), (tx) => tx`select * from delivery`)).rejects.toThrow(/permission denied/i)
  })
})

describe('a rider', () => {
  it('reads only its own delivery, offer and position', async () => {
    expect(await countAll(rider(riders.a1))).toEqual({ delivery: 1, delivery_offer: 1, rider_position: 1 })
    const ids = await withScope(db.sql, rider(riders.a1), (tx) => tx<{ id: string }[]>`select id from delivery`)
    expect(ids.map((r) => r.id)).toEqual([deliveries.a1])
  })

  it('reads nothing when claiming another store', async () => {
    expect(await countAll(rider(riders.a2, t.storeA1))).toEqual({ delivery: 0, delivery_offer: 0, rider_position: 0 })
  })

  it('writes its own position and no other rider’s', async () => {
    await withScope(db.sql, rider(riders.a1), (tx) => tx`update rider_position set latitude = 27 where rider_id = ${riders.a1}`)
    await withScope(db.sql, rider(riders.a1), async (tx) => {
      expect((await tx`update rider_position set latitude = 1 where rider_id = ${riders.a1Other} returning rider_id`).length).toBe(0)
      expect((await tx`delete from rider_position where rider_id = ${riders.a1Other} returning rider_id`).length).toBe(0)
    })
    await expect(
      withScope(db.sql, rider(riders.a1), (tx) => tx`insert into rider_position (rider_id, store_id, latitude, longitude, accuracy_m, reported_at, received_at)
        values (${riders.a1Other}, ${t.storeA1}, 1, 1, 1, now(), now()) on conflict (rider_id) do nothing`),
    ).rejects.toThrow(/row-level security/i)
    const [row] = await db.sql<{ latitude: number }[]>`select latitude from rider_position where rider_id = ${riders.a1Other}`
    expect(row?.latitude).toBe(26.9)
  })

  it('cannot write a delivery or an offer, or read the handover code', async () => {
    await expect(withScope(db.sql, rider(riders.a1), (tx) => tx`update delivery set state = 'delivered' where id = ${deliveries.a1}`)).rejects.toThrow(/permission denied/i)
    await expect(withScope(db.sql, rider(riders.a1), (tx) => tx`update delivery_offer set answer = 'accepted'`)).rejects.toThrow(/permission denied/i)
    await expect(withScope(db.sql, rider(riders.a1), (tx) => tx`select handover_code_enc from delivery`)).rejects.toThrow(/permission denied/i)
  })
})

describe('every other caller', () => {
  const others: [string, () => CallerContext][] = [
    ['a supplier', () => store(t.storeA1, { kind: 'seller', sellerId: t.sellerA1First })],
    ['a shopper', () => ({ caller: { kind: 'shopper', customerId: t.customerA1 }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' }, subscription: 'active' })],
    ['a partner user', () => ({ caller: { kind: 'partner-user', partnerUserId: 'pu' }, partnerId: t.partnerA })],
    ['staff', () => ({ caller: { kind: 'staff', staffId: 'st' } })],
  ]
  it.each(others)('%s reads none of them', async (_, context) => {
    for (const table of tables) {
      await expect(withScope(db.sql, context(), (tx) => tx`select 1 from ${tx(table)} limit 1`)).rejects.toThrow(/permission denied|row-level security/i)
    }
  })
})
