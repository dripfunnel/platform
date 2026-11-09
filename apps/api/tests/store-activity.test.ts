import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import type { ActivityEntry } from '#auth/activity'
import { hashSessionId } from '#auth/session'
import { resolveStoreStanding, storeHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { storeActivityFor, supportCookieName } from '#auth/storeSupport'
import { selectCatalogExport } from '#db/scoped/catalogExports'
import { withSystemScope } from '#db/scoped/index'
import { catalogExportDeliverer } from '#jobs/queues/deliverers/catalogExport'
import { activityLog } from '#saas/activity/index'
import { buildActivityExport } from '#saas/storeActivity/index'
import { exchangeSupportHandoff } from '#saas/storeSupport/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #331 (SAPI 21), part 2: the store's Activity log (LOGGING §6–7, FIRST-RELEASE §15): the whole
// store's entries to the Owner and Manager, the CSV to the Owner, nothing of another store, and
// never an address or a staff-only entry.

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-06T09:00:00Z')
const people = { owner: '', manager: '', staff: '', supplier: '', a2Owner: '', bOwner: '' }
const cookies: Record<keyof typeof people, string> = { owner: '', manager: '', staff: '', supplier: '', a2Owner: '', bOwner: '' }
type Who = keyof typeof people
const partnerOf = (who: Who) => (who === 'bOwner' ? t.partnerB : t.partnerA)
const storeOf = (who: Who) => (who === 'bOwner' ? t.storeB1 : who === 'a2Owner' ? t.storeA2 : t.storeA1)
const ip = '198.51.100.23'

const user = async (partnerId: string, email: string, name: string) =>
  (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`)[0]?.id ?? ''

const entry = (e: Partial<ActivityEntry> & Pick<ActivityEntry, 'action'>): ActivityEntry => ({
  occurredAt: new Date(now.getTime() - 60_000),
  category: 'write',
  result: 'success',
  actorKind: 'person',
  actorId: people.owner,
  actorLabel: 'Olivia Owner',
  partnerId: t.partnerA,
  storeId: t.storeA1,
  reason: null,
  api: 'store',
  requestId: 'r',
  ip,
  userAgent: 'Secret Browser',
  visibility: 'store',
  ...e,
})

const record = (entries: ActivityEntry[]) => withSystemScope(db.sql, (tx) => activityLog.recordAll(tx, entries))

type Caller = { person: Who } | { support: string }

const gql = async <T = Record<string, unknown>>(source: string, caller: Caller, variables: Record<string, unknown> = {}) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers: Record<string, string> = 'person' in caller ? { cookie: `${storeCookieName}=${cookies[caller.person]}`, [storeHeader]: storeOf(caller.person) } : { cookie: `${supportCookieName}=${caller.support}` }
  const partnerId = 'person' in caller ? partnerOf(caller.person) : t.partnerA
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: storeActivityFor(standing, activityLog), facts, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, variableValues: variables, contextValue })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined, raw: JSON.stringify(result.data ?? null) }
}

const q = {
  log: `query($f: StoreActivityFilter, $first: Int, $after: String) { activityLog(filter: $f, first: $first, after: $after) { items { id action result actor { kind id label } onBehalfOf { label } through { kind } target { type label } changes { field before after } reason } pageInfo { hasNextPage endCursor } } }`,
  export: `mutation($f: StoreActivityFilter) { exportActivity(filter: $f) }`,
  job: `query($id: ID!) { activityExport(id: $id) { state rows truncated csv } }`,
}
type Log = { activityLog: { items: { id: string; action: string; actor: { kind: string; label: string | null }; target: { label: string | null } | null }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }
const actions = async (who: Who, filter: Record<string, unknown> = {}) => ((await gql<Log>(q.log, { person: who }, { f: filter, first: 50 })).data?.activityLog.items ?? []).map((e) => e.action)

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  people.owner = await user(t.partnerA, 'owner@a.example', 'Olivia Owner')
  people.manager = await user(t.partnerA, 'manager@a.example', 'Mo Manager')
  people.staff = await user(t.partnerA, 'staff@a.example', 'Sam Staff')
  people.supplier = await user(t.partnerA, 'nadia@anand.example', 'Nadia Tran')
  people.a2Owner = await user(t.partnerA, 'owner@a2.example', 'Ada Owner')
  people.bOwner = await user(t.partnerB, 'owner@b.example', 'Bea Owner')
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values
    (${people.owner}, ${t.storeA1}, null, 'owner', 'active'), (${people.manager}, ${t.storeA1}, null, 'manager', 'active'),
    (${people.staff}, ${t.storeA1}, null, 'staff', 'active'), (${people.supplier}, ${t.storeA1}, ${t.sellerA1First}, 'supplier-admin', 'active'),
    (${people.a2Owner}, ${t.storeA2}, null, 'owner', 'active'), (${people.bOwner}, ${t.storeB1}, null, 'owner', 'active')`
  for (const who of Object.keys(people) as Who[]) cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: partnerOf(who) }, now))
  await record([
    entry({ action: 'product.updated', target: { type: 'product', id: 'p1', label: 'Organic Cotton Tee' }, changes: [{ field: 'price', before: '100', after: '120' }] }),
    entry({ action: 'stock.adjusted', actorId: people.supplier, actorLabel: 'Nadia Tran', sellerId: t.sellerA1First, target: { type: 'stock', id: 's1', label: 'Mara Linen Shirt' } }),
    entry({ action: 'customer.signed_in', category: 'auth', actorKind: 'customer', actorId: t.customerA1, actorLabel: 'Ananya Rao', customerId: t.customerA1 }),
    entry({ action: 'member.invited', target: { type: 'user', id: 'u9', label: 'Priya Shah' }, reason: 'manager' }),
    entry({ action: 'support_session.started', category: 'support', actorKind: 'partner_user', actorId: 'pu1', actorLabel: 'Ravi Kumar', access: { kind: 'support_session', id: crypto.randomUUID() }, visibility: 'partner', api: 'platform' }),
    entry({ action: 'store.crossing_refused', category: 'security', result: 'denied', visibility: 'staff' }),
    entry({ action: 'product.updated', storeId: t.storeA2, actorId: people.a2Owner, actorLabel: 'Ada Owner', target: { type: 'product', id: 'p2', label: 'A2 secret product' } }),
    entry({ action: 'product.updated', partnerId: t.partnerB, storeId: t.storeB1, actorId: people.bOwner, actorLabel: 'Bea Owner', target: { type: 'product', id: 'p3', label: 'B1 secret product' } }),
  ])
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('who reads the log', () => {
  it('gives the Owner and the Manager the whole store, the partner’s support entries included, never a staff-only one or an address', async () => {
    for (const who of ['owner', 'manager'] as const) {
      expect((await actions(who)).sort()).toEqual(['customer.signed_in', 'member.invited', 'product.updated', 'stock.adjusted', 'support_session.started'])
    }
    const { raw } = await gql(q.log, { person: 'owner' }, { f: {}, first: 50 })
    expect(raw).not.toContain(ip)
    expect(raw).not.toContain('Secret Browser')
    expect(raw).not.toContain('secret product')
  })

  it('refuses Staff and suppliers, who read only their own activity (LOGGING §6)', async () => {
    for (const who of ['staff', 'supplier'] as const) expect((await gql(q.log, { person: who })).code).toBe('FORBIDDEN')
  })

  it('keeps each store to its own entries, within one partner and across two', async () => {
    expect(await actions('a2Owner')).toEqual(['product.updated'])
    expect((await gql<Log>(q.log, { person: 'a2Owner' })).data?.activityLog.items[0]?.target?.label).toBe('A2 secret product')
    expect(await actions('bOwner')).toEqual(['product.updated'])
  })
})

describe('filters and pages', () => {
  it('filters by what, person, result and search; the search box reads labels', async () => {
    expect((await actions('owner', { what: 'catalogue' })).sort()).toEqual(['product.updated', 'stock.adjusted'])
    expect(await actions('owner', { what: 'team' })).toEqual(['member.invited'])
    expect(await actions('owner', { what: 'support' })).toEqual(['support_session.started'])
    expect(await actions('owner', { what: 'shoppers' })).toEqual(['customer.signed_in'])
    expect(await actions('owner', { what: 'signins' })).toEqual(['customer.signed_in'])
    expect(await actions('owner', { personKind: 'person', personId: people.supplier })).toEqual(['stock.adjusted'])
    expect(await actions('owner', { search: 'cotton' })).toEqual(['product.updated'])
    expect(await actions('owner', { search: '100%' })).toEqual([])
    expect((await gql(q.log, { person: 'owner' }, { f: { what: 'everything' } })).code).toBe('INVALID_INPUT')
    expect((await gql(q.log, { person: 'owner' }, { f: { personKind: 'person' } })).code).toBe('INVALID_INPUT')
  })

  it('pages newest first by cursor, at most 50 a page', async () => {
    const first = (await gql<Log>(q.log, { person: 'owner' }, { f: {}, first: 2 })).data?.activityLog
    expect(first?.items).toHaveLength(2)
    expect(first?.pageInfo.hasNextPage).toBe(true)
    const rest = (await gql<Log>(q.log, { person: 'owner' }, { f: {}, first: 50, after: first?.pageInfo.endCursor })).data?.activityLog
    expect(rest?.items.map((i) => i.id)).not.toEqual(expect.arrayContaining(first?.items.map((i) => i.id) ?? []))
    expect((first?.items.length ?? 0) + (rest?.items.length ?? 0)).toBe(5)
    expect((await gql<Log>(q.log, { person: 'owner' }, { f: {}, first: 500 })).data?.activityLog.items.length).toBe(5)
    expect((await gql(q.log, { person: 'owner' }, { f: {}, after: 'not-a-cursor' })).code).toBe('INVALID_INPUT')
  })
})

describe('the export', () => {
  it('is the Owner’s: a Manager, Staff and a supplier are refused', async () => {
    for (const who of ['manager', 'staff', 'supplier'] as const) expect((await gql(q.export, { person: who }, { f: {} })).code).toBe('FORBIDDEN')
  })

  it('refuses a range that ends before it starts, and neither queues nor logs it', async () => {
    const backwards = { from: '2026-05-02', to: '2026-05-01' }
    expect((await gql(q.log, { person: 'owner' }, { f: backwards })).code).toBe('INVALID_INPUT')
    const before = await db.sql<{ n: number }[]>`select count(*)::int as n from activity_log where action = 'activity.exported'`
    expect((await gql(q.export, { person: 'owner' }, { f: backwards })).code).toBe('INVALID_INPUT')
    const after = await db.sql<{ n: number }[]>`select count(*)::int as n from activity_log where action = 'activity.exported'`
    expect(after[0]?.n).toBe(before[0]?.n)
  })

  it('builds the filtered view in the Owner’s scope, logs the ask without the search text, and reads back only to its asker', async () => {
    const asked = await gql<{ exportActivity: string }>(q.export, { person: 'owner' }, { f: { search: 'Olivia' } })
    const id = asked.data?.exportActivity ?? ''
    expect(id).not.toBe('')
    const [logged] = await db.sql<{ changes: { after: string }[] }[]>`select changes from activity_log where action = 'activity.exported' and target_id = ${id}`
    expect(logged?.changes[0]?.after).toContain('searched')
    expect(logged?.changes[0]?.after).not.toContain('Olivia')

    const [row] = await db.sql<{ id: string; payload: unknown }[]>`select id, payload from outbox where idempotency_key like ${`%${id}%`}`
    await catalogExportDeliverer(db.sql, () => now).deliver({ id: row?.id ?? '', kind: 'export.catalog', idempotencyKey: id, payload: row?.payload, partnerId: t.partnerA, storeId: t.storeA1, attempt: 1 }, AbortSignal.timeout(10_000))
    const job = (await gql<{ activityExport: { state: string; rows: number; csv: string } }>(q.job, { person: 'owner' }, { id })).data?.activityExport
    expect(job?.state).toBe('done')
    expect(job?.rows).toBeGreaterThan(0)
    expect(job?.csv).toContain('Olivia Owner')
    expect(job?.csv).not.toContain(ip)
    expect(job?.csv).not.toContain('secret product')
    expect((await gql(q.job, { person: 'manager' }, { id })).code).toBe('FORBIDDEN')
    expect((await gql<{ activityExport: unknown }>(q.job, { person: 'a2Owner' }, { id })).data?.activityExport).toBeNull()
    expect((await gql<{ activityExport: unknown }>(q.job, { person: 'bOwner' }, { id })).data?.activityExport).toBeNull()
  })

  it('stops at the cap and says so on the last line', async () => {
    const id = (await gql<{ exportActivity: string }>(q.export, { person: 'owner' }, { f: {} })).data?.exportActivity ?? ''
    const built = await withSystemScope(db.sql, async (tx) => {
      const job = await selectCatalogExport(tx, t.storeA1, id)
      if (!job) throw new Error('no job')
      return buildActivityExport(tx, job, 2)
    })
    expect(built.rows).toBe(2)
    expect(built.truncated).toBe(true)
    expect(built.csv.split('\n').at(-1)).toContain('Cut at 2 entries')
  })
})

describe('a support session (ACCESS.md §8)', () => {
  it('reads the log as its seat may, and never takes it away, even allowed to make changes', async () => {
    const [agent] = await db.sql<{ id: string }[]>`insert into partner_user (partner_id, email, name, role_key, status) values (${t.partnerA}, 'ravi@partner-a.example', 'Ravi Kumar', 'partner-support', 'active') returning id`
    const [seat] = await db.sql<{ id: string }[]>`select id from membership where user_id = ${people.owner}`
    await db.sql`
      insert into support_session (partner_id, store_id, membership_id, partner_user_id, reason, started_at, expires_at, handoff_hash, handoff_expires_at, access, write_requested_at, write_decided_at)
      values (${t.partnerA}, ${t.storeA1}, ${seat?.id ?? ''}, ${agent?.id ?? ''}, 'Help', ${now}, ${new Date(now.getTime() + 30 * 60_000)}, ${await hashSessionId('tok-activity')}, ${new Date(now.getTime() + 5 * 60_000)}, 'write', ${now}, ${now})
    `
    const entered = await exchangeSupportHandoff({ sql: db.sql, partnerId: t.partnerA, activity: activityLog, facts: { requestId: 'r', ip: null, userAgent: null }, now: () => now }, 'tok-activity')
    const cookie = entered?.cookie ?? ''
    expect((await gql<Log>(q.log, { support: cookie }, { f: {} })).data?.activityLog.items.length).toBeGreaterThan(0)
    expect((await gql(q.export, { support: cookie }, { f: {} })).code).toBe('BLOCKED_FOR_SUPPORT')
  })
})
