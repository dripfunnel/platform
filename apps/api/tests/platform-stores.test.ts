import { graphql, isObjectType, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import { activityLog } from '#saas/activity/index'
import { createPartnerStoresService } from '#saas/partnerStores/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #159: Stores on the Platform API over the seeded partners.

let db: TestDatabase
const now = new Date('2026-10-03T09:00:00Z')
const ids = { ns: '', bz: '' }
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }

const callerOf = (partnerId: string, role: PartnerRole, name = 'Maya Chen'): PartnerCaller => ({
  user: { id: crypto.randomUUID(), name, email: 'maya@northstar.example', role },
  partner: { id: partnerId, name: 'Northstar Commerce', product: 'Northstar Shops', host: null, state: 'live' },
})

const run = async <T>(source: string, caller: PartnerCaller, variables: Record<string, unknown> = {}) => {
  const stores = createPartnerStoresService({ sql: db.sql, caller, facts, activity: activityLog, now: () => now })
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue: { caller, console: null, plans: null, branding: null, stores } })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const listQuery = `query($filter: StoreFilterInput, $after: String, $before: String, $first: Int) { stores(filter: $filter, after: $after, before: $before, first: $first) {
  items { id name code owner { name email } plan { id name } near { percent limit } state { kind daysLeft daysPastDue reason } storefront domain { host status } createdAt billingStatus }
  pageInfo { hasNextPage hasPreviousPage startCursor endCursor } plans { id name } billingMode exportPermission { allowed } billingStatusPermission { allowed reason } } }`
type Page = { stores: { items: { id: string; state: { kind: string }; plan: { id: string } | null; near: { percent: number } | null; billingStatus: string | null }[]; pageInfo: { hasNextPage: boolean; hasPreviousPage: boolean; startCursor: string | null; endCursor: string | null }; billingMode: string; billingStatusPermission: { allowed: boolean; reason: string | null } | null } }
const list = async (caller: PartnerCaller, variables: Record<string, unknown> = {}) => (await run<Page>(listQuery, caller, variables)).data?.stores

const detailQuery = `query($id: ID!) { store(id: $id) { row { id name state { kind } } country price { amount currency } people { count suppliers } contacts { email role }
  usage { limit used cap percent } overrides { limit amount reason by } billing { interval nextChargeAt cardLast4 mode chargedBy } site { liveHost previewHost }
  records { host status value } setup { state } trialExtensions { days } support { allowed people { email role } } activity { action }
  more { overrides trialExtensions people activity } actions { changePlan { allowed reason } extendTrial { allowed reason } addOverride { allowed reason } resendInvite { allowed } restore { allowed } suspend { allowed } retryStep { allowed } } } }`
type Actions = Record<string, { allowed: boolean; reason: string | null } | null>
type Detail = { store: { row: { id: string }; more: Record<string, boolean>; overrides: unknown[]; people: { count: number; suppliers: number }; usage: { limit: string }[]; actions: Actions; billing: { mode: string; chargedBy: string | null } } | null }

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  ids.ns = (await db.sql<{ id: string }[]>`select id from partner where name = 'Northstar Commerce'`)[0]?.id ?? ''
  ids.bz = (await db.sql<{ id: string }[]>`select id from partner where name = 'Bazaar Cloud'`)[0]?.id ?? ''
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('the list', () => {
  it('pages the partner’s stores newest first, every one reachable, no other partner’s', async () => {
    const owner = callerOf(ids.ns, 'partner-owner')
    const seen: string[] = []
    let after: string | null = null
    for (let i = 0; i < 5; i += 1) {
      const page = await list(owner, { after, first: 25 })
      seen.push(...(page?.items.map((s) => s.id) ?? []))
      if (!page?.pageInfo.hasNextPage) break
      after = page.pageInfo.endCursor
    }
    const all = await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.ns} order by created_at desc, id desc`
    expect(seen).toEqual(all.map((s) => s.id))
    expect((await list(owner, { first: 1000 }))?.items).toHaveLength(25)
    const first = await list(owner, { first: 10 })
    const second = await list(owner, { after: first?.pageInfo.endCursor, first: 10 })
    expect(second?.pageInfo.hasPreviousPage).toBe(true)
    const back = await list(owner, { before: second?.pageInfo.startCursor, first: 10 })
    expect(back?.items.map((s) => s.id)).toEqual(first?.items.map((s) => s.id))
  })

  it('filters by status, plan, near a limit and search, in SQL', async () => {
    const owner = callerOf(ids.ns, 'partner-owner')
    expect((await list(owner, { filter: { status: 'pastdue' }, first: 25 }))?.items.every((s) => s.state.kind === 'pastdue')).toBe(true)
    const [growth] = await db.sql<{ id: string }[]>`select id from plan where partner_id = ${ids.ns} and name = 'Growth'`
    const onGrowth = await list(owner, { filter: { plan: growth?.id }, first: 25 })
    expect(onGrowth?.items.length).toBeGreaterThan(0)
    expect(onGrowth?.items.every((s) => s.plan?.id === growth?.id)).toBe(true)
    const near = await list(owner, { filter: { near: 'yes' }, first: 25 })
    expect(near?.items).toHaveLength(4)
    expect(near?.items.every((s) => (s.near?.percent ?? 0) >= 80)).toBe(true)
    const [theirs] = await db.sql<{ code: string }[]>`select code from store where partner_id = ${ids.bz} limit 1`
    expect((await list(owner, { filter: { q: theirs?.code } }))?.items).toEqual([])
  })

  it('counts a closed store as cancelled', async () => {
    const owner = callerOf(ids.ns, 'partner-owner')
    const [store] = await db.sql<{ id: string }[]>`update store set status = 'closed' where id = (select id from store where partner_id = ${ids.ns} and status = 'cancelled' limit 1) returning id`
    expect((await list(owner, { filter: { status: 'cancelled' }, first: 25 }))?.items.map((s) => s.id)).toContain(store?.id)
    await db.sql`update store set status = 'cancelled' where id = ${store?.id ?? ''}`
  })

  it('refuses a filter or a cursor it cannot read', async () => {
    expect((await run(listQuery, callerOf(ids.ns, 'partner-owner'), { filter: { status: 'lost' } })).code).toBe('INVALID_INPUT')
    expect((await run(listQuery, callerOf(ids.ns, 'partner-owner'), { after: 'nope' })).code).toBe('INVALID_INPUT')
  })
})

describe('the detail', () => {
  it('shows the partner’s own store’s tabs and nothing of another partner’s store', async () => {
    const [mine] = await db.sql<{ id: string }[]>`select store_id as id from store_limit_override o join store s on s.id = o.store_id where s.partner_id = ${ids.ns} limit 1`
    const detail = (await run<Detail>(detailQuery, callerOf(ids.ns, 'partner-read-only'), { id: mine?.id })).data?.store
    expect(detail?.row.id).toBe(mine?.id)
    expect(detail?.usage.map((u) => u.limit)).toEqual(['products', 'staff', 'suppliers', 'ai_prompts', 'publish_now'])
    expect(detail?.billing).toMatchObject({ mode: 'dripfunnel', chargedBy: expect.stringContaining('DripFunnel for') })
    const [counted] = await db.sql<{ people: number; suppliers: number }[]>`
      select (select count(*)::int from membership where store_id = ${mine?.id ?? ''} and status <> 'suspended') as people, (select count(*)::int from seller where store_id = ${mine?.id ?? ''}) as suppliers`
    expect(detail?.more).toEqual({ overrides: false, trialExtensions: false, people: false, activity: false })
    await db.sql`
      insert into store_limit_override (store_id, key, amount, duration, reason, created_by_kind, created_by_label)
      select ${mine?.id ?? ''}, 'products', 10, 'always', 'Holiday catalogue', 'staff', 'Seed' from generate_series(1, 26)`
    const more = (await run<Detail>(detailQuery, callerOf(ids.ns, 'partner-read-only'), { id: mine?.id })).data?.store
    expect(more?.overrides).toHaveLength(25)
    expect(more?.more['overrides']).toBe(true)
    expect(detail?.people).toEqual({ count: counted?.people, suppliers: counted?.suppliers })
    const [theirs] = await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.bz} limit 1`
    expect((await run<Detail>(detailQuery, callerOf(ids.ns, 'partner-owner'), { id: theirs?.id })).data?.store).toBeNull()
  })

  it('measures usage as the list does, last month’s meter counting nothing, and an id it cannot read finds nothing', async () => {
    const owner = callerOf(ids.ns, 'partner-owner')
    const near = (await list(owner, { filter: { near: 'yes' }, first: 25 }))?.items ?? []
    for (const row of near) {
      const usage = (await run<{ store: { usage: { percent: number | null }[] } | null }>(detailQuery, owner, { id: row.id })).data?.store?.usage ?? []
      expect(Math.max(...usage.map((u) => u.percent ?? 0))).toBe(row.near?.percent)
    }
    const [meter] = await db.sql<{ store_id: string }[]>`
      update store_usage set period_start = (date_trunc('month', ${now}::timestamptz at time zone 'UTC') - interval '1 month')::date, used = 7
      where (store_id, key) = (select u.store_id, u.key from store_usage u join store s on s.id = u.store_id where s.partner_id = ${ids.ns} and u.key = 'ai_prompts' limit 1)
      returning store_id`
    const usage = (await run<{ store: { usage: { limit: string; used: number }[] } | null }>(detailQuery, owner, { id: meter?.store_id })).data?.store?.usage
    expect(usage?.find((u) => u.limit === 'ai_prompts')?.used).toBe(0)
    expect((await run<Detail>(detailQuery, owner, { id: 'not-a-uuid' })).data?.store).toBeNull()
  })

  it('returns the §6.4 block: offered by state, refused by role with a stable code', async () => {
    const [suspended] = await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.ns} and status = 'suspended' limit 1`
    const [trial] = await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.ns} and status = 'trial' limit 1`
    const s = (await run<Detail>(detailQuery, callerOf(ids.ns, 'partner-owner'), { id: suspended?.id })).data?.store?.actions
    expect(s?.['restore']).toMatchObject({ allowed: true })
    expect(s?.['suspend']).toBeNull()
    const finance = (await run<Detail>(detailQuery, callerOf(ids.ns, 'partner-finance'), { id: trial?.id })).data?.store?.actions
    expect(finance?.['extendTrial']).toMatchObject({ allowed: true })
    expect(finance?.['changePlan']).toEqual({ allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' })
    const support = (await run<Detail>(detailQuery, callerOf(ids.ns, 'partner-support'), { id: trial?.id })).data?.store?.actions
    expect(support?.['extendTrial']).toEqual({ allowed: false, reason: 'FINANCE_TRIAL_ONLY' })
  })

  it('has no type in the Platform API that reaches an order, a customer or a product', () => {
    const names = Object.values((platformSchema as GraphQLSchema).getTypeMap()).filter((t) => isObjectType(t) && !t.name.startsWith('__')).map((t) => t.name)
    expect(names.filter((n) => /order|customer|product|catalog/i.test(n))).toEqual([])
  })
})

describe('billing status', () => {
  const set = `mutation($id: ID!, $status: String!) { setStoreBillingStatus(id: $id, status: $status) { ok reason } }`
  it('is refused while DripFunnel bills, set when the partner bills itself, never on a cancelled store, and logged once', async () => {
    const [store] = await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.ns} and status = 'active' limit 1`
    const [cancelled] = await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.ns} and status = 'cancelled' limit 1`
    const finance = callerOf(ids.ns, 'partner-finance', 'Alex Rivera')
    expect((await run<Record<string, unknown>>(set, finance, { id: store?.id, status: 'past_due' })).data?.['setStoreBillingStatus']).toEqual({ ok: false, reason: 'NOT_SELF_BILLING' })
    await db.sql`update partner set billing_mode = 'own' where id = ${ids.ns}`
    expect((await list(finance))?.billingStatusPermission).toEqual({ allowed: true, reason: null })
    expect((await run<Record<string, unknown>>(set, finance, { id: store?.id, status: 'past_due' })).data?.['setStoreBillingStatus']).toEqual({ ok: true, reason: null })
    expect((await run<Record<string, unknown>>(set, finance, { id: cancelled?.id, status: 'active' })).data?.['setStoreBillingStatus']).toEqual({ ok: false, reason: 'CANCELLED' })
    for (const role of ['partner-support', 'partner-read-only'] as const) expect((await run(set, callerOf(ids.ns, role), { id: store?.id, status: 'active' })).code).toBe('FORBIDDEN')
    expect(await db.sql`select billing_status from store where id = ${store?.id ?? ''}`).toEqual([{ billing_status: 'past_due' }])
    expect((await db.sql`select 1 from activity_log where action = 'store.billing_status_set' and store_id = ${store?.id ?? ''}`).length).toBe(1)
    expect((await run<Record<string, unknown>>(set, finance, { id: 'not-a-uuid', status: 'active' })).data?.['setStoreBillingStatus']).toEqual({ ok: false, reason: 'NOT_FOUND' })
    expect((await list(callerOf(ids.ns, 'partner-support')))?.billingStatusPermission).toEqual({ allowed: false, reason: 'BILLING_ROLES_ONLY' })
  })

  it('never reaches another partner’s store', async () => {
    await db.sql`update partner set billing_mode = 'own' where id = ${ids.bz}`
    const [theirs] = await db.sql<{ id: string; billing_status: string | null }[]>`select id, billing_status from store where partner_id = ${ids.bz} and status = 'active' limit 1`
    const finance = callerOf(ids.ns, 'partner-finance', 'Alex Rivera')
    expect((await run<Record<string, unknown>>(set, finance, { id: theirs?.id, status: 'suspended' })).data?.['setStoreBillingStatus']).toEqual({ ok: false, reason: 'NOT_FOUND' })
    expect(await db.sql`select billing_status from store where id = ${theirs?.id ?? ''}`).toEqual([{ billing_status: theirs?.billing_status ?? null }])
    expect((await db.sql`select 1 from activity_log where store_id = ${theirs?.id ?? ''} and action = 'store.billing_status_set'`).length).toBe(0)
  })
})
