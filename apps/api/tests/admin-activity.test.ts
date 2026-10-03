import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import type { ActivityEntry } from '#auth/activity'
import { factsOf } from '#auth/activity'
import { isAssigned } from '#auth/assignment'
import type { StaffMember, StaffRole } from '#auth/staff'
import { failDeadExports } from '#db/scoped/exportJobs'
import { pgArray, withScope, withSystemScope } from '#db/scoped/index'
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
// A Partner manager's assignment, a partner inside it and one outside, each with a shopper sharing one email.
const reach = { assigned: new Set<string>(), insidePartner: '', insideCustomer: '', outsidePartner: '', outsidePerson: '', outsidePersonName: '', outsideCustomer: '' }

const contextFor = (staff: StaffMember | null): AdminContext => ({
  staff,
  isAssigned: (staffId, target) => isAssigned(db.sql, staffId, target),
  staffActivity: staff ? createStaffActivityService({ sql: db.sql, staff, facts: factsOf(request), activity: activityLog, now: () => now }) : null,
  partners: null,
  stores: null,
  staffMembers: null,
  customers: null,
  staffSessions: null,
  provisioning: null,
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

  const pm = as('staff-partner-manager')
  reach.assigned = new Set((await db.sql<{ partner_id: string }[]>`select partner_id from staff_partner_assignment where staff_user_id = ${pm.id} and removed_at is null`).map((r) => r.partner_id))
  const [inside] = await db.sql<{ id: string; partner_id: string }[]>`select id, partner_id from store where partner_id = any(${pgArray([...reach.assigned])}::uuid[]) order by name limit 1`
  const [outside] = await db.sql<{ id: string; name: string; partner_id: string; store_id: string }[]>`
    select u.id, u.name, u.partner_id, s.id as store_id from "user" u join store s on s.partner_id = u.partner_id
    where u.status <> 'deleted' and not (u.partner_id = any(${pgArray([...reach.assigned])}::uuid[])) order by u.name limit 1`
  if (!inside || !outside) throw new Error('seed: the Partner manager needs a partner inside and one outside the assignment')
  const shopper = (storeId: string, name: string) =>
    db.sql<{ id: string }[]>`insert into customer (store_id, email, name, status) values (${storeId}, 'shopper.shared@example.com', ${name}, 'active') returning id`.then((r) => r[0]?.id ?? '')
  Object.assign(reach, {
    insidePartner: inside.partner_id,
    insideCustomer: await shopper(inside.id, 'Shopper Inside'),
    outsidePartner: outside.partner_id,
    outsidePerson: outside.id,
    outsidePersonName: outside.name,
    outsideCustomer: await shopper(outside.store_id, 'Shopper Outside'),
  })
  await record({ action: 'reach.inside', actorKind: 'customer', actorId: reach.insideCustomer, actorLabel: 'Shopper Inside', customerId: reach.insideCustomer, storeId: inside.id, partnerId: inside.partner_id, api: 'shop' })
  await record({ action: 'reach.outside', actorId: outside.id, actorLabel: outside.name, storeId: outside.store_id, partnerId: outside.partner_id })
  await record({ action: 'reach.outside_shopper', actorKind: 'customer', actorId: reach.outsideCustomer, actorLabel: 'Shopper Outside', customerId: reach.outsideCustomer, storeId: outside.store_id, partnerId: outside.partner_id, api: 'shop' })
  await record({ action: 'reach.outside_on_behalf', actorId: outside.id, actorLabel: outside.name, storeId: outside.store_id, partnerId: outside.partner_id, onBehalfOf: { kind: 'staff', id: ids.staff, label: 'Support' } })
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
    await db.sql`insert into customer (store_id, email, name, status) values (${ids.storeA}, 'nameless@example.com', null, 'active')`
    const nameless = await run<People>(people, as('staff-super-admin'), { q: 'nameless@example.com' })
    expect(nameless.code).toBeUndefined()
    expect(nameless.data?.activityPeople.filter((p) => p.kind === 'customer')).toEqual([expect.objectContaining({ name: '', email: '' })])
    const person = `query($p: String!) { activityPerson(person: $p) { name kind where memberships { where role } sameEmailAccounts } }`
    const rohan = (await run<{ activityPerson: { memberships: unknown[]; sameEmailAccounts: number } }>(person, as('staff-support'), { p: `person:${ids.person}` })).data?.activityPerson
    expect(rohan?.memberships.length).toBeGreaterThan(0)
    expect(rohan?.sameEmailAccounts).toBe(0)
  })
})

describe('a Partner manager’s reach', () => {
  const timeline = `query($p: String!) { personTimeline(person: $p, first: 50) { items { action partner { id } } } }`
  const person = `query($p: String!) { activityPerson(person: $p) { name sameEmailAccounts } }`
  type Timeline = { personTimeline: { items: { action: string; partner: { id: string } | null }[] } }
  type Person = { activityPerson: { name: string; sameEmailAccounts: number } | null }
  type Options = { activityLog: { items: { partner: { id: string } | null }[]; partners: { id: string }[]; stores: { partnerId: string }[] } }

  it('reads the log, its filters’ choices and an unassigned partner’s filter only within the assignment', async () => {
    const pm = as('staff-partner-manager')
    expect(await actions(pm, { action: 'reach.inside' })).toEqual(['reach.inside'])
    expect(await actions(pm, { action: 'reach.outside' })).toEqual([])
    expect(await actions(pm, { partner: reach.outsidePartner })).toEqual([])
    expect(await actions(as('staff-super-admin'), { action: 'reach.outside' })).toEqual(['reach.outside'])
    const page = (await run<Options>(`query { activityLog(first: 50) { items { partner { id } } partners { id } stores { partnerId } } }`, pm)).data?.activityLog
    expect(page?.items.length).toBeGreaterThan(0)
    for (const e of page?.items ?? []) expect(reach.assigned.has(e.partner?.id ?? '')).toBe(true)
    expect(page?.partners.length).toBeGreaterThan(0)
    expect(page?.partners.every((p) => reach.assigned.has(p.id))).toBe(true)
    expect(page?.stores.length).toBeGreaterThan(0)
    expect(page?.stores.every((s) => reach.assigned.has(s.partnerId))).toBe(true)
  })

  it('shows no timeline entry of an unassigned partner, including those done in a staff member’s name', async () => {
    const pm = as('staff-partner-manager')
    const items = async (staff: StaffMember, p: string) => (await run<Timeline>(timeline, staff, { p })).data?.personTimeline.items ?? []
    expect(await items(pm, `person:${reach.outsidePerson}`)).toEqual([])
    expect(await items(pm, `customer:${reach.outsideCustomer}`)).toEqual([])
    expect((await items(pm, `customer:${reach.insideCustomer}`)).map((e) => e.action)).toEqual(['reach.inside'])
    const staffSeen = await items(pm, `staff:${ids.staff}`)
    expect(staffSeen.every((e) => reach.assigned.has(e.partner?.id ?? ''))).toBe(true)
    expect((await items(as('staff-super-admin'), `staff:${ids.staff}`)).map((e) => e.action)).toContain('reach.outside_on_behalf')
  })

  it('finds and opens only people of assigned partners, and counts the shared email only there', async () => {
    const pm = as('staff-partner-manager')
    const people = `query($q: String!) { activityPeople(query: $q) { id name kind } }`
    type People = { activityPeople: { id: string; name: string; kind: string }[] }
    const shoppers = (await run<People>(people, pm, { q: 'Shopper' })).data?.activityPeople ?? []
    expect(shoppers.map((p) => p.id)).toContain(`customer:${reach.insideCustomer}`)
    expect(shoppers.map((p) => p.id)).not.toContain(`customer:${reach.outsideCustomer}`)
    expect((await run<People>(people, pm, { q: reach.outsidePersonName })).data?.activityPeople.map((p) => p.id)).not.toContain(`person:${reach.outsidePerson}`)
    const found = (await run<People>(people, pm, { q: 'example' })).data?.activityPeople ?? []
    expect(found.length).toBeGreaterThan(0)
    for (const p of found.filter((x) => x.kind !== 'staff')) {
      const id = p.id.split(':')[1] ?? ''
      const [row] = await db.sql<{ partner_id: string }[]>`
        select partner_id from "user" where id = ${id} union all select partner_id from partner_user where id = ${id}
        union all select st.partner_id from customer c join store st on st.id = c.store_id where c.id = ${id}`
      expect(reach.assigned.has(row?.partner_id ?? '')).toBe(true)
    }
    expect((await run<Person>(person, pm, { p: `person:${reach.outsidePerson}` })).data?.activityPerson).toBeNull()
    expect((await run<Person>(person, pm, { p: `customer:${reach.outsideCustomer}` })).data?.activityPerson).toBeNull()
    expect((await run<Person>(person, pm, { p: `customer:${reach.insideCustomer}` })).data?.activityPerson).toMatchObject({ name: 'Shopper Inside', sameEmailAccounts: 0 })
    expect((await run<Person>(person, as('staff-super-admin'), { p: `customer:${reach.insideCustomer}` })).data?.activityPerson?.sameEmailAccounts).toBe(1)
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
    expect((await run<{ activityExport: unknown }>(job, as('staff-support'), { id: asked?.jobId })).data?.activityExport).toBeNull()
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
    // Every entry staff can read, once each: nothing skipped or repeated where one chunk ends and the next begins.
    const visible = await withScope(db.sql, { caller: { kind: 'staff', staffId: as('staff-super-admin').id } }, async (tx) => (await tx<{ n: number }[]>`select count(*)::int as n from activity_log`)[0]?.n ?? -1)
    expect(done?.entries).toBeGreaterThan(50)
    expect(done?.entries).toBe(visible)
    expect(new Set(done?.csv.split('\n').slice(1)).size).toBe(done?.entries)
    // The deliveries chained: chunk 0 queued chunk 1, and so on, with none missing.
    const chunks = (await db.sql<{ chunk: number }[]>`
      select coalesce((payload->>'chunk')::int, 0) as chunk from outbox where kind = 'export.staff_activity' and payload->>'jobId' = ${asked?.jobId ?? ''} order by 1
    `).map((r) => r.chunk)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks).toEqual(chunks.map((_, i) => i))
  })

  it('ends as too large past the cap, rather than as a partial file', async () => {
    const asked = (await run<{ exportActivity: { jobId: string } }>(start, as('staff-super-admin'), { f: {} })).data?.exportActivity
    await relay({ cap: 2 })
    expect((await run<{ activityExport: { state: string; csv: string | null } }>(job, as('staff-super-admin'), { id: asked?.jobId })).data?.activityExport).toMatchObject({ state: 'tooLarge', csv: null })
  })
})

describe('an export that cannot finish', () => {
  const start = `mutation($f: ActivityFilter) { exportActivity(filter: $f) { ok jobId reason } }`
  const job = `query($id: ID!) { activityExport(id: $id) { state csv } }`
  type Job = { activityExport: { state: string; csv: string | null } | null }
  const relay = () => relayDue(db.sql, { 'export.staff_activity': staffActivityExportDeliverer(db.sql, () => now) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
  const ask = async (staff: StaffMember) => (await run<{ exportActivity: { jobId: string } }>(start, staff, { f: {} })).data?.exportActivity.jobId ?? ''
  const stateOf = async (id: string) => (await db.sql<{ state: string; csv: string | null }[]>`select state, csv from export_job where id = ${id}`)[0]

  it('fails, building nothing, when the requester is demoted or suspended before it runs', async () => {
    for (const change of ['role', 'status'] as const) {
      const [row] = await db.sql<{ id: string }[]>`
        insert into staff_user (sso_subject, email, name, role_key, status) values (${crypto.randomUUID()}, ${`exporter.${change}@dripfunnel.com`}, 'Exporter', 'staff-super-admin', 'active') returning id
      `
      const exporter: StaffMember = { id: row?.id ?? '', email: `exporter.${change}@dripfunnel.com`, name: 'Exporter', role: 'staff-super-admin' }
      const id = await ask(exporter)
      if (change === 'role') await db.sql`update staff_user set role_key = 'staff-read-only' where id = ${exporter.id}`
      else await db.sql`update staff_user set status = 'suspended' where id = ${exporter.id}`
      await relay()
      expect(await stateOf(id), change).toEqual({ state: 'failed', csv: null })
    }
  })

  it('fails when its last attempt throws, and when the relay gives up on it', async () => {
    const thrown = await ask(as('staff-super-admin'))
    // A filter the log refuses makes the delivery throw; this is its eighth and last attempt.
    await db.sql`update export_job set filter = '{"surprise": 1}'::jsonb where id = ${thrown}`
    await db.sql`update outbox set attempts = ${defaultRelayOptions.maxAttempts - 1} where kind = 'export.staff_activity' and payload->>'jobId' = ${thrown}`
    await relay()
    expect((await run<Job>(job, as('staff-super-admin'), { id: thrown })).data?.activityExport).toEqual({ state: 'failed', csv: null })

    const dead = await ask(as('staff-super-admin'))
    await db.sql`update outbox set failed_at = now() where kind = 'export.staff_activity' and payload->>'jobId' = ${dead}`
    expect(await withSystemScope(db.sql, (tx) => failDeadExports(tx, now, new Date(now.getTime() + 60 * 60_000)))).toBeGreaterThan(0)
    expect((await stateOf(dead))?.state).toBe('failed')
  })

  it('reads as expired, with no file, once its hour is up', async () => {
    const id = await ask(as('staff-super-admin'))
    await relay()
    expect((await run<Job>(job, as('staff-super-admin'), { id })).data?.activityExport?.state).toBe('ready')
    await db.sql`update export_job set expires_at = ${new Date(now.getTime() - 1000)} where id = ${id}`
    expect((await run<Job>(job, as('staff-super-admin'), { id })).data?.activityExport).toEqual({ state: 'expired', csv: null })
  })
})

describe('the schema', () => {
  it('lets nothing edit or delete an entry', () => {
    const mutations = Object.keys((adminSchema as GraphQLSchema).getMutationType()?.getFields() ?? {})
    expect(mutations.filter((m) => /activit|entr|log/i.test(m))).toEqual(['exportActivity'])
  })
})
