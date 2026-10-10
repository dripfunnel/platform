import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CallerContext, SellerScope, TenantContext } from '#core/tenancy'
import { withScope } from '#db/scoped/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #320 (SAPI 14), part 1: the offers tables (migration 0076; DATA-MODEL §7.7, §7.11). The merchant's alone, store by
// store: no supplier, shopper, partner or staff role reads a row, and the uses are the engine's to count (ACCESS §11).

let db: TestDatabase
let t: Tenants
const offers = { a1: '', a2: '' }

const store = (storeId: string, sellerScope: SellerScope = { kind: 'all' }): TenantContext => ({
  caller: { kind: 'person', userId: '00000000-0000-4000-8000-0000000000aa', sessionId: 's' },
  partnerId: t.partnerA,
  storeId,
  sellerScope,
  subscription: 'active',
})
const support = (access: 'read' | 'write'): CallerContext => ({ ...store(t.storeA1), caller: { kind: 'support', supportSessionId: 'ss', partnerUserId: 'pu', access } })
const shopper: () => CallerContext = () => ({ ...store(t.storeA1), caller: { kind: 'shopper', customerId: t.customerA1 } })
const tables = ['promotion', 'promotion_condition', 'promotion_action', 'promotion_code_batch', 'promotion_code', 'promotion_usage'] as const

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  const make = async (storeId: string, code: string) => {
    const [p] = await db.sql<{ id: string }[]>`insert into promotion (store_id, name, trigger, enabled) values (${storeId}, 'Summer', 'code', true) returning id`
    const id = p?.id ?? ''
    await db.sql`insert into promotion_action (promotion_id, store_id, operation, args, position) values (${id}, ${storeId}, 'order_percentage_discount', '{"percent": 10}', 0)`
    await db.sql`insert into promotion_condition (promotion_id, store_id, operation, args, position) values (${id}, ${storeId}, 'first_order', '{}', 0)`
    const [b] = await db.sql<{ id: string }[]>`insert into promotion_code_batch (promotion_id, store_id, prefix, length, count) values (${id}, ${storeId}, 'IG-', 8, 1) returning id`
    await db.sql`insert into promotion_code (promotion_id, store_id, code) values (${id}, ${storeId}, ${code})`
    await db.sql`insert into promotion_code (promotion_id, store_id, batch_id, code, single_use) values (${id}, ${storeId}, ${b?.id ?? ''}, ${`IG-${code}`}, true)`
    const [o] = await db.sql<{ id: string }[]>`
      insert into "order" (store_id, state, payment_state, currency, number, placed_at, subtotal_amount, shipping_amount, total_amount, payment_method, email)
      values (${storeId}, 'placed', 'paid', 'INR', ${`N-${code}`}, now(), 10000, 0, 9000, 'cod', 'asha@example.com') returning id`
    await db.sql`insert into promotion_usage (promotion_id, store_id, order_id, customer_email, discount_amount, currency) values (${id}, ${storeId}, ${o?.id ?? ''}, 'asha@example.com', 1000, 'INR')`
    return id
  }
  offers.a1 = await make(t.storeA1, 'SUMMER20')
  offers.a2 = await make(t.storeA2, 'SUMMER20')
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const count = (context: CallerContext, table: (typeof tables)[number]) =>
  withScope(db.sql, context, async (tx) => Number((await tx<{ n: string }[]>`select count(*)::text as n from ${tx(table)}`)[0]?.n ?? -1))

describe('the offers tables', () => {
  it('give the merchant side its own store’s rows only, counts included', async () => {
    for (const table of tables) expect({ table, n: await count(store(t.storeA1), table) }).toEqual({ table, n: table === 'promotion_code' ? 2 : 1 })
    const ids = await withScope(db.sql, store(t.storeA1), (tx) => tx<{ id: string }[]>`select id from promotion`)
    expect(ids.map((r) => r.id)).toEqual([offers.a1])
    expect(await count(support('read'), 'promotion')).toBe(1)
  })

  it('give a supplier, a shopper, a partner and staff nothing: no role of theirs holds a grant (OFFERS fact 15)', async () => {
    const others: CallerContext[] = [
      store(t.storeA1, { kind: 'seller', sellerId: t.sellerA1First }),
      shopper(),
      { caller: { kind: 'partner-user', partnerUserId: 'pu' }, partnerId: t.partnerA },
      { caller: { kind: 'staff', staffId: 'st' } },
    ]
    for (const context of others) {
      for (const table of tables) await expect(count(context, table)).rejects.toThrow(/permission denied/i)
    }
  })

  it('keep the use count, the code’s use and the usage rows the engine’s: a request role can’t write them', async () => {
    await expect(withScope(db.sql, store(t.storeA1), (tx) => tx`update promotion set uses_count = 0 where id = ${offers.a1}`)).rejects.toThrow(/permission denied/i)
    await expect(withScope(db.sql, store(t.storeA1), (tx) => tx`update promotion_code set used_at = null`)).rejects.toThrow(/permission denied/i)
    await expect(withScope(db.sql, store(t.storeA1), (tx) => tx`delete from promotion_usage`)).rejects.toThrow(/permission denied/i)
    await expect(withScope(db.sql, store(t.storeA1), (tx) => tx`delete from promotion where id = ${offers.a1}`)).rejects.toThrow(/permission denied/i)
  })

  it('let the merchant write its own store’s offers, never another’s, and a read-only support session nothing', async () => {
    const write = (context: CallerContext, storeId: string) => withScope(db.sql, context, (tx) => tx`insert into promotion (store_id, name, trigger) values (${storeId}, 'New', 'automatic')`)
    await write(store(t.storeA1), t.storeA1)
    await expect(write(store(t.storeA1), t.storeA2)).rejects.toThrow(/row-level security/i)
    await expect(write(support('read'), t.storeA1)).rejects.toThrow(/row-level security/i)
    await write(support('write'), t.storeA1)
    const renamed = await withScope(db.sql, store(t.storeA1), (tx) => tx`update promotion set name = 'Taken' where id = ${offers.a2}`)
    expect(renamed.count).toBe(0)
  })

  it('hold a code unique per store whatever its case, and leave another store free to use it (#188, #337)', async () => {
    await expect(db.sql`insert into promotion_code (promotion_id, store_id, code) values (${offers.a1}, ${t.storeA1}, 'SUMMER20')`).rejects.toThrow(/promotion_code_store_code_key/)
    await db.sql`update promotion set deleted_at = now() where id = ${offers.a1}`
    await expect(db.sql`insert into promotion_code (promotion_id, store_id, code) values (${offers.a1}, ${t.storeA1}, 'SUMMER20')`).rejects.toThrow(/promotion_code_store_code_key/)
    await expect(db.sql`insert into promotion_code (promotion_id, store_id, code) values (${offers.a1}, ${t.storeA1}, 'summer20')`).rejects.toThrow(/promotion_code_code_check/)
  })

  it('holds a usage row to its own store at every end: offer, code, customer and order', async () => {
    const [code] = await db.sql<{ id: string }[]>`select id from promotion_code where store_id = ${t.storeA2} limit 1`
    const [order] = await db.sql<{ id: string }[]>`
      insert into "order" (store_id, state, payment_state, currency, number, placed_at, subtotal_amount, shipping_amount, total_amount, payment_method)
      values (${t.storeA1}, 'placed', 'paid', 'INR', 'N-KEYS', now(), 100, 0, 100, 'cod') returning id`
    const use = (o: { codeId?: string; customerId?: string }) =>
      db.sql`insert into promotion_usage (promotion_id, promotion_code_id, store_id, order_id, customer_id, discount_amount, currency)
        values (${offers.a1}, ${o.codeId ?? null}, ${t.storeA1}, ${order?.id ?? ''}, ${o.customerId ?? null}, 1, 'INR')`
    await expect(use({ codeId: code?.id ?? '' })).rejects.toThrow(/promotion_usage_promotion_code_id_store_id_fkey/)
    await expect(use({ customerId: t.customerA2 })).rejects.toThrow(/promotion_usage_customer_id_store_id_fkey/)
  })

  it('adds the live-offer limit to the plan settings, unlimited for every version written before it', async () => {
    expect(await db.sql`select kind from plan_key where key = 'live_offers'`).toEqual([{ kind: 'amount' }])
    const short = await db.sql`select 1 from plan_version v where not exists (select 1 from plan_entitlement e where e.plan_id = v.plan_id and e.version = v.version and e.key = 'live_offers')`
    expect(short).toHaveLength(0)
  })
})
