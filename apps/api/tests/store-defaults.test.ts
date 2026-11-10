import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #1406 (migration 0394, SAAS §5 step 2): a store starts with Cash on delivery where it is offered and a saved flat rate of 0.

let db: TestDatabase
let t: Tenants

const migration = readFileSync(new URL('../migrations/0394_store_default_cod_flat_rate.sql', import.meta.url), 'utf8')
const backfill = migration.slice(migration.indexOf('-- Stores that already exist'))

const store = async (code: string, country: string, currency: string, status = 'active') =>
  (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status) values (${t.partnerA}, ${code}, ${code}, ${country}, ${currency}, ${status}) returning id`)[0]?.id ?? ''
const cod = async (storeId: string) => (await db.sql<{ status: string }[]>`select status from payment_provider_account where store_id = ${storeId} and provider = 'cod'`)[0]?.status ?? null
const shipping = async (storeId: string) =>
  (await db.sql<{ flat_enabled: boolean; flat_amount: string; currency: string; saved: boolean }[]>`
    select flat_enabled, flat_amount::text as flat_amount, currency, saved_at is not null as saved from store_shipping where store_id = ${storeId}`)[0] ?? null

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('a new store', () => {
  it('in India starts with Cash on delivery live and a saved flat rate of 0', async () => {
    const id = await store('defaults-in', 'IN', 'INR')
    expect(await cod(id)).toBe('live')
    expect(await shipping(id)).toEqual({ flat_enabled: true, flat_amount: '0', currency: 'INR', saved: true })
  })

  it('outside India gets no Cash on delivery, only the flat rate of 0 in its own currency', async () => {
    const id = await store('defaults-us', 'US', 'USD')
    expect(await cod(id)).toBeNull()
    expect(await shipping(id)).toEqual({ flat_enabled: true, flat_amount: '0', currency: 'USD', saved: true })
  })
})

describe('the backfill', () => {
  it('fills a store without either, keeps a merchant’s own choice, and skips a closed store', async () => {
    const [empty, chosen, closed] = [await store('backfill-empty', 'IN', 'INR'), await store('backfill-chosen', 'IN', 'INR'), await store('backfill-closed', 'IN', 'INR', 'closed')]
    // As before the migration: no rows, or the merchant's own.
    await db.sql`delete from payment_provider_account where store_id in ${db.sql([empty, closed])}`
    await db.sql`delete from store_shipping where store_id in ${db.sql([empty, closed])}`
    await db.sql`update payment_provider_account set status = 'off' where store_id = ${chosen} and provider = 'cod'`
    await db.sql`update store_shipping set flat_amount = 4900 where store_id = ${chosen}`

    await db.sql.unsafe(backfill)

    expect([await cod(empty), await shipping(empty)]).toEqual(['live', { flat_enabled: true, flat_amount: '0', currency: 'INR', saved: true }])
    expect([await cod(chosen), (await shipping(chosen))?.flat_amount]).toEqual(['off', '4900'])
    expect([await cod(closed), await shipping(closed)]).toEqual([null, null])
  })
})
