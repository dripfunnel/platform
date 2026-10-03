import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import { withScope } from '#db/scoped/index'
import type { PartnerRole } from '#auth/partnerPermissions'
import { activityLog } from '#saas/activity/index'
import { createPartnerDashboardService } from '#saas/partnerDashboard/index'
import { createPartnerStoresService } from '#saas/partnerStores/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #163: the partner Dashboard, seeded at the prototype's moment (designs/partner-data.js).

let db: TestDatabase
const now = new Date('2026-09-29T17:42:00Z')
const ids = { ns: '', bz: '' }
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }

const callerOf = (partnerId: string, role: PartnerRole, state: PartnerCaller['partner']['state'] = 'live'): PartnerCaller => ({
  user: { id: crypto.randomUUID(), name: 'Maya Chen', email: 'maya@northstar.example', role },
  partner: { id: partnerId, name: 'Northstar Commerce', product: 'Northstar Shops', host: null, state },
})

const run = async <T>(source: string, caller: PartnerCaller, variables: Record<string, unknown> = {}) => {
  const deps = { sql: db.sql, caller, facts, activity: activityLog, now: () => now }
  const contextValue = { caller, console: null, plans: null, branding: null, storeActions: null, stores: createPartnerStoresService(deps), dashboard: createPartnerDashboardService(deps) }
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const query = `query($range: String!) { dashboard(range: $range) {
  range asOf staleSince fresh
  stores { total byStatus { active trial pastdue suspended } newThisMonth }
  revenue { collected { amount currency } fee { amount currency } payout { amount currency } comparison nextPayoutAt }
  attention { storeId storeName kind detail tab action { allowed code } }
  signups { started completed conversion comparison }
  usage { nearCount stores { storeId storeName used limit limitKey percent } }
  top { storeId storeName plan sales { amount currency } } } }`

interface Dashboard {
  fresh: boolean
  staleSince: string | null
  stores: { total: number; byStatus: Record<string, number>; newThisMonth: number }
  revenue: { collected: { amount: number }; fee: { amount: number }; payout: { amount: number }; comparison: string; nextPayoutAt: string }
  attention: { storeId: string; storeName: string; kind: string; detail: string; tab: string; action: { allowed: boolean; code: string | null } }[]
  signups: { started: number; completed: number; conversion: string | null; comparison: string }
  usage: { nearCount: number; stores: { storeName: string; used: number; limit: number; limitKey: string; percent: number }[] }
  top: { storeName: string; plan: string | null; sales: { amount: number; currency: string } }[]
}
const dashboard = async (caller: PartnerCaller, range: string) => (await run<{ dashboard: Dashboard }>(query, caller, { range })).data?.dashboard

// How many stores the Stores list shows for a filter, paging through it as the screen would.
const listed = async (caller: PartnerCaller, filter: Record<string, string>) => {
  let count = 0
  let after: string | null = null
  for (;;) {
    type Page = { items: unknown[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
    const page: Page | undefined = (await run<{ stores: Page }>(
      `query($filter: StoreFilterInput, $after: String) { stores(filter: $filter, after: $after, first: 25) { items { id } pageInfo { hasNextPage endCursor } } }`,
      caller,
      { filter, after },
    )).data?.stores
    count += page?.items.length ?? 0
    if (!page?.pageInfo.hasNextPage) return count
    after = page.pageInfo.endCursor
  }
}

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  ids.ns = (await db.sql<{ id: string }[]>`select id from partner where name = 'Northstar Commerce'`)[0]?.id ?? ''
  ids.bz = (await db.sql<{ id: string }[]>`select id from partner where name = 'Bazaar Cloud'`)[0]?.id ?? ''
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('revenue', () => {
  it('reads the prototype’s figures for the three ranges, with the comparison worded by the API', async () => {
    const owner = callerOf(ids.ns, 'partner-owner')
    const expected = {
      month: [398840, 146600, 252240, '94% of August so far, with 2 days to go'],
      last: [426140, 154900, 271240, '+4% vs July'],
      q: [1226420, 446200, 780220, '+15% vs the 90 days before'],
    } as const
    for (const [range, [collected, fee, payout, comparison]] of Object.entries(expected)) {
      const d = await dashboard(owner, range)
      expect(d?.revenue, range).toEqual({
        collected: { amount: collected, currency: 'USD' },
        fee: { amount: fee, currency: 'USD' },
        payout: { amount: payout, currency: 'USD' },
        comparison,
        nextPayoutAt: '2026-10-01',
      })
    }
  })

  it('subtracts a refund', async () => {
    const owner = callerOf(ids.ns, 'partner-owner')
    const [store] = await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.ns} and status = 'active' limit 1`
    const [refund] = await db.sql<{ id: string }[]>`
      insert into merchant_charge (partner_id, store_id, kind, status, amount, currency, payout_currency, payout_gross, fee_amount, partner_amount, charged_at)
      values (${ids.ns}, ${store?.id ?? ''}, 'refund', 'refunded', 2900, 'USD', 'USD', 2900, 1000, 1900, ${new Date(now.getTime() - 60_000)}) returning id`
    expect((await dashboard(owner, 'month'))?.revenue).toMatchObject({ collected: { amount: 398840 - 2900 }, fee: { amount: 146600 - 1000 }, payout: { amount: 252240 - 1900 } })
    await db.sql`delete from merchant_charge where id = ${refund?.id ?? ''}`
  })

  it('refuses a range it does not know', async () => {
    expect((await run(query, callerOf(ids.ns, 'partner-owner'), { range: 'year' })).code).toBe('INVALID_INPUT')
  })
})

describe('the cards', () => {
  it('fixes every range’s numbers and words', async () => {
    const owner = callerOf(ids.ns, 'partner-owner')
    for (const range of ['month', 'last', 'q']) {
      const d = await dashboard(owner, range)
      expect({
        stores: d?.stores,
        attention: d?.attention.map((a) => [a.storeName, a.kind, a.detail, a.tab]),
        signups: d?.signups,
        usage: { nearCount: d?.usage.nearCount, stores: d?.usage.stores.map((s) => [s.storeName, s.used, s.limit, s.limitKey, s.percent]) },
        top: d?.top.map((t) => [t.storeName, t.plan, t.sales.amount, t.sales.currency]),
      }).toMatchSnapshot(range)
    }
  })

  it('counts each store figure as the Stores list filtered the way its link filters', async () => {
    const owner = callerOf(ids.ns, 'partner-owner')
    const d = await dashboard(owner, 'month')
    console.log(JSON.stringify(d, null, 1))
    expect(await listed(owner, {})).toBe(d?.stores.total)
    for (const status of ['active', 'trial', 'pastdue', 'suspended']) expect(await listed(owner, { status }), status).toBe(d?.stores.byStatus[status])
    expect(await listed(owner, { created: 'month' })).toBe(d?.stores.newThisMonth)
    expect(await listed(owner, { created: 'month' })).toBe(d?.signups.started)
    expect(await listed(owner, { near: 'yes' })).toBe(d?.usage.nearCount)
    expect((await dashboard(owner, 'q'))?.signups.started).toBe(await listed(owner, { created: '90d' }))
  })

  it('words the attention actions as store(id)’s block does, per role', async () => {
    await db.sql`
      update job set state = 'running', step = 'firstBuild', step_started_at = ${new Date(now.getTime() - 43 * 60_000)}
      where id = (select j.id from job j join store s on s.id = j.store_id where s.partner_id = ${ids.ns} and s.status = 'trial' and 'firstBuild' = any(j.steps) order by j.started_at desc limit 1)`
    const actions = async (role: PartnerRole) =>
      Object.fromEntries((await dashboard(callerOf(ids.ns, role), 'month'))?.attention.map((a) => [a.kind, a.action]) ?? [])
    const finance = await actions('partner-finance')
    expect(finance['setupStuck']).toEqual({ allowed: false, code: 'OWNERS_AND_ADMINS_ONLY' })
    expect(finance['trialEnding']).toEqual({ allowed: true, code: null })
    expect((await actions('partner-support'))['trialEnding']).toEqual({ allowed: false, code: 'FINANCE_TRIAL_ONLY' })
    expect((await actions('partner-owner'))['setupStuck']).toEqual({ allowed: true, code: null })
  })
})

describe('a new partner and isolation', () => {
  it('shows a brand-new Live partner zeros and nothing to attend to', async () => {
    const [fresh] = await db.sql<{ id: string }[]>`
      insert into partner (name, kind, region, country, state, product_name) values ('Fresh Partner', 'reseller', 'US', 'US', 'live', 'Fresh Shops') returning id`
    const d = await dashboard(callerOf(fresh?.id ?? '', 'partner-owner'), 'month')
    expect(d).toMatchObject({
      fresh: true,
      stores: { total: 0, byStatus: { active: 0, trial: 0, pastdue: 0, suspended: 0 }, newThisMonth: 0 },
      revenue: { collected: { amount: 0 }, comparison: '', nextPayoutAt: '2026-10-01' },
      attention: [],
      signups: { started: 0, completed: 0, conversion: null, comparison: '' },
      usage: { nearCount: 0, stores: [] },
      top: [],
    })
  })

  it('lets a partner read none of another partner’s money rows directly', async () => {
    const scope = { caller: { kind: 'partner-user' as const, partnerUserId: 'pu' }, partnerId: ids.bz }
    for (const table of ['merchant_charge', 'partner_payout', 'store_sales_month', 'partner_billing_feed']) {
      const [ns] = await db.sql<{ n: number }[]>`select count(*)::int as n from ${db.sql(table)} where partner_id = ${ids.ns}`
      expect(ns?.n, table).toBeGreaterThan(0)
      expect(await withScope(db.sql, scope, (tx) => tx`select partner_id from ${tx(table)} where partner_id = ${ids.ns}`), table).toEqual([])
    }
  })

  it('never counts another partner’s rows', async () => {
    const theirs = await dashboard(callerOf(ids.bz, 'partner-owner'), 'q')
    const nsStores = new Set((await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.ns}`).map((s) => s.id))
    expect(theirs?.revenue.collected.amount).toBe(0)
    expect(theirs?.top).toEqual([])
    expect([...(theirs?.attention ?? []), ...(theirs?.usage.stores ?? [])].some((a) => 'storeId' in a && nsStores.has(String(a.storeId)))).toBe(false)
    const [count] = await db.sql<{ n: number }[]>`select count(*)::int as n from store where partner_id = ${ids.bz}`
    expect(theirs?.stores.total).toBe(count?.n)
  })
})
