import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import { withScope } from '#db/scoped/index'
import { selectPartners } from '#db/scoped/partners'
import { activityLog } from '#saas/activity/index'
import { createPartnerConsoleService } from '#saas/partnerConsole/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #158: partnerState, navBadges, search, onboarding and submitForApproval, over the seed.

let db: TestDatabase
const now = new Date('2026-10-03T09:00:00Z')
const ids = { ns: '', kl: '', bz: '' }
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }

const callerOf = (partnerId: string, role: PartnerRole, name = 'Jonas Weber'): PartnerCaller => ({
  role,
  user: { id: crypto.randomUUID(), name, email: 'someone@example.test' },
  staff: null,
  partner: { id: partnerId, name: 'P', product: 'P', host: null, state: 'draft' },
})

const run = async <T>(source: string, caller: PartnerCaller, variables: Record<string, unknown> = {}): Promise<{ data: T | null; code: string | undefined }> => {
  const contextValue = { caller, console: createPartnerConsoleService({ sql: db.sql, caller, facts, activity: activityLog, now: () => now }) }
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const partnerId = async (name: string) => (await db.sql<{ id: string }[]>`select id from partner where name = ${name}`)[0]?.id ?? ''

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  ids.ns = await partnerId('Northstar Commerce')
  ids.kl = await partnerId('Kaufladen Digital')
  ids.bz = await partnerId('Bazaar Cloud')
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('partnerState', () => {
  it('gives the facts the banners need, its own partner’s only', async () => {
    await db.sql`update partner_domain set status = 'broken' where partner_id = ${ids.ns} and kind = 'portal'`
    const { data } = await run<{ partnerState: { storeCount: number; brokenHosts: string[]; setupSession: unknown; billingMode: string } }>('{ partnerState { storeCount brokenHosts billingMode setupSession { staffName } } }', callerOf(ids.ns, 'partner-read-only'))
    const [expected] = await db.sql<{ n: number }[]>`select count(*)::int as n from store where partner_id = ${ids.ns} and status <> 'closed'`
    expect(data?.partnerState.storeCount).toBe(expected?.n)
    expect(data?.partnerState.brokenHosts).toEqual(['store.northstar.example'])
    expect(data?.partnerState.setupSession).toBeNull()
    const [mode] = await db.sql<{ billing_mode: string }[]>`select billing_mode from partner where id = ${ids.ns}`
    expect(data?.partnerState.billingMode).toBe(mode?.billing_mode)
  })

  it('reports an open staff setup session by first name and end', async () => {
    const [staff] = await db.sql<{ id: string }[]>`select id from staff_user where name = 'Priya Shah'`
    await db.sql`insert into partner_setup_session (staff_user_id, partner_id, reason, expires_at) values (${staff?.id ?? ''}, ${ids.kl}, 'setup', ${new Date(now.getTime() + 3600_000)})`
    const { data } = await run<{ partnerState: { setupSession: { staffName: string } } }>('{ partnerState { setupSession { staffName endsAt } } }', callerOf(ids.kl, 'partner-owner'))
    expect(data?.partnerState.setupSession.staffName).toBe('Priya')
    // The one read made in system scope: another partner never sees this session.
    for (const other of [ids.ns, ids.bz]) {
      const seen = await run<{ partnerState: { setupSession: unknown } }>('{ partnerState { setupSession { staffName } } }', callerOf(other, 'partner-owner'))
      expect(seen.data?.partnerState.setupSession).toBeNull()
    }
  })
})

describe('navBadges', () => {
  const shell = `{ navBadges { storesAttention brandingSetupLeft domainsWaiting billingFailedPayments supportOpenSessions }
    partnerState { storeCount brokenHosts } onboarding { items { key status doneBy } } }`
  type Shell = { navBadges: Record<string, number>; partnerState: { storeCount: number; brokenHosts: string[] }; onboarding: unknown }
  const shellOf = async (partnerId: string) => (await run<Shell>(shell, callerOf(partnerId, 'partner-owner'))).data

  it('counts exactly this partner’s rows: another partner’s failed signup, broken host, waiting domain and open item never move them', async () => {
    const before = await shellOf(ids.ns)
    const otherBefore = await shellOf(ids.bz)
    const [store] = await db.sql<{ id: string }[]>`select id from store s where partner_id = ${ids.bz} and not exists (select 1 from job j where j.store_id = s.id and j.state <> 'done') limit 1`
    await db.sql`insert into job (store_id, kind, state, steps, step) values (${store?.id ?? ''}, 'provision-store', 'failed', '{accountAndStore}'::text[], 'accountAndStore')`
    await db.sql`update partner_domain set status = 'broken' where partner_id = ${ids.bz} and kind = 'portal'`
    await db.sql`update partner_domain set status = 'waiting' where partner_id = ${ids.bz} and kind = 'preview'`
    await db.sql`update partner set approved_at = null where id = ${ids.bz}`
    await db.sql`update partner_setup_item set status = 'missing', done_at = null, done_by_kind = null, done_by_label = null where partner_id = ${ids.bz} and item = 'branding'`

    expect(await shellOf(ids.ns)).toEqual(before)
    const other = await shellOf(ids.bz)
    expect(other?.navBadges['storesAttention']).toBe((otherBefore?.navBadges['storesAttention'] ?? 0) + 1)
    expect(other?.navBadges['brandingSetupLeft']).toBe(1)
    expect(other?.navBadges['domainsWaiting']).toBe((otherBefore?.navBadges['domainsWaiting'] ?? 0) + 2)
    expect(other?.partnerState.brokenHosts).toEqual(['portal.bazaarcloud.example'])
    expect(other?.navBadges['billingFailedPayments']).toBe(0)
    expect(other?.navBadges['supportOpenSessions']).toBe(0)
  })

  it('stops counting branding setup once the partner has been approved', async () => {
    await db.sql`update partner set approved_at = now() where id = ${ids.bz}`
    expect((await shellOf(ids.bz))?.navBadges['brandingSetupLeft']).toBe(0)
  })

  it('counts a merchant’s domain waiting over a day, not one replaced since', async () => {
    const badges = async () => (await run<{ navBadges: { storesAttention: number } }>('{ navBadges { storesAttention } }', callerOf(ids.ns, 'partner-owner'))).data?.navBadges.storesAttention ?? -1
    const [store] = await db.sql<{ id: string }[]>`select id from store s where partner_id = ${ids.ns} and not exists (select 1 from custom_domain where store_id = s.id) and not exists (select 1 from job j where j.store_id = s.id and j.state <> 'done') limit 1`
    const before = await badges()
    await db.sql`insert into custom_domain (store_id, host, status, expected_cname, ownership_token, created_at) values (${store?.id ?? ''}, 'shop.waiting.example', 'waiting', 'x', 't', ${new Date(now.getTime() - 2 * 86_400_000)})`
    expect(await badges()).toBe(before + 1)
    await db.sql`insert into custom_domain (store_id, host, status, expected_cname, ownership_token, created_at) values (${store?.id ?? ''}, 'shop.live.example', 'live', 'x', 't', ${now})`
    expect(await badges()).toBe(before)
  })
})

describe('search', () => {
  it('finds this partner’s stores by name, code, domain or owner email, capped, never another partner’s', async () => {
    const [mine] = await db.sql<{ name: string; code: string }[]>`select name, code from store where partner_id = ${ids.ns} order by name limit 1`
    const [theirs] = await db.sql<{ name: string }[]>`
      select name from store b where partner_id = ${ids.bz} and not exists (select 1 from store n where n.partner_id = ${ids.ns} and n.name ilike '%' || b.name || '%') order by name limit 1
    `
    expect(theirs).toBeDefined()
    const found = async (query: string) => (await run<{ search: { id: string; name: string; ownerEmail: string | null }[] }>('query($q: String!) { search(query: $q) { id name code domain ownerEmail status } }', callerOf(ids.ns, 'partner-read-only'), { q: query })).data?.search ?? []
    expect((await found(mine?.code ?? '')).map((s) => s.name)).toContain(mine?.name)
    const [byOwner] = await db.sql<{ id: string; email: string }[]>`
      select s.id, u.email from store s join membership m on m.store_id = s.id and m.role_key = 'owner' and m.seller_id is null join "user" u on u.id = m.user_id
      where s.partner_id = ${ids.ns} order by s.name limit 1
    `
    expect((await found(byOwner?.email ?? '')).map((s) => s.id)).toContain(byOwner?.id)
    const [theirOwner] = await db.sql<{ email: string }[]>`
      select u.email from store s join membership m on m.store_id = s.id and m.role_key = 'owner' join "user" u on u.id = m.user_id where s.partner_id = ${ids.bz} limit 1
    `
    expect(await found(theirOwner?.email ?? '')).toEqual([])
    const [mineStore, theirStore] = await Promise.all([
      db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.ns} order by name limit 1`,
      db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.bz} order by name limit 1`,
    ])
    // Later than the seed's own domains, so each is its store's current domain.
    const later = new Date(now.getTime() + 3_600_000)
    await db.sql`insert into custom_domain (store_id, host, status, expected_cname, ownership_token, created_at) values (${mineStore[0]?.id ?? ''}, 'shop.mine-search.example', 'live', 'x', 't', ${later}), (${theirStore[0]?.id ?? ''}, 'shop.theirs-search.example', 'live', 'x', 't', ${later})`
    expect((await found('mine-search')).map((s) => s.id)).toEqual([mineStore[0]?.id])
    expect(await found('theirs-search')).toEqual([])
    expect(await found(theirs?.name ?? '')).toEqual([])
    expect((await found('e')).length).toBe(0)
    expect((await found('.example')).length).toBeLessThanOrEqual(8)
    const owners = await db.sql<{ partner_id: string }[]>`select partner_id from store where id = any(${`{${(await found('.example')).map((s) => s.id).join(',')}}`}::uuid[])`
    expect(owners.length).toBeGreaterThan(0)
    expect(owners.every((r) => r.partner_id === ids.ns)).toBe(true)
  })
})

describe('onboarding and submitForApproval', () => {
  const onboardingQuery = '{ onboarding { items { key status doneBy to } checks { portalHost emailDomain pricedPlan legalPages testSignup } submittedBy sentBackReason fixes { item to } canSubmit { allowed reason } } }'
  const submit = 'mutation { submitForApproval { ok code check submittedAt } }'
  type Ob = { onboarding: { items: { key: string; status: string; doneBy: string | null }[]; checks: Record<string, boolean>; submittedBy: string | null; fixes: { item: string }[]; canSubmit: { allowed: boolean; reason: string | null } } }
  type Sub = { submitForApproval: { ok: boolean; code: string | null; check: string | null } }

  it('lists the ten items, staff work as DripFunnel, and never a payment item done by staff', async () => {
    await db.sql`update partner_setup_item set status = 'done', done_at = now(), done_by_kind = 'staff', done_by_label = 'DripFunnel' where partner_id = ${ids.kl} and item = 'paymentMethod'`
    const { data } = await run<Ob>(onboardingQuery, callerOf(ids.kl, 'partner-owner'))
    const items = data?.onboarding.items ?? []
    expect(items.map((i) => i.key)).toEqual(['company', 'branding', 'portalHost', 'wildcards', 'emailSender', 'plan', 'legal', 'paymentMethod', 'payoutDetails', 'testSignup'])
    expect(items.find((i) => i.key === 'branding')?.doneBy).toBe('DripFunnel')
    expect(items.find((i) => i.key === 'company')?.doneBy).toBe('Jonas')
    expect(items.find((i) => i.key === 'paymentMethod')).toMatchObject({ status: 'missing', doneBy: null })
    expect(data?.onboarding.submittedBy).toBe('partner')
    expect(data?.onboarding.canSubmit).toEqual({ allowed: false, reason: 'ALREADY_SUBMITTED' })
  })

  it('refuses a second submission, and Support, Finance and Read-only outright', async () => {
    expect((await run<Sub>(submit, callerOf(ids.kl, 'partner-owner'))).data?.submitForApproval).toMatchObject({ ok: false, code: 'ALREADY_SUBMITTED' })
    for (const role of ['partner-support', 'partner-finance', 'partner-read-only'] as const) {
      expect((await run<Sub>(submit, callerOf(ids.kl, role))).code).toBe('FORBIDDEN')
    }
  })

  it('tells a Live or Paused partner it was approved, not that it submitted', async () => {
    expect((await run<Sub>(submit, callerOf(ids.ns, 'partner-owner'))).data?.submitForApproval).toMatchObject({ ok: false, code: 'ALREADY_APPROVED' })
    const southwind = await partnerId('Southwind Retail')
    expect(await db.sql`select state from partner where id = ${southwind}`).toEqual([{ state: 'paused' }])
    expect((await run<Sub>(submit, callerOf(southwind, 'partner-owner'))).data?.submitForApproval).toMatchObject({ ok: false, code: 'ALREADY_APPROVED' })
    expect((await run<Ob>(onboardingQuery, callerOf(southwind, 'partner-owner'))).data?.onboarding.canSubmit).toEqual({ allowed: false, reason: 'ALREADY_APPROVED' })
  })

  it('names the first failing check, then submits a sent-back partner once it passes, with one entry, into the admin queue', async () => {
    await db.sql`update partner set state = 'draft', sent_back_reason = 'Legal pages missing an Impressum' where id = ${ids.kl}`
    await db.sql`update partner_setup_item set status = 'missing', done_at = null, done_by_kind = null, done_by_label = null where partner_id = ${ids.kl} and item = 'legal'`
    const sentBack = (await run<Ob>(onboardingQuery, callerOf(ids.kl, 'partner-admin'))).data?.onboarding
    expect(sentBack?.fixes.map((f) => f.item)).toEqual(['legal'])
    expect(sentBack?.canSubmit).toEqual({ allowed: true, reason: null })
    expect((await run<Sub>(submit, callerOf(ids.kl, 'partner-admin'))).data?.submitForApproval).toMatchObject({ ok: false, code: 'GO_LIVE_CHECK_FAILED', check: 'legalPages' })

    await db.sql`update partner_setup_item set status = 'done', done_at = now(), done_by_kind = 'partner_user', done_by_label = 'Jonas Weber' where partner_id = ${ids.kl} and item = 'legal'`
    // A Live plan with no monthly price is not "priced" (#157's catalogue).
    await db.sql`update plan_price set monthly_amount = null where partner_id = ${ids.kl}`
    expect((await run<Ob>(onboardingQuery, callerOf(ids.kl, 'partner-admin'))).data?.onboarding.checks['pricedPlan']).toBe(false)
    expect((await run<Sub>(submit, callerOf(ids.kl, 'partner-admin'))).data?.submitForApproval).toMatchObject({ ok: false, code: 'GO_LIVE_CHECK_FAILED', check: 'pricedPlan' })
    await db.sql`update plan_price set monthly_amount = 2500 where partner_id = ${ids.kl} and currency = 'EUR' and yearly_amount is not null`
    const done = await run<Sub>(submit, callerOf(ids.kl, 'partner-admin', 'Petra Lang'))
    expect(done.data?.submitForApproval).toMatchObject({ ok: true, code: null })
    expect(await db.sql`select state, submitted_by_kind, submitted_by_label, sent_back_reason from partner where id = ${ids.kl}`).toEqual([
      { state: 'awaiting', submitted_by_kind: 'partner_user', submitted_by_label: 'Petra Lang', sent_back_reason: null },
    ])
    const entries = await db.sql`select actor_kind, api, visibility from activity_log where action = 'partner.submitted' and partner_id = ${ids.kl} and actor_label like 'Petra Lang%'`
    expect(entries).toEqual([{ actor_kind: 'partner_user', api: 'platform', visibility: 'partner' }])
    const queue = await withScope(db.sql, { caller: { kind: 'staff', staffId: 'st' } }, (tx) => selectPartners(tx, { state: 'awaiting' }, {}, 25, 'oldestSubmitted'))
    expect(queue.map((p) => p.id)).toContain(ids.kl)
  })
})
