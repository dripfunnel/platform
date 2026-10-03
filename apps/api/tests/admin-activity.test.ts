import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import type { ActivityEntry } from '#auth/activity'
import { factsOf } from '#auth/activity'
import { isAssigned } from '#auth/assignment'
import type { StaffMember, StaffRole } from '#auth/staff'
import { withSystemScope } from '#db/scoped/index'
import { staffActivityExportDeliverer } from '#jobs/queues/deliverers/staffActivityExport'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createStaffActivityService } from '#saas/staffActivity/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #38: the Activity log on the Admin API, the person timeline, the people finder and the export.

let db: TestDatabase
const now = new Date('2026-10-02T12:00:00Z')
const staffByRole = new Map<StaffRole, StaffMember>()
const request = new Request('https://admin.dripfunnel.com/api', { headers: { 'cf-ray': 'ray-test', 'cf-connecting-ip': '203.0.113.5', 'user-agent': 'test' } })
const ids = { person: '', partner: '', storeA: '', storeB: '', imp: crypto.randomUUID(), su: crypto.randomUUID(), customer: '', staff: '' }

const contextFor = (staff: StaffMember | null): AdminContext => ({
  staff,
  isAssigned: (staffId, target) => isAssigned(db.sql, staffId, target),
  staffActivity: staff ? createStaffActivityService({ sql: db.sql, staff, facts: factsOf(request), activity: activityLog, now: () => now }) : null,
  partners: null,
  stores: null,
  dashboard: null,
})

const run = async <T = Record<string, unknown>>(source: string, staff: StaffMember | null, variables: Record<string, unknown> = {}) => {
  const result = await graphql({ schema: adminSchema as GraphQLSchema, source, variableValues: variables, contextValue: contextFor(staff) })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined, raw: JSON.stringify(result) }
}

const as = (role: StaffRole): StaffMember => {
  const s = staffByRole.get(role)
  if (!s) throw new Error(`no seeded staff with role ${role}`)
  return s
}

const fields = `id action level result actor { kind id label } onBehalfOf { id label } access { kind id } partner { id name } store { id name } target { type id label } changes { field before after redacted } reason requestId ip userAgent`
const log = `query($f: ActivityFilter, $after: String, $before: String, $first: Int) { activityLog(filter: $f, after: $after, before: $before, first: $first) {
  items { ${fields} } pageInfo { startCursor endCursor hasNextPage hasPreviousPage } export { allowed reason } partners { id } stores { id partnerId } } }`
type Entry = { id: string; action: string; level: string; ip: string | null; store: { id: string; name: string } | null; partner: { name: string } | null; changes: { field: string; before: string | null; after: string | null; redacted: boolean }[] }
type Log = { activityLog: { items: Entry[]; pageInfo: { startCursor: string; endCursor: string; hasNextPage: boolean; hasPreviousPage: boolean }; export: { allowed: boolean; reason: string | null } } }
const actions = async (staff: StaffMember, f: Record<string, unknown>) => ((await run<Log>(log, staff, { f, first: 50 })).data?.activityLog.items ?? []).map((e) => e.action)

const record = (e: Partial<ActivityEntry> & Pick<ActivityEntry, 'action'>) =>
  withSystemScope(db.sql, (tx) =>
    activityLog.record(tx, {
      category: 'write',
      result: 'success',
      actorKind: 'person',
      actorId: ids.person,
      actorLabel: 'Rohan Verma <rohan@mehtatextiles.example>',
      reason: null,
      visibility: 'store',
      requestId: 'req-test',
      ip: null,
      userAgent: null,
      occurredAt: now,
      ...e,
    }),
  )

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  const rows = await db.sql<{ id: string; email: string; name: string; role_key: StaffRole }[]>`select id, email, name, role_key from staff_user order by created_at`
  for (const r of rows) if (!staffByRole.has(r.role_key)) staffByRole.set(r.role_key, { id: r.id, email: r.email, name: r.name, role: r.role_key })
  const [rohan] = await db.sql<{ id: string; partner_id: string }[]>`select id, partner_id from "user" where email = 'rohan@mehtatextiles.example'`
  ids.person = rohan?.id ?? ''
  ids.partner = rohan?.partner_id ?? ''
  const stores = await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.partner} order by name limit 2`
  ids.storeA = stores[0]?.id ?? ''
  ids.storeB = stores[1]?.id ?? ''
  ids.customer = (await db.sql<{ id: string }[]>`insert into customer (store_id, email, name, status) values (${ids.storeA}, 'shopper.one@example.com', 'Shopper One', 'active') returning id`)[0]?.id ?? ''
  ids.staff = as('staff-support').id
  // One person in two stores of their partner, as themselves and through an impersonation; a
  // security entry with an address; a change carrying a secret the log must have redacted.
  await record({ action: 'product.created', partnerId: ids.partner, storeId: ids.storeA, target: { type: 'product', id: 'p1', label: 'Silk scarf' } })
  await record({ action: 'product.created', partnerId: ids.partner, storeId: ids.storeB, target: { type: 'product', id: 'p2', label: 'Cotton throw' } })
  await record({ action: 'order.refunded', partnerId: ids.partner, storeId: ids.storeA, onBehalfOf: { kind: 'staff', id: ids.staff, label: 'Support' }, access: { kind: 'impersonation', id: ids.imp } })
  await record({ action: 'staff.sign_in_failed', category: 'security', actorKind: 'anonymous', actorId: null, actorLabel: null, visibility: 'staff', ip: '198.51.100.7', userAgent: 'curl' })
  await record({ action: 'settings.changed', partnerId: ids.partner, storeId: ids.storeA, changes: [{ field: 'api_key', before: 'sk_live_oldsecret', after: 'sk_live_newsecret' }], api: 'store' })
  await record({ action: 'setup_session.started', actorKind: 'staff', actorId: ids.staff, actorLabel: 'Support', partnerId: ids.partner, access: { kind: 'setup_session', id: ids.su }, visibility: 'partner', api: 'admin' })
  await record({ action: 'customer.signed_in', actorKind: 'customer', actorId: ids.customer, actorLabel: 'Shopper One', customerId: ids.customer, storeId: ids.storeA, partnerId: ids.partner, api: 'shop', visibility: 'self' })
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('the log', () => {
  it('filters by every §9 chip: level, address, impersonation, setup session, store, customer, target and dates', async () => {
    const sa = as('staff-super-admin')
    expect(await actions(sa, { level: 'security', ip: '198.51.100.7' })).toEqual(['staff.sign_in_failed'])
    expect(await actions(sa, { imp: ids.imp })).toEqual(['order.refunded'])
    expect(await actions(sa, { su: ids.su })).toEqual(['setup_session.started'])
    expect(await actions(sa, { level: 'storefront', customer: ids.customer })).toEqual(['customer.signed_in'])
    expect(await actions(sa, { target: 'product:p2' })).toEqual(['product.created'])
    expect(await actions(sa, { store: ids.storeB, action: 'product.created' })).toEqual(['product.created'])
    expect(await actions(sa, { from: '2026-10-02', to: '2026-10-02', ip: '198.51.100.7' })).toEqual(['staff.sign_in_failed'])
    expect(await actions(sa, { from: '2026-10-03', ip: '198.51.100.7' })).toEqual([])
    expect((await run(log, sa, { f: { imp: ids.imp, su: ids.su } })).code).toBe('INVALID_INPUT')
    expect((await run(log, sa, { f: { ip: 'not-an-ip' } })).code).toBe('INVALID_INPUT')
  })

  it('names each entry’s partner and store, shows staff the address, and never a secret a change carried', async () => {
    const response = await run<Log>(log, as('staff-read-only'), { f: { action: 'settings.changed' }, first: 5 })
    const [entry] = response.data?.activityLog.items ?? []
    expect(entry?.store?.name).toBeTruthy()
    expect(entry?.partner?.name).toBeTruthy()
    expect(entry?.changes).toEqual([{ field: 'api_key', before: null, after: null, redacted: true }])
    expect(response.raw).not.toContain('sk_live_')
    expect((await run<Log>(log, as('staff-read-only'), { f: { ip: '198.51.100.7' } })).data?.activityLog.items[0]?.ip).toBe('198.51.100.7')
  })

  it('pages forward with after and back with before onto the same rows, and says who may export', async () => {
    const sa = as('staff-super-admin')
    const first = (await run<Log>(log, sa, { first: 3 })).data?.activityLog
    const second = (await run<Log>(log, sa, { first: 3, after: first?.pageInfo.endCursor })).data?.activityLog
    const back = (await run<Log>(log, sa, { first: 3, before: second?.pageInfo.startCursor })).data?.activityLog
    expect(back?.items.map((e) => e.id)).toEqual(first?.items.map((e) => e.id))
    expect(first?.export).toEqual({ allowed: true, reason: null })
    expect((await run<Log>(log, as('staff-support'), { first: 1 })).data?.activityLog.export).toEqual({ allowed: false, reason: 'EXPORTERS_ONLY' })
  })
})

describe('the person', () => {
  const timeline = `query($p: String!) { personTimeline(person: $p, first: 50) { items { action store { id } } } }`

  it('follows one person across every store they work in, and what was done in their name; nobody outside staff reaches it', async () => {
    const items = (await run<{ personTimeline: { items: { action: string; store: { id: string } | null }[] } }>(timeline, as('staff-support'), { p: `person:${ids.person}` })).data?.personTimeline.items ?? []
    expect(new Set(items.map((e) => e.store?.id))).toEqual(new Set([ids.storeA, ids.storeB]))
    const staffTimeline = (await run<{ personTimeline: { items: { action: string }[] } }>(timeline, as('staff-support'), { p: `staff:${ids.staff}` })).data?.personTimeline.items ?? []
    expect(staffTimeline.map((e) => e.action)).toEqual(expect.arrayContaining(['order.refunded', 'setup_session.started']))
    expect((await run(timeline, null, { p: `person:${ids.person}` })).code).toBe('UNAUTHENTICATED')
    expect((await run(timeline, as('staff-support'), { p: 'person:not-an-id' })).code).toBe('INVALID_INPUT')
  })

  it('finds at most eight people within reach, never a shopper’s address, and says how many accounts share an email', async () => {
    const people = `query($q: String!) { activityPeople(query: $q) { id name email kind where } }`
    type People = { activityPeople: { id: string; name: string; email: string; kind: string }[] }
    const many = (await run<People>(people, as('staff-super-admin'), { q: 'example' })).data?.activityPeople ?? []
    expect(many.length).toBeLessThanOrEqual(8)
    const shopper = (await run<People>(people, as('staff-super-admin'), { q: 'shopper.one@example.com' })).data?.activityPeople ?? []
    expect(shopper.find((p) => p.kind === 'customer')).toMatchObject({ name: 'Shopper One', email: '' })
    expect((await run<People>(people, as('staff-super-admin'), { q: 'Shopper On' })).data?.activityPeople.filter((p) => p.kind === 'customer')).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Shopper One' })]),
    )
    expect((await run<People>(people, as('staff-super-admin'), { q: 'shopper.one@exa' })).raw).not.toContain('shopper.one@example.com')
    expect((await run(people, as('staff-super-admin'), { q: 'x' })).code).toBe('INVALID_INPUT')
    const pm = as('staff-partner-manager')
    const assigned = new Set((await db.sql<{ partner_id: string }[]>`select partner_id from staff_partner_assignment where staff_user_id = ${pm.id} and removed_at is null`).map((r) => r.partner_id))
    const reach = (await run<People>(people, pm, { q: 'example' })).data?.activityPeople ?? []
    for (const p of reach.filter((x) => x.kind === 'person' || x.kind === 'partner_user')) {
      const [row] = await db.sql<{ partner_id: string }[]>`select partner_id from "user" where id = ${p.id.split(':')[1] ?? ''} union all select partner_id from partner_user where id = ${p.id.split(':')[1] ?? ''}`
      expect(assigned.has(row?.partner_id ?? '')).toBe(true)
    }
    const person = `query($p: String!) { activityPerson(person: $p) { name kind where memberships { where role } sameEmailAccounts } }`
    const rohan = (await run<{ activityPerson: { memberships: unknown[]; sameEmailAccounts: number } }>(person, as('staff-support'), { p: `person:${ids.person}` })).data?.activityPerson
    expect(rohan?.memberships.length).toBeGreaterThan(0)
    expect(rohan?.sameEmailAccounts).toBe(0)
  })
})

describe('the export', () => {
  const start = `mutation($f: ActivityFilter) { exportActivity(filter: $f) { ok jobId reason } }`
  const job = `query($id: ID!) { activityExport(id: $id) { state entries csv } }`
  const relay = (options: { cap?: number; budgetMs?: number } = {}) =>
    relayDue(db.sql, { 'export.staff_activity': staffActivityExportDeliverer(db.sql, () => now, options) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })

  it('runs as a job for Super admin and Engineer only, logs itself, and writes no address', async () => {
    expect((await run(start, as('staff-support'), { f: {} })).code).toBe('FORBIDDEN')
    const asked = (await run<{ exportActivity: { ok: boolean; jobId: string } }>(start, as('staff-engineer'), { f: { partner: ids.partner } })).data?.exportActivity
    expect(asked?.ok).toBe(true)
    expect((await run<{ activityExport: { state: string } }>(job, as('staff-engineer'), { id: asked?.jobId })).data?.activityExport.state).toBe('preparing')
    await relay()
    const done = (await run<{ activityExport: { state: string; entries: number; csv: string } }>(job, as('staff-engineer'), { id: asked?.jobId })).data?.activityExport
    expect(done?.state).toBe('ready')
    const lines = done?.csv.split('\n') ?? []
    expect(lines[0]).toBe('When (UTC),Actor,Actor kind,Action,Target,Partner,Store,Result,Reason,Request id,Changes')
    expect(lines).toHaveLength((done?.entries ?? 0) + 1)
    expect(done?.csv).not.toContain('198.51.100.7')
    expect(done?.csv).not.toContain('sk_live_')
    const [logged] = await db.sql<{ actor_id: string; changes: { after: string }[] }[]>`select actor_id, changes from activity_log where action = 'activity.exported' and actor_kind = 'staff'`
    expect(logged?.actor_id).toBe(as('staff-engineer').id)
    expect(logged?.changes[0]?.after).toContain(ids.partner)
  })

  it('builds a large file a chunk per delivery, keeping its place between them', async () => {
    const asked = (await run<{ exportActivity: { jobId: string } }>(start, as('staff-super-admin'), { f: {} })).data?.exportActivity
    // A budget of nothing: every delivery reads one page, saves, and queues the next.
    for (let i = 0; i < 20; i += 1) await relay({ budgetMs: -1 })
    const done = (await run<{ activityExport: { state: string; entries: number; csv: string } }>(job, as('staff-super-admin'), { id: asked?.jobId })).data?.activityExport
    expect(done?.state).toBe('ready')
    const total = (await db.sql<{ n: number }[]>`select count(*)::int as n from activity_log where occurred_at <= ${new Date()}`)[0]?.n ?? 0
    expect(done?.entries).toBeGreaterThan(50)
    expect(done?.entries).toBeLessThanOrEqual(total)
    expect(new Set(done?.csv.split('\n').slice(1)).size).toBe(done?.entries)
    expect(await db.sql`select 1 from outbox where kind = 'export.staff_activity' and payload->>'jobId' = ${asked?.jobId ?? ''}`).not.toHaveLength(1)
  })

  it('ends as too large past the cap, rather than as a partial file', async () => {
    const asked = (await run<{ exportActivity: { jobId: string } }>(start, as('staff-super-admin'), { f: {} })).data?.exportActivity
    await relay({ cap: 2 })
    expect((await run<{ activityExport: { state: string; csv: string | null } }>(job, as('staff-super-admin'), { id: asked?.jobId })).data?.activityExport).toMatchObject({ state: 'tooLarge', csv: null })
  })
})

describe('the schema', () => {
  it('lets nothing edit or delete an entry', () => {
    const mutations = Object.keys((adminSchema as GraphQLSchema).getMutationType()?.getFields() ?? {})
    expect(mutations.filter((m) => /activit|entr|log/i.test(m))).toEqual(['exportActivity'])
  })
})
