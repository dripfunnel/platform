import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import type { CallerContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #296 (SAPI 6, part 4): Settings › Store info (SetStore; DATA-MODEL §7.2).

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-05T09:00:00Z')
type Who = 'owner' | 'manager' | 'supplier' | 'bOwner'
const people: Record<Who, string> = { owner: '', manager: '', supplier: '', bOwner: '' }
const cookies: Record<Who, string> = { owner: '', manager: '', supplier: '', bOwner: '' }

const user = async (partnerId: string, email: string, name: string) =>
  (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`)[0]?.id ?? ''

const subscribe = async (storeId: string, partnerId: string, limits: { languages: number; currencies: number }) => {
  const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${`Plan ${storeId.slice(0, 6)}`}, 'live') returning id`
  for (const [key, amount] of Object.entries({ products: 50, ...limits })) {
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${partnerId}, 1, ${key}, ${amount})`
  }
  await db.sql`update store set plan_id = ${plan?.id ?? ''}, pricing_currency = 'INR', country = 'IN' where id = ${storeId}`
  await db.sql`delete from store_subscription where store_id = ${storeId}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${storeId}, ${partnerId}, ${plan?.id ?? ''}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})`
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await subscribe(t.storeA1, t.partnerA, { languages: 2, currencies: 3 })
  await subscribe(t.storeB1, t.partnerB, { languages: 2, currencies: 3 })
  people.owner = await user(t.partnerA, 'owner@a.example', 'Olivia')
  people.manager = await user(t.partnerA, 'manager@a.example', 'Mo')
  people.supplier = await user(t.partnerA, 'anand@a.example', 'Anand')
  people.bOwner = await user(t.partnerB, 'owner@b.example', 'Bea')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.manager}, ${t.storeA1}, 'manager', 'active'), (${people.bOwner}, ${t.storeB1}, 'owner', 'active')`
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${people.supplier}, ${t.storeA1}, ${t.sellerA1First}, 'supplier-admin', 'active')`
  for (const who of Object.keys(cookies) as Who[]) {
    cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: who === 'bOwner' ? t.partnerB : t.partnerA }, now))
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const gql = async (source: string, who: Who, variables: Record<string, unknown> = {}) => {
  const partnerId = who === 'bOwner' ? t.partnerB : t.partnerA
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: who === 'bOwner' ? t.storeB1 : t.storeA1, ...(who === 'supplier' ? { [supplierHeader]: t.sellerA1First } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: activityLog, facts, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, errors: result.errors }
}

type Info = { name: string; legalName: string; description: string; logoAssetId: string | null; address: { street: string; city: string; postal: string; region: string }; contactEmail: string | null; contactPhone: string | null; country: string | null; taxId: string | null; timeZone: string; unitSystem: string; orderPrefix: string; nextOrderNumber: string }
const infoFields = 'name legalName description logoAssetId address { street city postal region } contactEmail contactPhone country taxId timeZone unitSystem orderPrefix nextOrderNumber'
const info = async (who: Who = 'owner') => (await gql(`{ storeInfo { ${infoFields} } }`, who)).data?.['storeInfo'] as Info | null
const save = (input: Record<string, unknown>, who: Who = 'owner') => gql('mutation S($input: StoreInfoInput!) { saveStoreInfo(input: $input) }', who, { input })
const base = {
  name: 'Kesari Threads',
  legalName: 'Kesari Threads Pvt Ltd',
  description: 'Everyday clothes, made to last.',
  address: { street: '12 MI Road', city: 'Jaipur', postal: '302001', region: 'Rajasthan' },
  contactEmail: 'hello@kesari.example',
  contactPhone: '+91 98290 00000',
  taxId: '08abcde1234f1z5',
  timeZone: 'Asia/Kolkata',
  unitSystem: 'metric',
  orderPrefix: 'kt-',
  nextOrderNumber: 2849,
}

describe('Settings › Store info', () => {
  it('saves the section, the legal name and the home country’s tax id in their own homes', async () => {
    expect((await save(base)).data?.['saveStoreInfo']).toBe(true)
    expect(await info()).toEqual({
      name: 'Kesari Threads',
      legalName: 'Kesari Threads Pvt Ltd',
      description: 'Everyday clothes, made to last.',
      logoAssetId: null,
      address: { street: '12 MI Road', city: 'Jaipur', postal: '302001', region: 'Rajasthan' },
      contactEmail: 'hello@kesari.example',
      contactPhone: '+91 98290 00000',
      country: 'IN',
      taxId: '08ABCDE1234F1Z5',
      timeZone: 'Asia/Kolkata',
      unitSystem: 'metric',
      orderPrefix: 'KT-',
      nextOrderNumber: '2849',
    })
    expect(await db.sql`select kind, number from tax_registration where store_id = ${t.storeA1}`).toEqual([{ kind: 'gst', number: '08ABCDE1234F1Z5' }])
    expect((await save({ ...base, taxId: '' })).code).toBeUndefined()
    expect((await info())?.taxId).toBeNull()
    expect(await db.sql`select 1 from activity_log where action = 'store.info_saved' and store_id = ${t.storeA1}`).toHaveLength(2)
  })

  it('refuses what isn’t valid: a tax id not in the country’s format, a made-up time zone, a bad email or prefix', async () => {
    expect((await save({ ...base, taxId: 'NOT-A-GSTIN' })).code).toBe('INVALID_TAX_ID')
    expect((await save({ ...base, timeZone: 'Mars/Olympus' })).code).toBe('INVALID_TIME_ZONE')
    expect((await save({ ...base, contactEmail: 'nobody' })).code).toBe('INVALID_EMAIL')
    expect((await save({ ...base, orderPrefix: 'TOO-LONG' })).code).toBe('INVALID_INPUT')
    expect((await save({ ...base, name: ' ' })).code).toBe('INVALID_INPUT')
    expect((await save({ ...base, description: 'x'.repeat(121) })).code).toBe('INVALID_INPUT')
  })

  it('takes only the store’s own image as its logo', async () => {
    const [mine] = await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum) values (${t.storeA1}, ${`stores/${t.storeA1}/assets/00000000-0000-4000-8000-000000000001.png`}, 'image', 'image/png', 10, ${'a'.repeat(64)}) returning id`
    const [theirs] = await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum) values (${t.storeB1}, ${`stores/${t.storeB1}/assets/00000000-0000-4000-8000-000000000002.png`}, 'image', 'image/png', 10, ${'b'.repeat(64)}) returning id`
    expect((await save({ ...base, logoAssetId: theirs?.id })).code).toBe('INVALID_LOGO')
    expect((await save({ ...base, logoAssetId: mine?.id })).code).toBeUndefined()
    expect((await info())?.logoAssetId).toBe(mine?.id)
  })

  it('is the Owner’s to write, the merchant side’s to read, and no supplier’s or other store’s', async () => {
    expect((await info('manager'))?.name).toBe('Kesari Threads')
    expect((await save(base, 'manager')).code).toBe('FORBIDDEN')
    expect((await gql('{ storeInfo { name } }', 'supplier')).code).toBe('FORBIDDEN')
    expect((await info('bOwner'))?.name).not.toBe('Kesari Threads')
    const supplier: CallerContext = { caller: { kind: 'person', userId: people.supplier, sessionId: 's' }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'seller', sellerId: t.sellerA1First }, subscription: 'active' }
    await expect(withScope(db.sql, supplier, (tx) => tx`select save_store_info('{}'::jsonb)`)).rejects.toThrow(/merchant side of a store only|permission denied/)
    for (const table of ['invoice_settings', 'tax_registration']) {
      await expect(withScope(db.sql, supplier, (tx) => tx.unsafe(`select 1 from ${table}`))).rejects.toThrow(/permission denied/i)
    }
  })
})
