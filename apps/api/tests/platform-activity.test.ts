import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import { activityExportDeliverer } from '#jobs/queues/deliverers/activityExport'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createPartnerActivityService } from '#saas/partnerActivity/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #198: the partner Activity log, within LOGGING §6's partner scope.

let db: TestDatabase
const now = new Date('2026-10-03T09:00:00Z')
const ids = { ns: '', bz: '', nsStore: '', maya: '', owner: '' }
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }

const callerOf = (partnerId: string, role: PartnerRole, userId: string = crypto.randomUUID()): PartnerCaller => ({
  role,
  user: { id: userId, name: 'Maya Chen', email: 'maya@northstar.example' },
  staff: null,
  partner: { id: partnerId, name: 'Northstar Commerce', product: 'Northstar Shops', host: null, state: 'live' },
})

const run = async <T>(source: string, caller: PartnerCaller, variables: Record<string, unknown> = {}) => {
  const activity = createPartnerActivityService({ sql: db.sql, caller, facts, activity: activityLog, now: () => now })
  const contextValue = { caller, console: null, plans: null, branding: null, stores: null, storeActions: null, dashboard: null, domains: null, activity }
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const logQuery = `query($filter: PartnerActivityFilterInput, $after: String, $first: Int) { activityLog(filter: $filter, after: $after, first: $first) {
  items { id at action result through storeId storeName actor { kind id label } target { type id label } changes { field before after } reason }
  pageInfo { hasNextPage endCursor } } }`
type Entry = { id: string; action: string; result: string; through: string | null; storeId: string | null; storeName: string | null; actor: { kind: string; id: string | null; label: string } }
type Log = { activityLog: { items: Entry[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }

// Every entry the caller can reach for a filter, paging as the screen would.
const all = async (caller: PartnerCaller, filter: Record<string, unknown> = {}) => {
  const items: Entry[] = []
  let after: string | null = null
  for (;;) {
    const page: Log['activityLog'] | undefined = (await run<Log>(logQuery, caller, { filter, after, first: 50 })).data?.activityLog
    items.push(...(page?.items ?? []))
    if (!page?.pageInfo.hasNextPage) return items
    after = page.pageInfo.endCursor
  }
}

const entry = (e: { partnerId: string | null; storeId?: string | null; action: string; actorKind: string; actorId?: string; label?: string; access?: string | null; result?: string; visibility: string; at?: Date; reason?: string | null }) =>
  db.sql`
    insert into activity_log (occurred_at, category, action, result, actor_kind, actor_id, actor_label, access_kind, access_ref, partner_id, store_id,
      target_type, target_id, target_label, changes, reason, api, visibility)
    values (${e.at ?? new Date(now.getTime() - 60_000)}, 'write', ${e.action}, ${e.result ?? 'success'}, ${e.actorKind}, ${e.actorId ?? 'x'}, ${e.label ?? 'Someone'},
      ${e.access ?? null}, ${e.access ? 'session-1' : null}, ${e.partnerId}, ${e.storeId ?? null}, ${e.storeId ? 'store' : 'partner'}, ${e.storeId ?? e.partnerId}, 'Target', '[]'::jsonb, ${e.reason ?? null}, 'platform', ${e.visibility})`

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  ids.ns = (await db.sql<{ id: string }[]>`select id from partner where name = 'Northstar Commerce'`)[0]?.id ?? ''
  ids.bz = (await db.sql<{ id: string }[]>`select id from partner where name = 'Bazaar Cloud'`)[0]?.id ?? ''
  ids.nsStore = (await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.ns} order by name limit 1`)[0]?.id ?? ''
  ids.maya = (await db.sql<{ id: string }[]>`select id from partner_user where partner_id = ${ids.ns} and role_key = 'partner-owner' limit 1`)[0]?.id ?? ''
  ids.owner = (await db.sql<{ user_id: string }[]>`select m.user_id from membership m where m.store_id = ${ids.nsStore} and m.role_key = 'owner' and m.seller_id is null limit 1`)[0]?.user_id ?? ''
  // One entry of each kind the partner may see, on its store; and what it never may.
  await entry({ partnerId: ids.ns, storeId: ids.nsStore, action: 'store.trial_extended', actorKind: 'partner_user', actorId: ids.maya, label: 'Maya Chen', visibility: 'partner', reason: '=HYPERLINK("x")' })
  await entry({ partnerId: ids.ns, storeId: ids.nsStore, action: 'store.suspended', actorKind: 'staff', label: 'Neha (DripFunnel)', visibility: 'partner' })
  await entry({ partnerId: ids.ns, action: 'branding.published', actorKind: 'staff', label: 'Priya (DripFunnel)', access: 'setup_session', visibility: 'partner' })
  await entry({ partnerId: ids.ns, storeId: ids.nsStore, action: 'support.session_started', actorKind: 'partner_user', actorId: ids.maya, label: 'Maya Chen', access: 'support_session', visibility: 'partner' })
  await entry({ partnerId: ids.ns, storeId: ids.nsStore, action: 'store.activated', actorKind: 'job', label: 'Billing', visibility: 'partner', result: 'failed' })
  await entry({ partnerId: ids.ns, storeId: ids.nsStore, action: 'store.signed_in', actorKind: 'person', actorId: ids.owner, label: 'The Owner', visibility: 'partner' })
  for (const visibility of ['store', 'self', 'staff']) {
    await entry({ partnerId: ids.ns, storeId: ids.nsStore, action: 'product.updated', actorKind: 'person', actorId: ids.owner, label: 'The Owner', visibility })
    await entry({ partnerId: ids.ns, storeId: ids.nsStore, action: 'order.refunded', actorKind: 'customer', label: 'A shopper', visibility })
  }
  await entry({ partnerId: ids.bz, action: 'plan.updated', actorKind: 'partner_user', label: 'Bazaar user', visibility: 'partner' })
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('the log', () => {
  it('never returns an entry about a store’s inside, a shopper, staff-only work, or another partner', async () => {
    const owner = callerOf(ids.ns, 'partner-owner')
    const seen = await all(owner)
    expect(seen.length).toBeGreaterThan(5)
    expect(seen.some((e) => e.action === 'product.updated' || e.action === 'order.refunded')).toBe(false)
    expect(seen.some((e) => e.actor.kind === 'customer')).toBe(false)
    expect(seen.some((e) => e.action === 'plan.updated' && e.actor.label === 'Bazaar user')).toBe(false)
    // The store's Activity tab is the same query with the store: still nothing inside it.
    const tab = await all(owner, { storeId: ids.nsStore })
    expect(tab.length).toBeGreaterThan(0)
    expect(tab.every((e) => e.storeId === ids.nsStore && e.action !== 'product.updated' && e.action !== 'order.refunded')).toBe(true)
    // Each entry names its store, from the partner's own stores.
    const [store] = await db.sql<{ name: string }[]>`select name from store where id = ${ids.nsStore}`
    expect(tab.every((e) => e.storeName === store?.name)).toBe(true)
    // A row naming another partner's store (it can't happen by design; here it is forced) never
    // gets that store's name, because the names are read in this partner's own scope.
    const [theirs] = await db.sql<{ id: string; name: string }[]>`select id, name from store where partner_id = ${ids.bz} limit 1`
    await entry({ partnerId: ids.ns, storeId: theirs?.id ?? null, action: 'store.trial_extended', actorKind: 'partner_user', actorId: ids.maya, label: 'Maya Chen', visibility: 'partner' })
    const after = await all(owner)
    const forced = after.find((e) => e.storeId === theirs?.id)
    expect(forced?.storeName).toBeNull()
    expect(JSON.stringify(after)).not.toContain(theirs?.name ?? '~')
    await db.sql`delete from activity_log where store_id = ${theirs?.id ?? ''} and partner_id = ${ids.ns}`
    const [inside] = await db.sql<{ n: number }[]>`select count(*)::int as n from activity_log where store_id = ${ids.nsStore} and visibility <> 'partner'`
    expect(inside?.n).toBe(6)
  })

  it('filters by who, result, action and date', async () => {
    const owner = callerOf(ids.ns, 'partner-owner')
    const kinds = async (who: string) => (await all(owner, { who })).map((e) => [e.actor.kind, e.through])
    expect((await kinds('team')).every(([k, t]) => k === 'partner_user' && t === null)).toBe(true)
    expect((await kinds('staff')).every(([k, t]) => k === 'staff' && t === null)).toBe(true)
    expect(await kinds('setup')).toEqual([['staff', 'setup_session']])
    expect(await kinds('support')).toEqual([['partner_user', 'support_session']])
    expect((await kinds('events')).length).toBeGreaterThan(0)
    expect((await all(owner, { result: 'failed' })).every((e) => e.result === 'failed')).toBe(true)
    expect((await all(owner, { action: 'store.suspended' })).map((e) => e.actor.label)).toContain('Neha (DripFunnel)')
    expect((await all(owner, { date: 'today' })).length).toBeGreaterThan(0)
    expect((await run(logQuery, owner, { filter: { who: 'shoppers' } })).code).toBe('INVALID_INPUT')
  })
})

describe('people', () => {
  it('finds the team and merchants’ Owners, at most eight, never a shopper or staff', async () => {
    const owner = callerOf(ids.ns, 'partner-owner')
    const q = `query($q: String!) { activityPeople(query: $q) { ref kind name detail } }`
    const found = (await run<{ activityPeople: { ref: string; kind: string; name: string }[] }>(q, owner, { q: 'a' })).code
    expect(found).toBe('INVALID_INPUT')
    const people = (await run<{ activityPeople: { ref: string; kind: string; name: string }[] }>(q, owner, { q: 'an' })).data?.activityPeople ?? []
    expect(people.length).toBeLessThanOrEqual(8)
    expect(new Set(people.map((p) => p.ref)).size).toBe(people.length)
    // An Owner of two of the partner's stores is one person in the search.
    const [owner2] = await db.sql<{ name: string }[]>`select name from "user" where id = ${ids.owner}`
    const [second] = await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.ns} and id <> ${ids.nsStore} order by name limit 1`
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${ids.owner}, ${second?.id ?? ''}, 'owner', 'active') on conflict do nothing`
    const twice = (await run<{ activityPeople: { ref: string }[] }>(q, owner, { q: owner2?.name ?? 'zz' })).data?.activityPeople ?? []
    expect(twice.filter((p) => p.ref === `owner:${ids.owner}`)).toHaveLength(1)
    expect(people.every((p) => p.kind === 'team' || p.kind === 'owner')).toBe(true)
    const staff = (await run<{ activityPeople: unknown[] }>(q, owner, { q: 'Neha' })).data?.activityPeople
    expect(staff).toEqual([])
    const [bzUser] = await db.sql<{ name: string }[]>`select name from partner_user where partner_id = ${ids.bz} limit 1`
    expect((await run<{ activityPeople: { name: string }[] }>(q, owner, { q: bzUser?.name ?? 'zz' })).data?.activityPeople.some((p) => p.name === bzUser?.name)).toBe(false)
  })

  it('shows a person’s own timeline, and refuses a person outside the partner', async () => {
    const owner = callerOf(ids.ns, 'partner-owner')
    const timeline = `query($p: String!) { personTimeline(person: $p) { items { actor { kind id } action } } }`
    const team = (await run<{ personTimeline: { items: { actor: { kind: string; id: string } }[] } }>(timeline, owner, { p: `team:${ids.maya}` })).data?.personTimeline.items ?? []
    expect(team.length).toBeGreaterThan(0)
    expect(team.every((e) => e.actor.kind === 'partner_user' && e.actor.id === ids.maya)).toBe(true)
    const theirs = (await run<{ personTimeline: { items: { action: string }[] } }>(timeline, owner, { p: `owner:${ids.owner}` })).data?.personTimeline.items ?? []
    expect(theirs.map((e) => e.action)).toEqual(['store.signed_in'])
    const [bzUser] = await db.sql<{ id: string }[]>`select id from partner_user where partner_id = ${ids.bz} limit 1`
    expect((await run(timeline, owner, { p: `team:${bzUser?.id ?? ''}` })).code).toBe('INVALID_INPUT')
    expect((await run(timeline, owner, { p: 'nobody' })).code).toBe('INVALID_INPUT')
    expect((await run(timeline, owner, { p: `team:${'-'.repeat(36)}` })).code).toBe('INVALID_INPUT')
  })
})

describe('export', () => {
  const start = `mutation($f: PartnerActivityFilterInput) { exportActivity(filter: $f) { ok jobId reason } }`
  const job = `query($id: ID!) { activityExport(id: $id) { id state rows truncated csv expiresAt } }`

  it('is Owner and Admin only, survives leaving the page as a job, and holds only what the partner may see', async () => {
    // `activity.export` (ACCESS §5.3): Owner and Admin; the policy refuses everyone else.
    for (const role of ['partner-support', 'partner-finance', 'partner-read-only'] as const) expect((await run(start, callerOf(ids.ns, role))).code, role).toBe('FORBIDDEN')
    const asked = (await run<{ exportActivity: { ok: boolean; jobId: string } }>(start, callerOf(ids.ns, 'partner-admin', ids.maya), { f: { storeId: ids.nsStore } })).data?.exportActivity
    expect(asked?.ok).toBe(true)
    expect((await run<{ activityExport: { state: string } }>(job, callerOf(ids.ns, 'partner-owner'), { id: asked?.jobId })).data?.activityExport.state).toBe('queued')
    await relayDue(db.sql, { 'export.activity': activityExportDeliverer(db.sql, () => now) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
    const done = (await run<{ activityExport: { state: string; rows: number; csv: string } }>(job, callerOf(ids.ns, 'partner-owner'), { id: asked?.jobId })).data?.activityExport
    // Only Owners and Admins read an export back, as only they may make one (LOGGING §6).
    for (const role of ['partner-read-only', 'partner-support', 'partner-finance'] as const) {
      expect((await run(job, callerOf(ids.ns, role), { id: asked?.jobId })).code, role).toBe('FORBIDDEN')
    }
    expect(done?.state).toBe('done')
    const lines = done?.csv.split('\n') ?? []
    expect(lines[0]).toBe('When (UTC),Who,Who kind,Through,Action,Result,Store id,Target,Changes,Reason')
    expect(lines.length - 1).toBe(done?.rows)
    expect(done?.csv).not.toContain('product.updated')
    expect(done?.csv).not.toContain('A shopper')
    expect(done?.csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect((await db.sql`select 1 from activity_log where action = 'activity.exported' and partner_id = ${ids.ns}`).length).toBe(1)
    expect((await run<{ activityExport: unknown }>(job, callerOf(ids.bz, 'partner-owner'), { id: asked?.jobId })).data?.activityExport).toBeNull()
  })

  it('says failed after the last attempt, and is deleted once it expires', async () => {
    const asked = (await run<{ exportActivity: { jobId: string } }>(start, callerOf(ids.ns, 'partner-owner', ids.maya))).data?.exportActivity
    const deliverer = activityExportDeliverer(db.sql, () => now)
    const effect = (attempt: number) => ({ id: crypto.randomUUID(), kind: 'export.activity', idempotencyKey: 'k', payload: { jobId: asked?.jobId, partnerId: ids.ns, partnerUserId: 'not-a-uuid' }, partnerId: ids.ns, storeId: null, attempt })
    await expect(deliverer.deliver(effect(1), new AbortController().signal)).rejects.toThrow()
    expect(await db.sql`select state from export_job where id = ${asked?.jobId ?? ''}`).toEqual([{ state: 'queued' }])
    // A job that throws on its last attempt (here: a scope the job cannot read in) says failed.
    const failing = { ...effect(defaultRelayOptions.maxAttempts), payload: { jobId: asked?.jobId, partnerId: ids.ns, partnerUserId: ids.maya } }
    await db.sql`update export_job set filter = '{"from": "not a date"}'::jsonb where id = ${asked?.jobId ?? ''}`
    await expect(deliverer.deliver(failing, new AbortController().signal)).rejects.toThrow()
    expect(await db.sql`select state, expires_at is not null as expires from export_job where id = ${asked?.jobId ?? ''}`).toEqual([{ state: 'failed', expires: true }])
    await db.sql`update export_job set state = 'done', rows = 0, csv = '', finished_at = ${now}, expires_at = ${new Date(Date.now() - 1000)} where id = ${asked?.jobId ?? ''}`
    const { deleteExpiredExports } = await import('#db/scoped/exportJobs')
    const { withSystemScope } = await import('#db/scoped/index')
    expect(await withSystemScope(db.sql, (tx) => deleteExpiredExports(tx, new Date()))).toBeGreaterThan(0)
    expect(await db.sql`select 1 from export_job where id = ${asked?.jobId ?? ''}`).toEqual([])
  })

  it('says failed once the relay gives up, even when the last attempt timed out', async () => {
    const asked = (await run<{ exportActivity: { jobId: string } }>(start, callerOf(ids.ns, 'partner-owner', ids.maya))).data?.exportActivity
    // The relay's dead path: the outbox row is marked failed, the deliverer never saw an error.
    await db.sql`update outbox set failed_at = ${now} where kind = 'export.activity' and payload->>'jobId' = ${asked?.jobId ?? ''}`
    const { failDeadExports } = await import('#db/scoped/exportJobs')
    const { withSystemScope } = await import('#db/scoped/index')
    expect(await withSystemScope(db.sql, (tx) => failDeadExports(tx, now, new Date(now.getTime() + 3_600_000)))).toBe(1)
    expect((await run<{ activityExport: { state: string } }>(job, callerOf(ids.ns, 'partner-owner'), { id: asked?.jobId })).data?.activityExport.state).toBe('failed')
  })
})
