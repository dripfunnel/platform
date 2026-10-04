import { readFileSync } from 'node:fs'
import { graphql, isObjectType, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import { reportExportDeliverer } from '#jobs/queues/deliverers/reportExport'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createPartnerActivityService } from '#saas/partnerActivity/index'
import { createPartnerReportsService } from '#saas/partnerReports/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #200: Reports, seeded at the prototype's moment (designs/partner-data.js).

let db: TestDatabase
const now = new Date('2026-09-29T17:42:00Z')
const ids = { ns: '', bz: '', fresh: '' }
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }

const callerOf = (partnerId: string, role: PartnerRole = 'partner-read-only'): PartnerCaller => ({
  role,
  user: { id: crypto.randomUUID(), name: 'Maya Chen', email: 'maya@northstar.example' },
  staff: null,
  partner: { id: partnerId, name: 'Northstar Commerce', product: 'Northstar Shops', host: null, state: 'live' },
})

const run = async <T>(source: string, caller: PartnerCaller, variables: Record<string, unknown> = {}) => {
  const deps = { sql: db.sql, caller, facts, activity: activityLog, now: () => now }
  const contextValue = { caller, console: null, plans: null, branding: null, stores: null, storeActions: null, dashboard: null, domains: null, team: null, activity: createPartnerActivityService(deps), reports: createPartnerReportsService(deps) }
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const q = {
  growth: `query($f: ReportFilterInput) { reportGrowth(filter: $f) { fresh summary rows { month signups newStores trialToPaidBps churned netStores } bars { label count } } }`,
  revenue: `query($f: ReportFilterInput) { reportRevenue(filter: $f) { fresh summary currency currencyNote rows { month collected { amount currency } fee { amount } payout { amount } } bars { label amount { amount currency } } mrr { plan amount { amount currency } approximate } payments { failed recovered } } }`,
  plans: `query($f: ReportFilterInput) { reportPlans(filter: $f) { fresh summary rows { plan stores } changes { from to stores } } }`,
  performance: `query($f: ReportFilterInput) { reportStorePerformance(filter: $f) { fresh summary note rows { storeId store sales { amount currency } orders changeBps declining } declining { store storeId } decliningTruncated } }`,
  usage: `query($f: ReportFilterInput) { reportUsage(filter: $f) { fresh summary truncated rows { storeId percentBps } meters { aiPrompts publishNow } } }`,
  setup: `query($f: ReportFilterInput) { reportSetupHealth(filter: $f) { fresh summary medianSeconds failed domainsStuck rows { kind storeId store } } }`,
}

type Rev = { reportRevenue: { fresh: boolean; summary: string; currency: string; currencyNote: string | null; rows: { collected: { amount: number }; fee: { amount: number } }[]; bars: { amount: { amount: number; currency: string } }[]; mrr: { amount: { amount: number } }[] } }
type Growth = { reportGrowth: { fresh: boolean; summary: string; rows: { netStores: number; signups: number }[] } }

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  ids.ns = (await db.sql<{ id: string }[]>`select id from partner where name = 'Northstar Commerce'`)[0]?.id ?? ''
  ids.bz = (await db.sql<{ id: string }[]>`select id from partner where name = 'Bazaar Cloud'`)[0]?.id ?? ''
  ids.fresh = (await db.sql<{ id: string }[]>`insert into partner (name, state) values ('Fresh Partner', 'live') returning id`)[0]?.id ?? ''
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('the figures', () => {
  it('reads revenue per month in the payout currency, with the sentence written by the API', async () => {
    const r = (await run<Rev>(q.revenue, callerOf(ids.ns))).data?.reportRevenue
    expect(r?.currency).toBe('USD')
    expect(r?.rows).toHaveLength(6)
    expect(r?.rows.slice(-2).map((m) => m.collected.amount)).toEqual([426140, 398840])
    expect(r?.bars.at(-1)?.amount).toEqual({ amount: 398840, currency: 'USD' })
    expect(r?.rows.at(-1)?.fee.amount).toBe(146600)
    expect(r?.summary).toBe("You've collected $3,988.40 so far in September, behind August's $4,261.40.")
    expect(r?.currencyNote).toBe('All amounts in USD; CAD payments are converted at the payout rate.')
    expect(r?.mrr.length).toBeGreaterThan(0)
  })

  it('counts growth, plans, store performance, usage and setup health from the partner’s stores', async () => {
    const reader = callerOf(ids.ns)
    const growth = (await run<Growth>(q.growth, reader)).data?.reportGrowth
    const [live] = await db.sql<{ n: number }[]>`select count(*)::int as n from store where partner_id = ${ids.ns} and (cancelled_at is null or cancelled_at >= ${new Date('2026-10-01T00:00:00Z')})`
    expect(growth?.rows.at(-1)?.netStores).toBe(live?.n)
    expect(growth?.summary).toMatch(/You have \d+ stores?, \d+ (more|fewer) than in August\.$/)
    const plans = (await run<{ reportPlans: { summary: string; rows: { stores: number }[] } }>(q.plans, reader)).data?.reportPlans
    const [open] = await db.sql<{ n: number }[]>`select count(*)::int as n from store where partner_id = ${ids.ns} and status not in ('cancelled', 'closed')`
    expect(plans?.rows.reduce((a, r) => a + r.stores, 0)).toBe(open?.n)
    expect(plans?.summary).toMatch(/is your most popular plan, with \d+ of \d+ stores\./)
    const perf = (await run<{ reportStorePerformance: { summary: string; note: string; rows: { store: string; sales: { amount: number } }[] } }>(q.performance, reader)).data?.reportStorePerformance
    expect(perf?.rows[0]).toMatchObject({ store: 'Juniper & Co.', sales: { amount: 1842000 } })
    expect(perf?.summary).toMatch(/^Juniper & Co\. sold the most last month \(\$18,420\.00\)\./)
    expect(perf?.note).toContain('Totals only')
    const usage = (await run<{ reportUsage: { summary: string; rows: unknown[]; truncated: boolean; meters: { aiPrompts: number } } }>(q.usage, reader)).data?.reportUsage
    expect(usage?.summary).toMatch(/^\d+ stores? (is|are) at 80% or more of a limit\. AI prompts used this month: [\d,]+; 'Publish now' presses: [\d,]+\.$/)
    expect(usage?.truncated).toBe(Number(/^\d+/.exec(usage?.summary ?? '')?.[0]) > (usage?.rows.length ?? 0))
    const setup = (await run<{ reportSetupHealth: { summary: string; domainsStuck: number } }>(q.setup, reader)).data?.reportSetupHealth
    expect(setup?.summary).toMatch(/(A new store is ready in \d+ min \d+ s on average\.|No store finished setting up in the last 30 days\.) \d+ setups? (is|are) stuck and \d+ custom domains? (is|are) waiting for DNS\.$/)
    // The figure beside the sentence says the same count.
    expect(setup?.summary).toContain(`${setup?.domainsStuck ?? -1} custom domain`)
  })

  it('narrows by plan and country, and refuses a filter it cannot read', async () => {
    const reader = callerOf(ids.ns)
    const [growthPlan] = await db.sql<{ id: string }[]>`select id from plan where partner_id = ${ids.ns} and name = 'Growth'`
    const all = (await run<Growth>(q.growth, reader)).data?.reportGrowth.rows.at(-1)?.netStores ?? 0
    const onGrowth = (await run<Growth>(q.growth, reader, { f: { plan: growthPlan?.id } })).data?.reportGrowth.rows.at(-1)?.netStores ?? 0
    expect(onGrowth).toBeGreaterThan(0)
    expect(onGrowth).toBeLessThan(all)
    const ca = (await run<{ reportStorePerformance: { rows: { sales: { currency: string } }[] } }>(q.performance, reader, { f: { country: 'CA' } })).data?.reportStorePerformance.rows ?? []
    expect(ca.every((r) => r.sales.currency === 'CAD')).toBe(true)
    expect((await run(q.growth, reader, { f: { range: '12m' } })).code).toBe('INVALID_INPUT')
    expect((await run<Growth>(q.growth, reader, { f: { range: '3m' } })).data?.reportGrowth.rows).toHaveLength(3)
  })
})

describe('edges', () => {
  it('skips a first plan in the plan changes, counts a store whose sales fell to nothing, and carries a huge change', async () => {
    const reader = callerOf(ids.ns)
    const [store] = await db.sql<{ id: string; plan_id: string }[]>`select id, plan_id from store where partner_id = ${ids.ns} and plan_id is not null limit 1`
    await db.sql`insert into activity_log (category, action, result, actor_kind, actor_id, actor_label, partner_id, store_id, target_type, target_id, target_label, changes, api, visibility)
      values ('write', 'store.plan_changed', 'success', 'partner_user', 'x', 'Maya', ${ids.ns}, ${store?.id ?? ''}, 'store', ${store?.id ?? ''}, 'x',
        ${JSON.stringify([{ field: 'plan', before: null, after: store?.plan_id }])}::text::jsonb, 'platform', 'partner')`
    expect((await run<{ reportPlans: { summary: string } }>(q.plans, reader)).data?.reportPlans.summary).toMatch(/most popular plan/)
    // A change away from a plan nobody is on any more is still named, never shown as an id.
    const [gone] = await db.sql<{ id: string; name: string }[]>`insert into plan (partner_id, name, status) values (${ids.ns}, 'Legacy', 'retired') returning id, name`
    if (!gone) throw new Error('plan not inserted')
    await db.sql`insert into activity_log (category, action, result, actor_kind, actor_id, actor_label, partner_id, store_id, target_type, target_id, target_label, changes, api, visibility, occurred_at)
      values ('write', 'store.plan_changed', 'success', 'partner_user', 'x', 'Maya', ${ids.ns}, ${store?.id ?? ''}, 'store', ${store?.id ?? ''}, 'x',
        ${JSON.stringify([{ field: 'plan', before: gone.id, after: store?.plan_id }])}::text::jsonb, 'platform', 'partner', '2026-09-15T00:00:00Z')`
    const changes = (await run<{ reportPlans: { changes: { from: string }[] } }>(q.plans, reader)).data?.reportPlans.changes ?? []
    expect(changes.map((c) => c.from)).toContain(gone.name)
    expect(changes.map((c) => c.from)).not.toContain(gone.id)
    const before = (await run<{ reportStorePerformance: { summary: string } }>(q.performance, reader)).data?.reportStorePerformance.summary ?? ''
    const count = (text: string) => Number(/(\d+) stores? sold less/.exec(text)?.[1] ?? '0')
    // A store that sold in August and nothing in September now counts as declining.
    const [quiet] = await db.sql<{ store_id: string }[]>`
      delete from store_sales_month where month = '2026-08-01' and store_id in (
        select j.store_id from store_sales_month j join store_sales_month a on a.store_id = j.store_id and a.month = '2026-08-01' join store s on s.id = j.store_id
        where s.partner_id = ${ids.ns} and j.month = '2026-07-01' and j.amount > 0 and a.amount >= j.amount * 0.97 limit 1) returning store_id`
    expect(quiet).toBeDefined()
    type Falling = { reportStorePerformance: { summary: string; rows: { storeId: string }[]; declining: { storeId: string }[]; decliningTruncated: boolean } }
    const after = (await run<Falling>(q.performance, reader)).data?.reportStorePerformance
    expect(count(after?.summary ?? '')).toBe(count(before) + 1)
    // The Declining list is its own query: it names the store with no sales row, which the top-sellers list can't.
    expect(after?.rows.map((r) => r.storeId)).not.toContain(quiet?.store_id)
    expect(after?.declining.map((r) => r.storeId)).toContain(quiet?.store_id)
    expect(after?.declining).toHaveLength(count(after?.summary ?? ''))
    expect(after?.decliningTruncated).toBe(false)
    const [pair] = await db.sql<{ store_id: string }[]>`
      select j.store_id from store_sales_month j join store_sales_month a on a.store_id = j.store_id and a.month = '2026-08-01' join store s on s.id = j.store_id
      where s.partner_id = ${ids.ns} and j.month = '2026-07-01' limit 1`
    await db.sql`update store_sales_month set amount = 100 where month = '2026-07-01' and store_id = ${pair?.store_id ?? ''}`
    await db.sql`update store_sales_month set amount = 50000000, payout_amount = 50000000 where month = '2026-08-01' and store_id = ${pair?.store_id ?? ''}`
    const big = (await run<{ reportStorePerformance: { rows: { changeBps: number | null }[] } }>(q.performance, reader)).data?.reportStorePerformance.rows ?? []
    expect(Math.max(...big.map((r) => r.changeBps ?? 0))).toBeGreaterThan(2_147_483_647)
  })
})

describe('scope', () => {
  it('gives a new partner the empty answer', async () => {
    const fresh = callerOf(ids.fresh)
    for (const [query, key] of [[q.growth, 'reportGrowth'], [q.revenue, 'reportRevenue'], [q.plans, 'reportPlans'], [q.performance, 'reportStorePerformance']] as const) {
      const r = (await run<Record<string, { fresh: boolean; summary: string }>>(query, fresh)).data?.[key]
      expect(r, key).toMatchObject({ fresh: true, summary: 'Reports fill in as your first merchants sign up.' })
    }
    // Usage and Setup health keep their own sentence, and say they have nothing to fill in yet.
    for (const [query, key] of [[q.usage, 'reportUsage'], [q.setup, 'reportSetupHealth']] as const) {
      expect((await run<Record<string, { fresh: boolean }>>(query, fresh)).data?.[key]?.fresh, key).toBe(true)
      expect((await run<Record<string, { fresh: boolean }>>(query, callerOf(ids.ns))).data?.[key]?.fresh, key).toBe(false)
    }
  })

  it('offers as filters only the plans and countries the partner’s own stores have', async () => {
    const options = (await run<{ reportFilters: { plans: { id: string; name: string }[]; countries: string[] } }>(`{ reportFilters { plans { id name } countries } }`, callerOf(ids.ns))).data?.reportFilters
    const plans = await db.sql<{ id: string }[]>`select distinct plan_id as id from store where partner_id = ${ids.ns} and plan_id is not null`
    const countries = await db.sql<{ country: string }[]>`select distinct country from store where partner_id = ${ids.ns} and country is not null order by country`
    expect(options?.plans.map((p) => p.id).sort()).toEqual(plans.map((p) => p.id).sort())
    expect(options?.countries).toEqual(countries.map((c) => c.country))
    const theirs = await db.sql<{ id: string }[]>`select id from plan where partner_id = ${ids.bz}`
    expect(options?.plans.some((p) => theirs.some((t) => t.id === p.id))).toBe(false)
    expect((await run<{ reportFilters: { plans: unknown[]; countries: unknown[] } }>(`{ reportFilters { plans { id } countries } }`, callerOf(ids.fresh))).data?.reportFilters).toEqual({ plans: [], countries: [] })
  })

  it('never counts another partner’s stores', async () => {
    const theirs = (await run<{ reportStorePerformance: { rows: { storeId: string }[] } }>(q.performance, callerOf(ids.bz))).data?.reportStorePerformance.rows ?? []
    const ns = new Set((await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.ns}`).map((s) => s.id))
    expect(theirs.some((r) => ns.has(r.storeId))).toBe(false)
    expect((await run<Rev>(q.revenue, callerOf(ids.bz))).data?.reportRevenue.rows.every((m) => m.collected.amount === 0)).toBe(true)
  })

  it('holds every tab to the caller’s partner, a plan filter naming another partner’s plan included', async () => {
    const bz = callerOf(ids.bz)
    const ns = new Set((await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.ns}`).map((s) => s.id))
    const [own] = await db.sql<{ n: number }[]>`select count(*)::int as n from store where partner_id = ${ids.bz} and status not in ('cancelled', 'closed')`
    type Ids = { rows: { storeId: string }[] }
    for (const [query, key] of [[q.performance, 'reportStorePerformance'], [q.usage, 'reportUsage'], [q.setup, 'reportSetupHealth']] as const) {
      const rows = (await run<Record<string, Ids>>(query, bz)).data?.[key]?.rows ?? []
      expect(rows.some((r) => ns.has(r.storeId)), key).toBe(false)
    }
    const plans = (await run<{ reportPlans: { rows: { stores: number }[] } }>(q.plans, bz)).data?.reportPlans.rows ?? []
    expect(plans.reduce((a, r) => a + r.stores, 0)).toBe(own?.n)
    const [theirPlan] = await db.sql<{ id: string }[]>`select plan_id as id from store where partner_id = ${ids.ns} and plan_id is not null limit 1`
    const narrowed = { f: { plan: theirPlan?.id } }
    expect((await run<Growth>(q.growth, bz, narrowed)).data?.reportGrowth.rows.every((r) => r.netStores === 0 && r.signups === 0)).toBe(true)
    expect((await run<{ reportPlans: { rows: unknown[] } }>(q.plans, bz, narrowed)).data?.reportPlans.rows).toEqual([])
    expect((await run<{ reportStorePerformance: Ids }>(q.performance, bz, narrowed)).data?.reportStorePerformance.rows).toEqual([])
    expect((await run<{ reportUsage: Ids }>(q.usage, bz, narrowed)).data?.reportUsage.rows).toEqual([])
    expect((await run<Rev>(q.revenue, bz, narrowed)).data?.reportRevenue.rows.every((m) => m.collected.amount === 0)).toBe(true)
  })

  it('answers no session with UNAUTHENTICATED on every report field', async () => {
    const fields = Object.keys((platformSchema as GraphQLSchema).getQueryType()?.getFields() ?? {}).filter((f) => f.startsWith('report'))
    // The six reports, their export's read-back, and the filters' options.
    expect(fields).toHaveLength(8)
    for (const source of [...Object.values(q), `query { reportExport(id: "${crypto.randomUUID()}") { id } }`, '{ reportFilters { countries } }']) {
      const contextValue = { caller: null, console: null, plans: null, branding: null, stores: null, storeActions: null, dashboard: null, domains: null, team: null, activity: null, reports: null }
      const result = await graphql({ schema: platformSchema as GraphQLSchema, source, contextValue })
      expect(result.errors?.[0]?.extensions['code'], source).toBe('UNAUTHENTICATED')
    }
  })

  it('declares only the partner scope on every report field, and reads no table inside a store', () => {
    const query = (platformSchema as GraphQLSchema).getQueryType()?.getFields() ?? {}
    const reportFields = Object.entries(query).filter(([name]) => name.startsWith('report'))
    expect(reportFields.length).toBe(8)
    for (const [name, field] of reportFields) expect((field.extensions as { access?: { scope?: string } }).access?.scope, name).toBe('partner')
    // The code only: comments say "from" and "join" in prose.
    const sqlText = readFileSync(new URL('../src/db/scoped/reports.ts', import.meta.url), 'utf8')
      .replaceAll(/\/\*[\s\S]*?\*\//g, '')
      .replaceAll(/\/\/.*$/gm, '')
    const tables = [...sqlText.matchAll(/\b(?:from|join)\s+([a-z_"]+)/gi)].map((m) => m[1]?.replaceAll('"', '') ?? '')
    const allowed = ['store', 'job', 'store_usage', 'store_sales_month', 'merchant_charge', 'store_subscription', 'custom_domain', 'plan', 'activity_log', 'generate_series', 'lateral', 'jsonb_array_elements', 'unnest']
    expect(tables.filter((t) => !allowed.includes(t))).toEqual([])
    const types = Object.values((platformSchema as GraphQLSchema).getTypeMap()).filter((t) => isObjectType(t) && !t.name.startsWith('__')).map((t) => t.name)
    expect(types.filter((n) => /order|customer|product|catalog/i.test(n))).toEqual([])
  })
})

describe('export', () => {
  it('builds a tab’s CSV as a job any role may ask for, logged once, readable by any user of the partner and only as a report export', async () => {
    const start = `mutation($tab: String!) { exportReport(tab: $tab) { ok jobId reason } }`
    expect((await run<{ exportReport: { reason: string } }>(start, callerOf(ids.ns), { tab: 'orders' })).data?.exportReport).toMatchObject({ ok: false, reason: 'INVALID_INPUT' })
    const asked = (await run<{ exportReport: { ok: boolean; jobId: string } }>(start, callerOf(ids.ns, 'partner-support'), { tab: 'revenue' })).data?.exportReport
    expect(asked?.ok).toBe(true)
    await relayDue(db.sql, { 'export.report': reportExportDeliverer(db.sql, () => now) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
    const job = (await run<{ reportExport: { state: string; rows: number; csv: string } }>(`query($id: ID!) { reportExport(id: $id) { state rows csv } }`, callerOf(ids.ns), { id: asked?.jobId })).data?.reportExport
    expect(job?.state).toBe('done')
    const lines = job?.csv.split('\n') ?? []
    expect(lines[0]).toBe('month,collected (minor units),collected currency,fee (minor units),fee currency,payout (minor units),payout currency')
    expect(lines).toHaveLength(7)
    expect(lines.at(-1)).toContain('398840,USD')
    expect((await db.sql`select 1 from activity_log where action = 'report.exported' and partner_id = ${ids.ns}`).length).toBe(1)
    const asActivity = (await run<{ activityExport: unknown }>(`query($id: ID!) { activityExport(id: $id) { id } }`, callerOf(ids.ns, 'partner-owner'), { id: asked?.jobId })).data?.activityExport
    expect(asActivity).toBeNull()
    expect((await run<{ reportExport: unknown }>(`query($id: ID!) { reportExport(id: $id) { id } }`, callerOf(ids.bz), { id: asked?.jobId })).data?.reportExport).toBeNull()
    // A declining store's negative change stays a number a spreadsheet can sum.
    const perf = (await run<{ exportReport: { jobId: string } }>(start, callerOf(ids.ns), { tab: 'storePerformance' })).data?.exportReport
    await relayDue(db.sql, { 'export.report': reportExportDeliverer(db.sql, () => now) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
    const csv = (await run<{ reportExport: { csv: string } }>(`query($id: ID!) { reportExport(id: $id) { csv } }`, callerOf(ids.ns), { id: perf?.jobId })).data?.reportExport.csv ?? ''
    expect(csv.split('\n')[0]).toBe('storeId,store,plan,sales (minor units),sales currency,orders,changeBps,declining')
    expect(csv).toMatch(/,-\d+,/)
    expect(csv).not.toContain(",'-")
  })
})
