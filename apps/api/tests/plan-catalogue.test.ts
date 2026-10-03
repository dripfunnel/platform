import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CallerContext } from '#core/tenancy'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { insertPlanVersion, selectPlanVersion, type Entitlements } from '#db/scoped/plans'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #157: the versioned plan catalogue, DripFunnel's fee and ceilings, and who reads them.

let db: TestDatabase
const now = new Date('2026-10-03T09:00:00Z')
const ids = { ns: '', kl: '', growth: '', basis: '', store: '' }

const partner = (partnerId: string): CallerContext => ({ caller: { kind: 'partner-user', partnerUserId: 'pu' }, partnerId })
const staff: CallerContext = { caller: { kind: 'staff', staffId: 'st' } }
const merchant = (partnerId: string, storeId: string, sellerId?: string): CallerContext => ({
  caller: { kind: 'person', userId: 'u', sessionId: 's' },
  partnerId,
  storeId,
  sellerScope: sellerId ? { kind: 'seller', sellerId } : { kind: 'all' },
  subscription: 'active',
})
const as = <T>(context: CallerContext, work: (tx: ScopedSql) => Promise<T>) => withScope(db.sql, context, work)
const idOf = async (sql: string, name: string) => ((await db.sql.unsafe<{ id: string }[]>(sql, [name]))[0]?.id ?? '')

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  ids.ns = await idOf('select id from partner where name = $1', 'Northstar Commerce')
  ids.kl = await idOf('select id from partner where name = $1', 'Kaufladen Digital')
  ids.growth = (await db.sql<{ id: string }[]>`select id from plan where partner_id = ${ids.ns} and name = 'Growth'`)[0]?.id ?? ''
  ids.basis = (await db.sql<{ id: string }[]>`select id from plan where partner_id = ${ids.kl} and name = 'Basis'`)[0]?.id ?? ''
  ids.store = (await db.sql<{ id: string }[]>`select id from store where plan_id = ${ids.growth} limit 1`)[0]?.id ?? ''
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('the seeded catalogue', () => {
  it('holds the prototype’s Growth plan in minor units, its fee and the ceilings', async () => {
    const growth = await as(partner(ids.ns), (tx) => selectPlanVersion(tx, ids.growth, 1))
    expect(growth?.prices).toEqual([
      { currency: 'CAD', monthly: 6500, yearly: 65000 },
      { currency: 'USD', monthly: 4900, yearly: 49000 },
    ])
    expect(growth?.entitlements).toMatchObject({ custom_domain: true, products: 5000, publish_now: 60, ai_prompts: 200 })
    expect(await as(partner(ids.ns), (tx) => tx`select amount, currency from plan_fee where plan_id = ${ids.growth}`)).toEqual([{ amount: 1800, currency: 'USD' }])
    expect((await as(partner(ids.ns), (tx) => tx`select key from plan_ceiling`)).length).toBe(7)
    const enterprise = (await db.sql<{ id: string }[]>`select id from plan where partner_id = ${ids.kl} and name = 'Enterprise'`)[0]?.id ?? ''
    const unpriced = await as(partner(ids.kl), (tx) => selectPlanVersion(tx, enterprise, 1))
    expect(unpriced?.prices).toEqual([{ currency: 'EUR', monthly: null, yearly: null }])
  })

  it('keeps a fee in its contract’s currency: the contract cannot change it under the fees', async () => {
    await expect(as(staff, (tx) => tx`update partner_contract set fee_currency = 'EUR' where partner_id = ${ids.ns}`)).rejects.toThrow(/plan_fee_contract_currency_fkey/)
    await expect(db.sql`update plan_fee set currency = 'EUR' where plan_id = ${ids.growth}`).rejects.toThrow(/plan_fee_contract_currency_fkey/)
  })

  it('gives the house partner’s plans a 10-day trial, and refuses a trial past 90 days', async () => {
    const trials = await db.sql<{ trial_days: number }[]>`select distinct p.trial_days from plan p join partner pa on pa.id = p.partner_id where pa.is_house`
    expect(trials).toEqual([{ trial_days: 10 }])
    await expect(db.sql`update plan set trial_days = 91 where id = ${ids.growth}`).rejects.toThrow(/plan_trial_days_check/)
  })
})

describe('versions', () => {
  it('adds a version on an edit and leaves the bought one exactly as it was', async () => {
    const before = await as(partner(ids.ns), (tx) => selectPlanVersion(tx, ids.growth, 1))
    const entitlements = { ...(before?.entitlements as Entitlements), products: 6000 }
    const version = await as(partner(ids.ns), (tx) =>
      insertPlanVersion(tx, { planId: ids.growth, partnerId: ids.ns, trialDays: 7, prices: [{ currency: 'USD', monthly: 5900, yearly: 59000 }], entitlements, by: { kind: 'partner_user', label: 'Maya Chen' } }),
    )
    expect(version).toBe(2)
    expect(await as(partner(ids.ns), (tx) => selectPlanVersion(tx, ids.growth, 1))).toEqual(before)
    expect((await as(partner(ids.ns), (tx) => selectPlanVersion(tx, ids.growth, 2)))?.entitlements.products).toBe(6000)
    expect(await db.sql`select version, trial_days from plan where id = ${ids.growth}`).toEqual([{ version: 2, trial_days: 7 }])
  })

  it('makes two edits at once two versions, and never lets a written version change', async () => {
    const entitlements = (await as(partner(ids.ns), (tx) => selectPlanVersion(tx, ids.growth, 1)))?.entitlements as Entitlements
    const edit = () => as(partner(ids.ns), (tx) => insertPlanVersion(tx, { planId: ids.growth, partnerId: ids.ns, trialDays: 14, prices: [], entitlements, by: { kind: 'partner_user', label: 'x' } }))
    expect((await Promise.all([edit(), edit()])).sort()).toEqual([3, 4])
    await expect(as(partner(ids.ns), (tx) => tx`update plan_price set monthly_amount = 1 where plan_id = ${ids.growth} and version = 1`)).rejects.toThrow(/permission denied/i)
    await expect(as(staff, (tx) => tx`update plan_entitlement set amount = 1 where plan_id = ${ids.growth} and version = 1`)).rejects.toThrow(/permission denied/i)
  })

  it('refuses a value above DripFunnel’s ceiling, for the partner and for staff', async () => {
    const entitlements = (await as(partner(ids.ns), (tx) => selectPlanVersion(tx, ids.growth, 1)))?.entitlements as Entitlements
    for (const context of [partner(ids.ns), staff]) {
      await expect(
        as(context, (tx) => insertPlanVersion(tx, { planId: ids.growth, partnerId: ids.ns, trialDays: 14, prices: [], entitlements: { ...entitlements, products: 20001 }, by: { kind: 'staff', label: 'x' } })),
      ).rejects.toThrow(/products above the ceiling of 20000/)
    }
  })

  it('removes "Powered by" only where the contract allows it', async () => {
    const entitlements = (await as(partner(ids.kl), (tx) => selectPlanVersion(tx, ids.basis, 1)))?.entitlements as Entitlements
    await expect(
      as(partner(ids.kl), (tx) => insertPlanVersion(tx, { planId: ids.basis, partnerId: ids.kl, trialDays: 14, prices: [], entitlements: { ...entitlements, powered_by_removal: true }, by: { kind: 'partner_user', label: 'x' } })),
    ).rejects.toThrow(/contract keeps "Powered by" on/)
    const growth = (await as(partner(ids.ns), (tx) => selectPlanVersion(tx, ids.growth, 1)))?.entitlements as Entitlements
    await expect(
      as(partner(ids.ns), (tx) => insertPlanVersion(tx, { planId: ids.growth, partnerId: ids.ns, trialDays: 14, prices: [], entitlements: { ...growth, powered_by_removal: true }, by: { kind: 'partner_user', label: 'x' } })),
    ).resolves.toBeGreaterThan(1)
  })

  it('lets no request roll the current version back or change the trial without a version', async () => {
    await expect(as(partner(ids.ns), (tx) => tx`update plan set version = 1 where id = ${ids.growth}`)).rejects.toThrow(/change only by writing a new version/)
    await expect(as(partner(ids.ns), (tx) => tx`update plan set trial_days = 90 where id = ${ids.growth}`)).rejects.toThrow(/change only by writing a new version/)
    await expect(as(staff, (tx) => tx`update plan set version = version + 5 where id = ${ids.growth}`)).rejects.toThrow(/change only by writing a new version/)
  })

  it('holds each entitlement to its kind: a switch has only enabled, a limit only amount', async () => {
    const bad = async (key: string, enabled: boolean | null, amount: number | null) =>
      db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled, amount) values (${ids.growth}, ${ids.ns}, 1, ${key}, ${enabled}, ${amount})`
    await expect(bad('products', true, 5)).rejects.toThrow(/plan_entitlement_kind/)
    await expect(bad('products', null, null)).rejects.toThrow(/plan_entitlement_kind/)
    await expect(bad('offers', true, 5)).rejects.toThrow(/plan_entitlement_kind/)
  })

  it('gives any new plan a first version, however it is inserted', async () => {
    const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status, trial_days) values (${ids.ns}, 'Raw insert', 'draft', 7) returning id`
    expect(await db.sql`select version, trial_days from plan_version where plan_id = ${plan?.id ?? ''}`).toEqual([{ version: 1, trial_days: 7 }])
  })

  it('refuses a current version that does not exist, and a replacement plan of another partner', async () => {
    await expect(db.sql`update plan set version = 99 where id = ${ids.growth}`).rejects.toThrow(/plan_current_version_fkey/)
    await expect(db.sql`update plan set retire_move_to_plan_id = ${ids.basis} where id = ${ids.growth}`).rejects.toThrow(/plan_retire_move_to_fkey/)
  })

  it('will not version or price another partner’s plan', async () => {
    const entitlements = (await as(partner(ids.kl), (tx) => selectPlanVersion(tx, ids.basis, 1)))?.entitlements as Entitlements
    await expect(
      as(partner(ids.ns), (tx) => insertPlanVersion(tx, { planId: ids.basis, partnerId: ids.kl, trialDays: 14, prices: [], entitlements, by: { kind: 'partner_user', label: 'x' } })),
    ).rejects.toThrow(/no such plan in scope/)
    await expect(as(partner(ids.ns), (tx) => tx`insert into plan_price (plan_id, partner_id, version, currency, monthly_amount) values (${ids.basis}, ${ids.kl}, 1, 'USD', 1)`)).rejects.toThrow(
      /row-level security/i,
    )
  })
})

describe('who reads what', () => {
  it('shows a partner only its own plans, fees and contract', async () => {
    for (const table of ['plan_version', 'plan_price', 'plan_entitlement', 'plan_fee', 'partner_contract', 'partner_contract_rate']) {
      const rows = await as(partner(ids.kl), (tx) => tx.unsafe<{ partner_id: string }[]>(`select partner_id from ${table}`))
      expect(rows.every((r) => r.partner_id === ids.kl)).toBe(true)
    }
    expect(await as(partner(ids.kl), (tx) => tx`select plan_id from plan_fee where plan_id = ${ids.growth}`)).toEqual([])
  })

  it('never lets a partner set its fee, a ceiling or its contract', async () => {
    await expect(as(partner(ids.ns), (tx) => tx`update plan_fee set amount = 0 where plan_id = ${ids.growth}`)).rejects.toThrow(/permission denied/i)
    await expect(as(partner(ids.ns), (tx) => tx`update plan_ceiling set amount = 99999`)).rejects.toThrow(/permission denied/i)
    await expect(as(partner(ids.ns), (tx) => tx`update partner_contract set powered_by_removable = true`)).rejects.toThrow(/permission denied/i)
  })

  it('shows a supplier in the same store none of the plan', async () => {
    const [seller] = await db.sql<{ id: string }[]>`insert into seller (store_id, name, access_level, status) values (${ids.store}, 'Loom Supply', 'vendor-stock', 'active') returning id`
    const supplier = merchant(ids.ns, ids.store, seller?.id ?? '')
    for (const table of ['plan_version', 'plan_price', 'plan_entitlement']) {
      expect({ [table]: await as(supplier, (tx) => tx.unsafe(`select plan_id from ${table}`)) }).toEqual({ [table]: [] })
    }
  })

  it('shows a storefront none of the plan', async () => {
    const shopper: CallerContext = { caller: { kind: 'shopper', customerId: null }, partnerId: ids.ns, storeId: ids.store, sellerScope: { kind: 'all' }, subscription: 'active' }
    expect(await as(shopper, (tx) => tx`select plan_id from plan_version`)).toEqual([])
  })

  it('lets a merchant read its own plan’s versions, prices and values, and never the fee or another plan', async () => {
    for (const table of ['plan_version', 'plan_price', 'plan_entitlement']) {
      const plans = await as(merchant(ids.ns, ids.store), (tx) => tx.unsafe<{ plan_id: string }[]>(`select distinct plan_id from ${table}`))
      expect({ [table]: plans }).toEqual({ [table]: [{ plan_id: ids.growth }] })
    }
    await expect(as(merchant(ids.ns, ids.store), (tx) => tx`select amount from plan_fee`)).rejects.toThrow(/permission denied/i)
    await expect(as(merchant(ids.ns, ids.store), (tx) => tx`select created_by_label from plan_version`)).rejects.toThrow(/permission denied/i)
  })

  it('lets staff read every partner’s catalogue', async () => {
    const partners = await as(staff, (tx) => tx<{ n: string }[]>`select count(distinct partner_id)::text as n from plan_version`)
    expect(Number(partners[0]?.n)).toBeGreaterThan(2)
  })
})
