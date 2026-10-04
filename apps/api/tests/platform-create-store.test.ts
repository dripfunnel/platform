import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import { withScope } from '#db/scoped/index'
import { storesExportDeliverer } from '#jobs/queues/deliverers/storesExport'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createPartnerActivityService } from '#saas/partnerActivity/index'
import { createPartnerStoresService, storesExportMax } from '#saas/partnerStores/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #221: creating a store from the partner console, its setup steps, and the accounts export.

let db: TestDatabase
const now = new Date('2026-10-03T09:00:00Z')
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }
const ids = { ns: '', bz: '', nsPlan: '', bzPlan: '' }

const callerOf = (partnerId: string, role: PartnerRole = 'partner-owner'): PartnerCaller => ({
  role,
  user: { id: crypto.randomUUID(), name: 'Maya Chen', email: 'maya@northstar.example' },
  staff: null,
  partner: { id: partnerId, name: 'Northstar Commerce', product: 'Northstar Shops', host: null, state: 'live' },
})

const run = async <T>(source: string, caller: PartnerCaller, variables: Record<string, unknown> = {}) => {
  const deps = { sql: db.sql, caller, facts, activity: activityLog, now: () => now }
  const contextValue = { caller, stores: createPartnerStoresService(deps), activity: createPartnerActivityService(deps) }
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const q = {
  form: `{ createStoreForm { permission { allowed reason } countries { code name currency } plans { id name trialDays prices { amount currency } } trials billingMode } }`,
  create: `mutation($i: CreateStoreInput!) { createStore(input: $i) { ok storeId reason field } }`,
  progress: `query($id: ID!) { provisioning(storeId: $id) { steps { key state } done elapsedSeconds } }`,
  exportStores: `mutation($f: StoreFilterInput) { exportStores(filter: $f) { ok jobId reason } }`,
  job: `query($id: ID!) { storesExport(id: $id) { state rows truncated csv } }`,
}
type Form = { createStoreForm: { permission: { allowed: boolean; reason: string | null }; countries: { code: string; currency: string }[]; plans: { id: string; prices: { amount: number; currency: string }[]; trialDays: number }[]; trials: number[] } }
type Created = { createStore: { ok: boolean; storeId: string | null; reason: string | null; field: string | null } }
const input = (over: Record<string, unknown> = {}) => ({ name: 'Cedar & Pine', ownerName: 'Ruth Cole', ownerEmail: 'ruth@cedarpine.example', country: 'US', planId: ids.nsPlan, trialDays: 14, ...over })

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  ids.ns = (await db.sql<{ id: string }[]>`select id from partner where name = 'Northstar Commerce'`)[0]?.id ?? ''
  ids.bz = (await db.sql<{ id: string }[]>`select id from partner where name = 'Bazaar Cloud'`)[0]?.id ?? ''
  const plan = async (partnerId: string, currency: string) =>
    (await db.sql<{ id: string }[]>`
      select p.id from plan p join plan_price pp on pp.plan_id = p.id and pp.version = p.version
      where p.partner_id = ${partnerId} and p.status = 'live' and pp.currency = ${currency} and pp.monthly_amount is not null order by p.name limit 1`)[0]?.id ?? ''
  ids.nsPlan = await plan(ids.ns, 'USD')
  ids.bzPlan = await plan(ids.bz, 'INR')
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('the form', () => {
  it('offers the countries its Live plans are priced for, those plans with their prices, and the trials', async () => {
    const form = (await run<Form>(q.form, callerOf(ids.ns))).data?.createStoreForm
    expect(form?.permission).toEqual({ allowed: true, reason: null })
    expect(form?.countries.find((c) => c.code === 'US')).toEqual({ code: 'US', name: 'United States', currency: 'USD' })
    const currencies = new Set(form?.plans.flatMap((p) => p.prices.map((x) => x.currency)))
    expect(form?.countries.every((c) => currencies.has(c.currency))).toBe(true)
    expect(form?.plans.map((p) => p.id)).toContain(ids.nsPlan)
    expect(form?.trials).toEqual([0, 7, 14, 30])
    expect((await run<Form>(q.form, callerOf(ids.ns, 'partner-support'))).data?.createStoreForm.permission).toEqual({ allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' })
  })
})

describe('creating', () => {
  it('creates the store, its invited Owner, a trial on the plan’s price, a finished setup and the invitation email, logged once', async () => {
    const created = (await run<Created>(q.create, callerOf(ids.ns), { i: input() })).data?.createStore
    expect(created?.ok).toBe(true)
    const storeId = created?.storeId ?? ''
    const [store] = await db.sql<{ code: string; status: string; country: string; plan_id: string; trial_ends_at: Date }[]>`select code, status, country, plan_id, trial_ends_at from store where id = ${storeId}`
    expect(store).toMatchObject({ code: 'cedar-pine', status: 'trial', country: 'US', plan_id: ids.nsPlan })
    expect(store?.trial_ends_at.toISOString()).toBe(new Date(now.getTime() + 14 * 86_400_000).toISOString())
    const [owner] = await db.sql<{ status: string; role_key: string; m_status: string }[]>`
      select u.status, m.role_key, m.status as m_status from membership m join "user" u on u.id = m.user_id where m.store_id = ${storeId}`
    expect(owner).toEqual({ status: 'invited', role_key: 'owner', m_status: 'invited' })
    const [sub] = await db.sql<{ status: string; amount: number; currency: string; plan_version: number }[]>`select status, amount, currency, plan_version from store_subscription where store_id = ${storeId}`
    const [price] = await db.sql<{ monthly_amount: number; version: number }[]>`
      select pp.monthly_amount, p.version from plan p join plan_price pp on pp.plan_id = p.id and pp.version = p.version and pp.currency = 'USD' where p.id = ${ids.nsPlan}`
    expect(sub).toEqual({ status: 'trial', amount: price?.monthly_amount, currency: 'USD', plan_version: price?.version })
    expect(await db.sql`select 1 from outbox where kind = 'email' and payload->>'template' = 'store-owner-invitation' and payload->>'storeId' = ${storeId}`).toHaveLength(1)
    expect(await db.sql`select 1 from activity_log where action = 'store.created' and store_id = ${storeId}`).toHaveLength(1)

    const progress = (await run<{ provisioning: { steps: { key: string; state: string }[]; done: boolean } }>(q.progress, callerOf(ids.ns), { id: storeId })).data?.provisioning
    expect(progress?.steps).toEqual([
      { key: 'account', state: 'done' },
      { key: 'store', state: 'done' },
      { key: 'portal', state: 'done' },
      { key: 'storefront', state: 'waiting' },
      { key: 'done', state: 'done' },
    ])
    expect(progress?.done).toBe(true)
    expect((await run<{ provisioning: unknown }>(q.progress, callerOf(ids.bz), { id: storeId })).data?.provisioning).toBeNull()
  })

  it('gives a second store of the same name its own code, and reuses the person an email already is', async () => {
    const [jenna] = await db.sql<{ id: string; email: string }[]>`select u.id, u.email from "user" u where u.partner_id = ${ids.ns} and u.email = 'jenna@harborcoffee.example'`
    const created = (await run<Created>(q.create, callerOf(ids.ns, 'partner-admin'), { i: input({ ownerEmail: jenna?.email, trialDays: 0 }) })).data?.createStore
    expect(created?.ok).toBe(true)
    const [store] = await db.sql<{ code: string; status: string }[]>`select code, status from store where id = ${created?.storeId ?? ''}`
    expect(store).toEqual({ code: 'cedar-pine-2', status: 'active' })
    const [member] = await db.sql<{ user_id: string }[]>`select user_id from membership where store_id = ${created?.storeId ?? ''}`
    expect(member?.user_id).toBe(jenna?.id)
  })

  it('refuses a role, a partner that isn’t Live, a plan of another partner and a country the plan isn’t priced in', async () => {
    expect((await run(q.create, callerOf(ids.ns, 'partner-support'), { i: input() })).code).toBe('FORBIDDEN')
    expect((await run<Created>(q.create, callerOf(ids.ns), { i: input({ planId: ids.bzPlan }) })).data?.createStore).toMatchObject({ ok: false, reason: 'INVALID_INPUT', field: 'planId' })
    expect((await run<Created>(q.create, callerOf(ids.ns), { i: input({ country: 'IN' }) })).data?.createStore).toMatchObject({ ok: false, reason: 'INVALID_INPUT', field: 'country' })
    expect((await run<Created>(q.create, callerOf(ids.ns), { i: input({ trialDays: 10 }) })).data?.createStore).toMatchObject({ ok: false, reason: 'INVALID_INPUT', field: 'trialDays' })
    await db.sql`insert into "user" (partner_id, email, name, status) values (${ids.ns}, 'gone@cedarpine.example', 'Gone', 'deleted')`
    expect((await run<Created>(q.create, callerOf(ids.ns), { i: input({ ownerEmail: 'GONE@cedarpine.example' }) })).data?.createStore).toMatchObject({ ok: false, reason: 'INVALID_INPUT', field: 'ownerEmail' })
    await db.sql`update partner set state = 'paused' where id = ${ids.ns}`
    expect((await run<Created>(q.create, callerOf(ids.ns), { i: input() })).data?.createStore.reason).toBe('PARTNER_PAUSED')
    expect((await run<Form>(q.form, callerOf(ids.ns))).data?.createStoreForm.permission.reason).toBe('PARTNER_PAUSED')
    await db.sql`update partner set state = 'draft' where id = ${ids.ns}`
    expect((await run<Created>(q.create, callerOf(ids.ns), { i: input() })).data?.createStore.reason).toBe('PARTNER_NOT_LIVE')
    await db.sql`update partner set state = 'live' where id = ${ids.ns}`
  })

  it('holds the database to the same rules: no price, owner or job a request makes up', async () => {
    const asNs = { caller: { kind: 'partner-user' as const, partnerUserId: crypto.randomUUID() }, partnerId: ids.ns }
    const [store] = await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.ns} and code = 'cedar-pine'`
    const storeId = store?.id ?? ''
    const [user] = await db.sql<{ id: string }[]>`select id from "user" where partner_id = ${ids.ns} limit 1`
    await expect(withScope(db.sql, asNs, (tx) => tx`insert into job (store_id, kind, state, steps, step) values (${storeId}, 'provision-store', 'done', '{done}', 'done')`)).rejects.toThrow(/row-level security/)
    await expect(withScope(db.sql, asNs, (tx) => tx`insert into membership (user_id, store_id, role_key, status) values (${user?.id ?? ''}, ${storeId}, 'manager', 'active')`)).rejects.toThrow(/row-level security/)
    // A second Owner, or one of another partner's people, is refused too.
    await expect(withScope(db.sql, asNs, (tx) => tx`insert into membership (user_id, store_id, role_key, status) values (${user?.id ?? ''}, ${storeId}, 'owner', 'invited')`)).rejects.toThrow(/row-level security/)
    const [bare] = await withScope(db.sql, asNs, (tx) => tx<{ id: string }[]>`insert into store (partner_id, name, code) values (${ids.ns}, 'No Owner', 'no-owner') returning id`)
    const [theirs] = await db.sql<{ id: string }[]>`select id from "user" where partner_id = ${ids.bz} limit 1`
    await expect(withScope(db.sql, asNs, (tx) => tx`insert into membership (user_id, store_id, role_key, status) values (${theirs?.id ?? ''}, ${bare?.id ?? ''}, 'owner', 'invited')`)).rejects.toThrow(/row-level security|another partner/)
    await expect(withScope(db.sql, asNs, (tx) => tx`insert into "user" (partner_id, email, name, status) values (${ids.ns}, 'x@y.example', 'X', 'active')`)).rejects.toThrow(/row-level security/)
    const [fresh] = await withScope(db.sql, asNs, (tx) => tx<{ id: string }[]>`insert into store (partner_id, name, code) values (${ids.ns}, 'Bare', 'bare') returning id`)
    await expect(
      withScope(db.sql, asNs, (tx) => tx`
        insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
        select ${fresh?.id ?? ''}, ${ids.ns}, p.id, p.version, 'active', 'month', 'USD', 1, ${now}, ${new Date(now.getTime() + 86_400_000)} from plan p where p.id = ${ids.nsPlan}`),
    ).rejects.toThrow(/row-level security/)
  })
})

describe('export', () => {
  it('exports the partner’s own accounts as CSV for any role, and only as a stores export', async () => {
    const asked = (await run<{ exportStores: { ok: boolean; jobId: string } }>(q.exportStores, callerOf(ids.ns, 'partner-read-only'), { f: { q: 'cedar-pine' } })).data?.exportStores
    expect(asked?.ok).toBe(true)
    expect((await run(q.exportStores, callerOf(ids.ns), { f: { status: 'nope' } })).code).toBe('INVALID_INPUT')
    expect((await run<{ storesExport: unknown }>(q.job, callerOf(ids.bz), { id: asked?.jobId })).data?.storesExport).toBeNull()
    await relayDue(db.sql, { 'export.stores': storesExportDeliverer(db.sql, () => now) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
    const job = (await run<{ storesExport: { state: string; rows: number; csv: string } }>(q.job, callerOf(ids.ns, 'partner-finance'), { id: asked?.jobId })).data?.storesExport
    expect(job).toMatchObject({ state: 'done', rows: 2 })
    const lines = job?.csv.split('\n') ?? []
    expect(lines[0]).toBe('store,code,owner,owner email,plan,status,storefront,domain,country,created')
    expect(lines.slice(1).every((l) => l.startsWith('Cedar & Pine,cedar-pine'))).toBe(true)
    expect(job?.csv).not.toMatch(/order|customer|product/i)
    expect((await run<{ storesExport: unknown }>(q.job, callerOf(ids.bz), { id: asked?.jobId })).data?.storesExport).toBeNull()
    expect((await run<{ activityExport: unknown }>(`query($id: ID!) { activityExport(id: $id) { id } }`, callerOf(ids.ns), { id: asked?.jobId })).data?.activityExport).toBeNull()
    const logged = await db.sql<{ changes: string }[]>`select changes::text from activity_log where action = 'stores.exported'`
    expect(logged).toHaveLength(1)
    expect(logged[0]?.changes).not.toContain('cedar-pine')
  })

  const exportAs = async (caller: PartnerCaller, f: Record<string, unknown> = {}) => {
    const jobId = (await run<{ exportStores: { jobId: string } }>(q.exportStores, caller, { f })).data?.exportStores.jobId
    await relayDue(db.sql, { 'export.stores': storesExportDeliverer(db.sql, () => now) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
    return (await run<{ storesExport: { state: string; rows: number; truncated: boolean; csv: string } }>(q.job, caller, { id: jobId })).data?.storesExport
  }

  it('leaves every other partner’s stores out of an unfiltered export', async () => {
    const job = await exportAs(callerOf(ids.ns))
    const [ours] = await db.sql<{ n: number }[]>`select count(*)::int as n from store where partner_id = ${ids.ns}`
    expect(job).toMatchObject({ state: 'done', rows: ours?.n, truncated: false })
    const theirs = await db.sql<{ code: string }[]>`select code from store where partner_id <> ${ids.ns}`
    expect(theirs.length).toBeGreaterThan(0)
    expect(theirs.filter((t) => job?.csv.includes(`,${t.code},`))).toEqual([])
  })

  it('says failed when its last attempt throws', async () => {
    const jobId = (await run<{ exportStores: { jobId: string } }>(q.exportStores, callerOf(ids.ns))).data?.exportStores.jobId ?? ''
    await db.sql`update export_job set filter = '{"status": "nope"}'::jsonb where id = ${jobId}`
    const [by] = await db.sql<{ requested_by_id: string }[]>`select requested_by_id from export_job where id = ${jobId}`
    const effect = { id: crypto.randomUUID(), kind: 'export.stores', idempotencyKey: jobId, payload: { jobId, partnerId: ids.ns, partnerUserId: by?.requested_by_id ?? '' }, partnerId: ids.ns, storeId: null, attempt: defaultRelayOptions.maxAttempts }
    await expect(storesExportDeliverer(db.sql, () => now).deliver(effect, new AbortController().signal)).rejects.toThrow()
    expect(await db.sql`select state, expires_at is not null as expires from export_job where id = ${jobId}`).toEqual([{ state: 'failed', expires: true }])
    expect((await run<{ storesExport: { state: string; csv: string | null } }>(q.job, callerOf(ids.ns), { id: jobId })).data?.storesExport).toMatchObject({ state: 'failed', csv: null })
  })

  it(`stops at ${storesExportMax} rows and says so on the last line`, async () => {
    await db.sql`insert into store (partner_id, name, code) select ${ids.ns}, 'Bulk ' || g, 'bulk-' || g from generate_series(1, ${storesExportMax + 1}) g`
    const job = await exportAs(callerOf(ids.ns))
    expect(job).toMatchObject({ state: 'done', rows: storesExportMax, truncated: true })
    const lines = job?.csv.split('\n') ?? []
    expect(lines).toHaveLength(storesExportMax + 2)
    expect(lines.at(-1)).toBe(`Only the first ${storesExportMax} stores are included; narrow the filter to see the rest.`)
  }, 120_000)

  it('says on the Stores page whether the caller may create', async () => {
    const page = `{ stores(first: 1) { createPermission { allowed reason } } }`
    expect((await run<{ stores: { createPermission: unknown } }>(page, callerOf(ids.ns))).data?.stores.createPermission).toEqual({ allowed: true, reason: null })
    expect((await run<{ stores: { createPermission: unknown } }>(page, callerOf(ids.ns, 'partner-finance'))).data?.stores.createPermission).toEqual({ allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' })
  })
})
