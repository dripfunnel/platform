import { readFileSync } from 'node:fs'
import { graphql } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveShopper } from '#auth/shopCaller'
import type { TenantContext } from '#core/tenancy'
import { createCustomerAccounts } from '#engine/modules/customerAccounts/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #1406 (migration 0394, SAAS §5 step 2): a store starts with Cash on delivery where it is offered and a saved flat rate of 0.

let db: TestDatabase
let t: Tenants

const migration = readFileSync(new URL('../migrations/0394_store_default_cod_flat_rate.sql', import.meta.url), 'utf8')
const migration0408 = readFileSync(new URL('../migrations/0408_store_default_email_sign_in.sql', import.meta.url), 'utf8')
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

describe('a new store’s customer accounts (#1492, migration 0408)', () => {
  const auth = async (storeId: string) => (await db.sql<{ email_enabled: boolean; phone_enabled: boolean }[]>`select email_enabled, phone_enabled from store_customer_auth where store_id = ${storeId}`)[0]
  const options = async (storeId: string) => {
    const [s] = await db.sql<{ code: string }[]>`select code from store where id = ${storeId}`
    const host = `${s?.code ?? ''}.shop.example`
    const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`), host, 'shop.example')
    if (found.kind !== 'found') throw new Error('no store')
    const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.7', userAgent: null }, allowAttempt: async () => true, sessionToken: null, allowNewCart: async () => true, now: () => new Date() }
    const run = await graphql({ schema: shopSchema, source: '{ signInOptions { email phone } }', contextValue })
    return run.data?.['signInOptions']
  }

  it('starts with Email and password in India and in the US', async () => {
    const [india, us] = [await store('auth-in', 'IN', 'INR'), await store('auth-us', 'US', 'USD')]
    expect(await auth(india)).toEqual({ email_enabled: true, phone_enabled: false })
    expect(await auth(us)).toEqual({ email_enabled: true, phone_enabled: false })
  })

  it('leaves a store that already chose Both as it is', async () => {
    const id = await store('auth-chosen', 'IN', 'INR')
    await db.sql`update store_customer_auth set phone_enabled = true where store_id = ${id}`
    await db.sql.unsafe(migration0408)
    expect(await auth(id)).toEqual({ email_enabled: true, phone_enabled: true })
  })

  it('answers email only on the Shop API and in Settings › Customer accounts for a new store', async () => {
    const id = await store('auth-api', 'IN', 'INR')
    expect(await options(id)).toEqual({ email: true, phone: false })
    const context: TenantContext = { caller: { kind: 'person', userId: 'u', sessionId: 's' }, partnerId: t.partnerA, storeId: id, sellerScope: { kind: 'all' }, subscription: 'active' }
    const accounts = createCustomerAccounts({ sql: db.sql, context, actor: { id: 'u', partnerId: t.partnerA }, activity: activityLog, facts: { requestId: 'r', ip: null, userAgent: null }, now: () => new Date() })
    expect((await accounts.settings()).mode).toBe('email')
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
