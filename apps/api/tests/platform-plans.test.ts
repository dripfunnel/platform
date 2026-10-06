import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import { scheduleSubscriptionMoves } from '#db/scoped/partnerPlans'
import { selectSetupItemsFor } from '#db/scoped/partners'
import type { PartnerRole } from '#auth/partnerPermissions'
import { activityLog } from '#saas/activity/index'
import { createPartnerConsoleService } from '#saas/partnerConsole/index'
import { createPartnerPlansService } from '#saas/partnerPlans/index'
import { withScope } from '#db/scoped/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #161: Plans on the Platform API, over the seeded Northstar and Kaufladen catalogues.

let db: TestDatabase
const now = new Date('2026-10-03T09:00:00Z')
const ids = { ns: '', kl: '', growth: '', starter: '' }
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }

const callerOf = (partnerId: string, role: PartnerRole, name = 'Maya Chen'): PartnerCaller => ({
  role,
  user: { id: crypto.randomUUID(), name, email: 'maya@northstar.example' },
  staff: null,
  partner: { id: partnerId, name: 'Northstar Commerce', product: 'Northstar Shops', host: null, state: 'live' },
})

const run = async <T>(source: string, caller: PartnerCaller, variables: Record<string, unknown> = {}) => {
  const deps = { sql: db.sql, caller, facts, activity: activityLog, now: () => now }
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue: { caller, console: createPartnerConsoleService(deps), plans: createPartnerPlansService(deps), branding: null } })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const priceFields = 'currency monthly { amount currency } yearly { amount } fee { amount currency } converted margin { kind amount { amount currency } of { amount } }'
const entitlementFields = 'domain offers suppliersOn powered aplus size products staff suppliers languages currencies publish ai'
const editorQuery = `query($id: ID) { planEditor(id: $id) { plan { row { id name description trialDays status stores prices { ${priceFields} } } entitlements { ${entitlementFields} } }
  ceilings { products publish } powered { allowed note } currencies trials edit { allowed reason } price { allowed reason } retireTargets { id name } retireDates } }`
const update = `mutation($id: ID!, $input: PlanInput!, $applyTo: String) { updatePlan(id: $id, input: $input, applyTo: $applyTo) { ok id reason row currency } }`
const create = `mutation($input: PlanInput!) { createPlan(input: $input) { ok id reason row currency } }`

interface Editor {
  plan: { row: { id: string; name: string; description: string; trialDays: number; prices: { currency: string; monthly: { amount: number } | null; yearly: { amount: number } | null }[] }; entitlements: Record<string, boolean | number> } | null
}
type Outcome = Record<string, { ok: boolean; id: string | null; reason: string | null; row: string | null; currency: string | null }>

const inputFrom = async (planId: string, caller: PartnerCaller) => {
  const plan = (await run<{ planEditor: Editor }>(editorQuery, caller, { id: planId })).data?.planEditor.plan
  if (!plan) throw new Error('no plan')
  return {
    name: plan.row.name,
    description: plan.row.description,
    trialDays: plan.row.trialDays,
    prices: plan.row.prices.map((p) => ({ currency: p.currency, monthly: p.monthly ? { amount: p.monthly.amount, currency: p.currency } : null, yearly: p.yearly ? { amount: p.yearly.amount, currency: p.currency } : null })),
    entitlements: plan.entitlements,
  }
}

const entriesFor = async (planId: string) => (await db.sql<{ action: string }[]>`select action from activity_log where target_type = 'plan' and target_id = ${planId}`).map((r) => r.action)

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  ids.ns = (await db.sql<{ id: string }[]>`select id from partner where name = 'Northstar Commerce'`)[0]?.id ?? ''
  ids.kl = (await db.sql<{ id: string }[]>`select id from partner where name = 'Kaufladen Digital'`)[0]?.id ?? ''
  ids.growth = (await db.sql<{ id: string }[]>`select id from plan where partner_id = ${ids.ns} and name = 'Growth'`)[0]?.id ?? ''
  ids.starter = (await db.sql<{ id: string }[]>`select id from plan where partner_id = ${ids.ns} and name = 'Starter'`)[0]?.id ?? ''
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('the catalogue and the editor', () => {
  it('gives Growth its fee and margin as Money, the CAD fee converted at the contract rate', async () => {
    const { data } = await run<{ plans: { items: { id: string; prices: unknown[]; stores: number }[]; create: { allowed: boolean } } }>(`{ plans { items { id stores prices { ${priceFields} } } create { allowed } } }`, callerOf(ids.ns, 'partner-owner'))
    const growth = data?.plans.items.find((p) => p.id === ids.growth)
    expect(growth?.prices).toEqual([
      { currency: 'CAD', monthly: { amount: 6500, currency: 'CAD' }, yearly: { amount: 65000 }, fee: { amount: 2432, currency: 'CAD' }, converted: true, margin: { kind: 'keep', amount: { amount: 4068, currency: 'CAD' }, of: { amount: 6500 } } },
      { currency: 'USD', monthly: { amount: 4900, currency: 'USD' }, yearly: { amount: 49000 }, fee: { amount: 1800, currency: 'USD' }, converted: false, margin: { kind: 'keep', amount: { amount: 3100, currency: 'USD' }, of: { amount: 4900 } } },
    ])
    expect(growth?.stores).toBeGreaterThan(0)
    expect(data?.plans.create.allowed).toBe(true)
  })

  it('quotes a price below the fee as a loss, computed by the API', async () => {
    const { data } = await run<{ quotePlanPrices: unknown[] }>(`query($id: ID, $prices: [PlanPriceInput!]!) { quotePlanPrices(id: $id, prices: $prices) { ${priceFields} } }`, callerOf(ids.ns, 'partner-finance'), {
      id: ids.growth,
      prices: [{ currency: 'USD', monthly: { amount: 1500, currency: 'USD' } }],
    })
    expect(data?.quotePlanPrices).toEqual([{ currency: 'USD', monthly: { amount: 1500, currency: 'USD' }, yearly: null, fee: { amount: 1800, currency: 'USD' }, converted: false, margin: { kind: 'loss', amount: { amount: 300, currency: 'USD' }, of: null } }])
  })

  it('quotes a partner with no fee yet as noFee, never as a whole-price margin', async () => {
    const [bz] = await db.sql<{ id: string }[]>`select id from partner where name = 'Bazaar Cloud'`
    expect((await db.sql`select 1 from plan_fee where partner_id = ${bz?.id ?? ''}`).length).toBe(0)
    const { data } = await run<{ quotePlanPrices: unknown[] }>(`query($prices: [PlanPriceInput!]!) { quotePlanPrices(prices: $prices) { ${priceFields} } }`, callerOf(bz?.id ?? '', 'partner-owner'), {
      prices: [{ currency: 'INR', monthly: { amount: 99900, currency: 'INR' } }],
    })
    expect(data?.quotePlanPrices).toEqual([{ currency: 'INR', monthly: { amount: 99900, currency: 'INR' }, yearly: null, fee: null, converted: false, margin: { kind: 'noFee', amount: null, of: null } }])
  })

  it('opens the editor with the ceilings, the contract’s rule, the currencies and who may do what', async () => {
    const { data } = await run<{ planEditor: { ceilings: { products: number }; powered: { allowed: boolean }; currencies: string[]; trials: number[]; edit: { allowed: boolean; reason: string | null }; price: { allowed: boolean }; retireTargets: { id: string }[]; retireDates: string[] } }>(editorQuery, callerOf(ids.ns, 'partner-finance'), { id: ids.growth })
    expect(data?.planEditor).toMatchObject({ ceilings: { products: 20000 }, powered: { allowed: true }, trials: [0, 7, 14, 30], edit: { allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' }, price: { allowed: true } })
    expect(data?.planEditor.currencies.sort()).toEqual(['CAD', 'USD'])
    expect(data?.planEditor.retireTargets.map((r) => r.id)).not.toContain(ids.growth)
    expect(data?.planEditor.retireDates).toEqual(['2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'])
  })

  it('pages the catalogue by cursor, every plan reachable', async () => {
    const page = async (after: string | null) =>
      (await run<{ plans: { items: { id: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }>(
        'query($after: String) { plans(after: $after, first: 3) { items { id } pageInfo { hasNextPage endCursor } } }',
        callerOf(ids.ns, 'partner-read-only'),
        { after },
      )).data?.plans
    const first = await page(null)
    expect(first?.items).toHaveLength(3)
    expect(first?.pageInfo.hasNextPage).toBe(true)
    const second = await page(first?.pageInfo.endCursor ?? null)
    const all = (await db.sql<{ id: string }[]>`select id from plan where partner_id = ${ids.ns} order by date_trunc('milliseconds', created_at), id`).map((r) => r.id)
    expect([...(first?.items ?? []), ...(second?.items ?? [])].map((p) => p.id)).toEqual(all.slice(0, (first?.items.length ?? 0) + (second?.items.length ?? 0)))
    const corrupt = await run('query { plans(after: "not-a-cursor") { items { id } } }', callerOf(ids.ns, 'partner-read-only'))
    expect(corrupt.code).toBe('INVALID_INPUT')
  })

  it('refuses input it cannot read with a code, never an internal error', async () => {
    const input = await inputFrom(ids.starter, callerOf(ids.ns, 'partner-owner'))
    expect((await run<Outcome>(update, callerOf(ids.ns, 'partner-owner'), { id: ids.starter, input: { ...input, name: 'x'.repeat(61) }, applyTo: 'new' })).data?.updatePlan).toMatchObject({ ok: false, reason: 'INVALID_INPUT' })
    expect((await run<Outcome>(create, callerOf(ids.ns, 'partner-owner'), { input: { ...input, prices: [{ currency: 'usd', monthly: null, yearly: null }] } })).data?.createPlan).toMatchObject({ ok: false, reason: 'INVALID_INPUT' })
    const twice = [{ currency: 'USD', monthly: null, yearly: null }, { currency: 'USD', monthly: null, yearly: null }]
    expect((await run<Outcome>(create, callerOf(ids.ns, 'partner-owner'), { input: { ...input, prices: twice } })).data?.createPlan).toMatchObject({ ok: false, reason: 'INVALID_INPUT' })
    // GraphQL's Int stops a value past 32 bits at the boundary; the service refuses one too.
    const service = createPartnerPlansService({ sql: db.sql, caller: callerOf(ids.ns, 'partner-owner'), facts, activity: activityLog, now: () => now })
    const huge = { ...input, prices: [{ currency: 'USD', monthly: { amount: 2_147_483_648, currency: 'USD' }, yearly: null }] }
    expect(await service.updatePlan(ids.starter, huge, 'new')).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    expect(await service.updatePlan(ids.starter, { ...input, entitlements: { ...input.entitlements, languages: 2_147_483_648 } }, 'new')).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    const retired = await run<Record<string, { reason: string }>>(`mutation($id: ID!, $input: RetirePlanInput!) { retirePlan(id: $id, input: $input) { ok reason } }`, callerOf(ids.ns, 'partner-owner'), {
      id: ids.starter,
      input: { keep: false, moveTo: ids.growth, on: 'next month' },
    })
    expect(retired.data?.['retirePlan']).toMatchObject({ ok: false, reason: 'INVALID_INPUT' })
  })

  it('caps a page at 50 whatever is asked', async () => {
    const [p] = await db.sql<{ id: string }[]>`insert into partner (name) values ('Many Plans') returning id`
    await db.sql`insert into plan (partner_id, name, status) select ${p?.id ?? ''}, 'Plan ' || n, 'draft' from generate_series(1, 55) n`
    const { data } = await run<{ plans: { items: unknown[]; pageInfo: { hasNextPage: boolean } } }>('{ plans(first: 1000) { items { id } pageInfo { hasNextPage } } }', callerOf(p?.id ?? '', 'partner-read-only'))
    expect(data?.plans.items).toHaveLength(50)
    expect(data?.plans.pageInfo.hasNextPage).toBe(true)
  })

  it('refuses a quote a save would refuse', async () => {
    const quote = (prices: unknown[]) => run(`query($p: [PlanPriceInput!]!) { quotePlanPrices(prices: $p) { currency } }`, callerOf(ids.ns, 'partner-owner'), { p: prices })
    expect((await quote([{ currency: 'usd' }])).code).toBe('INVALID_INPUT')
    expect((await quote(Array.from({ length: 11 }, (_, i) => ({ currency: `A${String.fromCharCode(65 + i)}A` })))).code).toBe('INVALID_INPUT')
  })

  it('shows another partner nothing of this catalogue', async () => {
    expect((await run<{ planEditor: unknown }>(editorQuery, callerOf(ids.kl, 'partner-owner'), { id: ids.growth })).data?.planEditor).toBeNull()
    const { data } = await run<{ plans: { items: { id: string }[] } }>('{ plans { items { id } } }', callerOf(ids.kl, 'partner-owner'))
    expect(data?.plans.items.map((p) => p.id)).not.toContain(ids.growth)
    const input = await inputFrom(ids.growth, callerOf(ids.ns, 'partner-owner'))
    expect((await run<Outcome>(update, callerOf(ids.kl, 'partner-owner'), { id: ids.growth, input, applyTo: 'new' })).data?.updatePlan).toMatchObject({ ok: false, reason: 'NOT_FOUND' })
    const kl = callerOf(ids.kl, 'partner-owner')
    expect((await run<Record<string, unknown>>(`mutation($id: ID!) { makePlanLive(id: $id) { ok reason } }`, kl, { id: ids.growth })).data?.['makePlanLive']).toMatchObject({ ok: false, reason: 'NOT_FOUND' })
    expect((await run<Record<string, unknown>>(`mutation($id: ID!, $input: RetirePlanInput!) { retirePlan(id: $id, input: $input) { ok reason } }`, kl, { id: ids.growth, input: { keep: true } })).data?.['retirePlan']).toMatchObject({ ok: false, reason: 'NOT_FOUND' })
    // A quote for another partner's plan id never shows that plan's fee.
    const quoted = await run<{ quotePlanPrices: { fee: { amount: number } | null }[] }>(`query($id: ID, $p: [PlanPriceInput!]!) { quotePlanPrices(id: $id, prices: $p) { fee { amount } } }`, kl, { id: ids.growth, p: [{ currency: 'EUR', monthly: { amount: 100, currency: 'EUR' } }] })
    expect(quoted.data?.quotePlanPrices[0]?.fee?.amount).not.toBe(1800)
  })

  it('lets a partner write only the schedule of its own stores’ subscriptions', async () => {
    const [own] = await db.sql<{ store_id: string }[]>`select store_id from store_subscription where partner_id = ${ids.ns} limit 1`
    const [theirs] = await db.sql<{ store_id: string }[]>`select store_id from store_subscription where partner_id <> ${ids.ns} limit 1`
    const asPartner = (partnerId: string, query: string) =>
      withScope(db.sql, { caller: { kind: 'partner-user', partnerUserId: 'pu' }, partnerId }, (tx) => tx.unsafe(query))
    await expect(asPartner(ids.ns, `update store_subscription set amount = 0 where store_id = '${own?.store_id ?? ''}'`)).rejects.toThrow(/permission denied/i)
    await expect(asPartner(ids.ns, `update store_subscription set status = 'active' where store_id = '${own?.store_id ?? ''}'`)).rejects.toThrow(/permission denied/i)
    expect(await asPartner(ids.ns, `update store_subscription set change_at = now() where store_id = '${theirs?.store_id ?? ''}' returning store_id`)).toEqual([])
    // A retirement cannot move its stores onto another partner's Live plan.
    const [klPlus] = await db.sql<{ id: string }[]>`select id from plan where partner_id = ${ids.kl} and name = 'Plus'`
    const moved = await run<Record<string, unknown>>(`mutation($id: ID!, $input: RetirePlanInput!) { retirePlan(id: $id, input: $input) { ok reason } }`, callerOf(ids.ns, 'partner-owner'), {
      id: ids.starter,
      input: { keep: false, moveTo: klPlus?.id ?? '', on: '2026-11-01T00:00:00.000Z' },
    })
    expect(moved.data?.['retirePlan']).toMatchObject({ ok: false, reason: 'INVALID_TARGET' })
  })
})

describe('saving', () => {
  it('refuses a value above a ceiling by row, for a limit, an allowance and the contract’s switch, and clamps nothing', async () => {
    const input = await inputFrom(ids.growth, callerOf(ids.ns, 'partner-owner'))
    for (const [row, value] of [['products', 20001], ['publish', 301]] as const) {
      const out = await run<Outcome>(update, callerOf(ids.ns, 'partner-owner'), { id: ids.growth, input: { ...input, entitlements: { ...input.entitlements, [row]: value } }, applyTo: 'new' })
      expect(out.data?.updatePlan).toMatchObject({ ok: false, reason: 'ABOVE_CEILING', row })
    }
    const kl = callerOf(ids.kl, 'partner-owner')
    const draft = { name: 'Mehr', description: '', trialDays: 14, prices: [{ currency: 'EUR', monthly: null, yearly: null }], entitlements: { ...input.entitlements, products: 10, powered: true } }
    expect((await run<Outcome>(create, kl, { input: draft })).data?.createPlan).toMatchObject({ ok: false, reason: 'ABOVE_CEILING', row: 'powered' })
    expect(await db.sql`select version from plan where id = ${ids.growth}`).toEqual([{ version: 1 }])
  })

  it('refuses an amount in another currency than its row, and a currency the contract states no fee in', async () => {
    const input = await inputFrom(ids.starter, callerOf(ids.ns, 'partner-owner'))
    const mixed = { ...input, prices: input.prices.map((p) => (p.currency === 'USD' ? { ...p, monthly: { amount: 2900, currency: 'EUR' } } : p)) }
    expect((await run<Outcome>(update, callerOf(ids.ns, 'partner-owner'), { id: ids.starter, input: mixed, applyTo: 'new' })).data?.updatePlan).toMatchObject({ ok: false, reason: 'INVALID_CURRENCY', currency: 'USD' })
    const euro = { ...input, prices: [...input.prices, { currency: 'EUR', monthly: { amount: 2700, currency: 'EUR' }, yearly: null }] }
    expect((await run<Outcome>(update, callerOf(ids.ns, 'partner-owner'), { id: ids.starter, input: euro, applyTo: 'new' })).data?.updatePlan).toMatchObject({ ok: false, reason: 'INVALID_CURRENCY', currency: 'EUR' })
  })

  it('offers and accepts a currency the contract names without a rate, with no fee or margin in it', async () => {
    await db.sql`insert into partner_contract_rate (partner_id, currency, per_fee_unit) values (${ids.ns}, 'EUR', null)`
    try {
      const editor = await run<{ planEditor: { currencies: string[] } }>(editorQuery, callerOf(ids.ns, 'partner-owner'), { id: ids.starter })
      expect(editor.data?.planEditor.currencies.sort()).toEqual(['CAD', 'EUR', 'USD'])
      const input = await inputFrom(ids.starter, callerOf(ids.ns, 'partner-owner'))
      const euro = { ...input, name: 'Starter in euros', prices: [...input.prices, { currency: 'EUR', monthly: { amount: 2700, currency: 'EUR' }, yearly: null }] }
      expect((await run<Outcome>(create, callerOf(ids.ns, 'partner-owner'), { input: euro })).data?.createPlan).toMatchObject({ ok: true })
    } finally {
      await db.sql`delete from partner_contract_rate where partner_id = ${ids.ns} and currency = 'EUR'`
    }
  })

  it('lets Finance change a price and nothing else; Support and Read-only nothing', async () => {
    const input = await inputFrom(ids.starter, callerOf(ids.ns, 'partner-owner'))
    const finance = callerOf(ids.ns, 'partner-finance', 'Alex Rivera')
    expect((await run<Outcome>(update, finance, { id: ids.starter, input: { ...input, name: 'Starter Plus' }, applyTo: 'new' })).data?.updatePlan).toMatchObject({ ok: false, reason: 'PRICES_ONLY' })
    const repriced = { ...input, prices: input.prices.map((p) => (p.currency === 'USD' ? { ...p, monthly: { amount: 3100, currency: 'USD' } } : p)) }
    expect((await run<Outcome>(update, finance, { id: ids.starter, input: repriced, applyTo: 'new' })).data?.updatePlan).toMatchObject({ ok: true })
    for (const role of ['partner-support', 'partner-read-only'] as const) {
      expect((await run<Outcome>(update, callerOf(ids.ns, role), { id: ids.starter, input, applyTo: 'new' })).code).toBe('FORBIDDEN')
      expect((await run<Outcome>(create, callerOf(ids.ns, role), { input })).code).toBe('FORBIDDEN')
    }
  })

  it('asks who gets a change to a plan with stores; new signups only keeps every subscription on its version', async () => {
    const input = await inputFrom(ids.growth, callerOf(ids.ns, 'partner-owner'))
    expect((await run<Outcome>(update, callerOf(ids.ns, 'partner-admin'), { id: ids.growth, input })).data?.updatePlan).toMatchObject({ ok: false, reason: 'NEEDS_APPLY_TO' })
    const before = await db.sql`select store_id, plan_version, next_plan_id from store_subscription where plan_id = ${ids.growth} order by store_id`
    expect((await run<Outcome>(update, callerOf(ids.ns, 'partner-admin'), { id: ids.growth, input: { ...input, description: 'Now with more' }, applyTo: 'new' })).data?.updatePlan).toMatchObject({ ok: true })
    expect(await db.sql`select store_id, plan_version, next_plan_id from store_subscription where plan_id = ${ids.growth} order by store_id`).toEqual(before)
    expect(await db.sql`select version from plan where id = ${ids.growth}`).toEqual([{ version: 2 }])
    expect(await entriesFor(ids.growth)).toEqual(['plan.updated'])
  })

  it('schedules everyone at renewal at least 30 days out and queues their email, in the same transaction', async () => {
    const input = await inputFrom(ids.growth, callerOf(ids.ns, 'partner-owner'))
    // A store whose period has already ended (past due) still gets its 30 days.
    const [lapsed, kept] = await db.sql<{ store_id: string }[]>`select store_id from store_subscription where plan_id = ${ids.growth} and status <> 'cancelled' order by store_id limit 2`
    await db.sql`update store_subscription set period_start = ${new Date(now.getTime() - 70 * 86_400_000)}, period_end = ${new Date(now.getTime() - 40 * 86_400_000)}, interval = 'month' where store_id = ${lapsed?.store_id ?? ''}`
    // A store with its own change already scheduled keeps it.
    const [starter] = await db.sql<{ version: number }[]>`select version from plan where id = ${ids.starter}`
    await db.sql`update store_subscription set next_plan_id = ${ids.starter}, next_plan_version = ${starter?.version ?? 1}, change_at = ${new Date(now.getTime() + 5 * 86_400_000)} where store_id = ${kept?.store_id ?? ''}`
    expect((await run<Outcome>(update, callerOf(ids.ns, 'partner-owner'), { id: ids.growth, input, applyTo: 'renewal' })).data?.updatePlan).toMatchObject({ ok: true })
    const scheduled = await db.sql<{ next_plan_version: number; change_at: Date }[]>`select next_plan_version, change_at from store_subscription where plan_id = ${ids.growth} and status <> 'cancelled' and next_plan_id = ${ids.growth}`
    expect(scheduled.length).toBeGreaterThan(0)
    expect(scheduled.every((s) => s.next_plan_version === 3 && s.change_at.getTime() >= Date.now() + 30 * 86_400_000 - 60_000)).toBe(true)
    expect(await db.sql`select next_plan_id from store_subscription where store_id = ${kept?.store_id ?? ''}`).toEqual([{ next_plan_id: ids.starter }])
    const [emails] = await db.sql<{ n: number }[]>`select count(*)::int as n from outbox where payload->>'template' = 'plan-change-at-renewal' and payload->>'planId' = ${ids.growth}`
    expect(emails?.n).toBe(scheduled.length)
    // A second save re-points the stores already moving within Growth to the newest version.
    expect((await run<Outcome>(update, callerOf(ids.ns, 'partner-owner'), { id: ids.growth, input, applyTo: 'renewal' })).data?.updatePlan).toMatchObject({ ok: true })
    const again = await db.sql<{ next_plan_version: number }[]>`select next_plan_version from store_subscription where plan_id = ${ids.growth} and status <> 'cancelled' and next_plan_id = ${ids.growth}`
    expect(again.length).toBe(scheduled.length)
    expect(again.every((s) => s.next_plan_version === 4)).toBe(true)
    expect(await db.sql`select next_plan_id from store_subscription where store_id = ${kept?.store_id ?? ''}`).toEqual([{ next_plan_id: ids.starter }])
  })
})

describe('making live and retiring', () => {
  const live = `mutation($id: ID!) { makePlanLive(id: $id) { ok reason currency } }`
  const retire = `mutation($id: ID!, $input: RetirePlanInput!) { retirePlan(id: $id, input: $input) { ok reason } }`

  it('never makes a plan with nothing to charge live, contract or not', async () => {
    const [p] = await db.sql<{ id: string }[]>`insert into partner (name) values ('No Contract') returning id`
    const owner = callerOf(p?.id ?? '', 'partner-owner')
    const input = await inputFrom(ids.starter, callerOf(ids.ns, 'partner-owner'))
    const made = (await run<Outcome>(create, owner, { input: { ...input, entitlements: { ...input.entitlements, powered: false }, prices: [] } })).data?.createPlan
    expect((await run<Record<string, unknown>>(live, owner, { id: made?.id ?? '' })).data?.['makePlanLive']).toMatchObject({ ok: false, reason: 'UNPRICED_CURRENCY' })
  })

  it('moves the checklist’s plan item with the plans: to do, in progress, done by who made a priced plan live', async () => {
    const [p] = await db.sql<{ id: string }[]>`insert into partner (name) values ('Checklist Partner') returning id`
    const partnerId = p?.id ?? ''
    // As Create partner leaves it: a checklist with its company item done.
    await db.sql`insert into partner_setup_item (partner_id, item, status, done_at, done_by_kind, done_by_label) values (${partnerId}, 'company', 'done', now(), 'staff', 'DripFunnel')`
    const owner = callerOf(partnerId, 'partner-owner')
    const item = async () => (await withScope(db.sql, { caller: { kind: 'staff', staffId: 'st' } }, (tx) => selectSetupItemsFor(tx, [partnerId]))).find((i) => i.item === 'plan')
    expect(await item()).toMatchObject({ status: 'missing', done_by_label: null })
    const input = await inputFrom(ids.starter, callerOf(ids.ns, 'partner-owner'))
    const draft = { ...input, name: 'First', entitlements: { ...input.entitlements, powered: false }, prices: [{ currency: 'USD', monthly: { amount: 2900, currency: 'USD' }, yearly: null }] }
    const made = (await run<Outcome>(create, owner, { input: draft })).data?.createPlan
    const planId = made?.id ?? ''
    expect(await item()).toMatchObject({ status: 'progress', done_by_label: null })
    // A Live plan with no monthly price is not priced.
    await db.sql`update plan set status = 'live' where id = ${planId}`
    await db.sql`update plan_price set monthly_amount = null where plan_id = ${planId}`
    expect(await item()).toMatchObject({ status: 'progress', done_by_label: null })
    await db.sql`update plan set status = 'draft' where id = ${planId}`
    await db.sql`update plan_price set monthly_amount = 2900 where plan_id = ${planId}`
    expect((await run<Record<string, unknown>>(live, owner, { id: planId })).data?.['makePlanLive']).toMatchObject({ ok: true })
    expect(await item()).toMatchObject({ status: 'done', done_by_label: 'Maya Chen' })
    // Done stays done, with who did it, when the plan is later retired.
    await db.sql`update plan set status = 'retired' where id = ${planId}`
    expect(await item()).toMatchObject({ status: 'done', done_by_label: 'Maya Chen' })
  })

  it('makes a draft live only once every currency the partner sells in has a monthly price', async () => {
    const input = await inputFrom(ids.growth, callerOf(ids.ns, 'partner-owner'))
    const draft = { ...input, name: 'Scale', prices: [{ currency: 'USD', monthly: { amount: 19900, currency: 'USD' }, yearly: null }] }
    const made = (await run<Outcome>(create, callerOf(ids.ns, 'partner-owner'), { input: draft })).data?.createPlan
    expect(made).toMatchObject({ ok: true })
    const id = made?.id ?? ''
    expect((await run<Record<string, unknown>>(live, callerOf(ids.ns, 'partner-owner'), { id })).data?.['makePlanLive']).toMatchObject({ ok: false, reason: 'UNPRICED_CURRENCY', currency: 'CAD' })
    await run<Outcome>(update, callerOf(ids.ns, 'partner-owner'), { id, input: { ...draft, prices: [...draft.prices, { currency: 'CAD', monthly: { amount: 25900, currency: 'CAD' }, yearly: null }] } })
    expect((await run<Record<string, unknown>>(live, callerOf(ids.ns, 'partner-owner'), { id })).data?.['makePlanLive']).toMatchObject({ ok: true })
    expect((await entriesFor(id)).sort()).toEqual(['plan.created', 'plan.made_live', 'plan.updated'])
  })

  it('keeps a retired plan as its stores bought it', async () => {
    const [retired] = await db.sql<{ id: string }[]>`select id from plan where partner_id = ${ids.ns} and status = 'retired' limit 1`
    const input = await inputFrom(retired?.id ?? '', callerOf(ids.ns, 'partner-owner'))
    expect((await run<Outcome>(update, callerOf(ids.ns, 'partner-owner'), { id: retired?.id ?? '', input, applyTo: 'renewal' })).data?.updatePlan).toMatchObject({ ok: false, reason: 'INVALID_STATE' })
  })

  it('never leaves a partner without a Live plan, even when two are retired at once', async () => {
    const [p] = await db.sql<{ id: string }[]>`insert into partner (name) values ('Two Plans') returning id`
    const pid = p?.id ?? ''
    const [a, b] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${pid}, 'A', 'live'), (${pid}, 'B', 'live') returning id`
    const owner = callerOf(pid, 'partner-owner')
    const results = await Promise.all([a, b].map((plan) => run<Record<string, { ok: boolean; reason: string | null }>>(retire, owner, { id: plan?.id ?? '', input: { keep: true } })))
    expect(results.map((r) => r.data?.['retirePlan']?.ok).sort()).toEqual([false, true])
    expect(await db.sql`select count(*)::int as n from plan where partner_id = ${pid} and status = 'live'`).toEqual([{ n: 1 }])
  })

  it('moves a store already moving within the retiring plan, and keeps one moving to another plan', async () => {
    const scope = { caller: { kind: 'partner-user' as const, partnerUserId: 'pu' }, partnerId: ids.ns }
    const [within, elsewhere] = await db.sql<{ store_id: string; plan_version: number }[]>`
      select store_id, plan_version from store_subscription where plan_id = ${ids.starter} and status <> 'cancelled' order by store_id limit 2`
    const [growth] = await db.sql<{ version: number }[]>`select version from plan where id = ${ids.growth}`
    await db.sql`update store_subscription set next_plan_id = ${ids.starter}, next_plan_version = ${within?.plan_version ?? 1}, change_at = '2026-12-01T00:00:00Z' where store_id = ${within?.store_id ?? ''}`
    await db.sql`update store_subscription set next_plan_id = ${ids.growth}, next_plan_version = ${growth?.version ?? 1}, change_at = '2026-12-01T00:00:00Z' where store_id = ${elsewhere?.store_id ?? ''}`
    const moved = await withScope(db.sql, scope, (tx) => scheduleSubscriptionMoves(tx, ids.ns, ids.starter, { planId: ids.growth, version: growth?.version ?? 1 }, { on: new Date('2026-11-01T00:00:00Z') }))
    expect(moved.map((m) => m.store_id)).toContain(within?.store_id)
    expect(await db.sql`select next_plan_id, change_at from store_subscription where store_id = ${within?.store_id ?? ''}`).toEqual([{ next_plan_id: ids.growth, change_at: new Date('2026-11-01T00:00:00Z') }])
    expect(await db.sql`select change_at from store_subscription where store_id = ${elsewhere?.store_id ?? ''}`).toEqual([{ change_at: new Date('2026-12-01T00:00:00Z') }])
  })

  it('tells each store moved by a retirement', async () => {
    const [pro] = await db.sql<{ id: string }[]>`select id from plan where partner_id = ${ids.ns} and name = 'Pro'`
    const [onPro] = await db.sql<{ n: number }[]>`select count(*)::int as n from store_subscription where plan_id = ${pro?.id ?? ''} and status <> 'cancelled' and (next_plan_id is null or next_plan_id = plan_id)`
    expect(onPro?.n).toBeGreaterThan(0)
    const retired = await run<Record<string, unknown>>(`mutation($id: ID!, $input: RetirePlanInput!) { retirePlan(id: $id, input: $input) { ok reason } }`, callerOf(ids.ns, 'partner-owner'), {
      id: pro?.id,
      input: { keep: false, moveTo: ids.growth, on: '2026-11-01T00:00:00.000Z' },
    })
    expect(retired.data?.['retirePlan']).toMatchObject({ ok: true })
    const [emails] = await db.sql<{ n: number }[]>`select count(*)::int as n from outbox where payload->>'template' = 'plan-retired-move' and payload->>'planId' = ${ids.growth}`
    expect(emails?.n).toBe(onPro?.n)
  })

  it('retires with the stores moved on an offered date, and never the last Live plan', async () => {
    const owner = callerOf(ids.kl, 'partner-owner', 'Jonas Weber')
    const [basis, plus] = await Promise.all([
      db.sql<{ id: string }[]>`select id from plan where partner_id = ${ids.kl} and name = 'Basis'`,
      db.sql<{ id: string }[]>`select id from plan where partner_id = ${ids.kl} and name = 'Plus'`,
    ])
    const basisId = basis[0]?.id ?? ''
    const plusId = plus[0]?.id ?? ''
    expect((await run<Record<string, { reason: string }>>(retire, owner, { id: basisId, input: { keep: false, moveTo: plusId, on: '2026-10-15T00:00:00.000Z' } })).data?.['retirePlan']).toMatchObject({ ok: false, reason: 'INVALID_TARGET' })
    expect((await run<Record<string, unknown>>(retire, owner, { id: basisId, input: { keep: false, moveTo: plusId, on: '2026-11-01T00:00:00.000Z' } })).data?.['retirePlan']).toMatchObject({ ok: true })
    expect(await db.sql`select status, retire_move_to_plan_id from plan where id = ${basisId}`).toEqual([{ status: 'retired', retire_move_to_plan_id: plusId }])
    expect((await run<Record<string, unknown>>(retire, owner, { id: plusId, input: { keep: true } })).data?.['retirePlan']).toMatchObject({ ok: false, reason: 'LAST_LIVE_PLAN' })
    expect(await entriesFor(basisId)).toEqual(['plan.retired'])
  })
})
