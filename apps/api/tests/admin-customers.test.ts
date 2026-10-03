import { graphql, isInterfaceType, isObjectType, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { factsOf } from '#auth/activity'
import { isAssigned } from '#auth/assignment'
import type { StaffMember, StaffRole } from '#auth/staff'
import { activityLog, listActivity } from '#saas/activity/index'
import { createCustomersService } from '#saas/customers/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #36: Customers on the Admin API. A mistake here is a privacy incident, so most of these
// prove what is NOT returned.

let db: TestDatabase
const now = new Date('2026-10-02T12:00:00Z')
const staffByRole = new Map<StaffRole, StaffMember>()
const request = new Request('https://admin.dripfunnel.com/api', { headers: { 'cf-ray': 'ray-test', 'cf-connecting-ip': '203.0.113.5', 'user-agent': 'test' } })
const ids = { priyaMehta: '', priyaKiko: '', usNumber: '', deleted: '', mehta: '', kiko: '', ns: '' }
const priya = { email: 'priya.sharma@gmail.com', phone: '+919876543210' }

const contextFor = (staff: StaffMember | null): AdminContext => ({
  staff,
  isAssigned: (staffId, target) => isAssigned(db.sql, staffId, target),
  activity: async (filter, page) => listActivity(db.sql, { caller: { kind: 'staff', staffId: staff?.id ?? '' } }, filter, page),
  partners: null,
  stores: null,
  customers: staff ? createCustomersService({ sql: db.sql, staff, facts: factsOf(request), activity: activityLog, now: () => now }) : null,
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

const list = `query($f: CustomerFilter, $s: String) { customers(filter: $f, search: $s, first: 25) {
  items { id name email phone phoneRegion store { id name } partner { id name } signsInWith status orders createdAt lastSignInAt }
  pageInfo { hasNextPage } match { kind accounts regions } partners { id } stores { id } } }`
const detail = `query($id: ID!) { customer(id: $id) { id name email phone phoneRegion status emailVerified phoneVerified contactsMasked storeSuspension { reason } store { name } } }`
type Row = { id: string; name: string | null; email: string | null; phone: string | null; phoneRegion: string | null; status: string }
type List = { customers: { items: Row[]; match: { kind: string; accounts: number; regions: string[] } | null; stores: { id: string }[] } }
type Detail = { customer: (Row & { contactsMasked: boolean; emailVerified: boolean }) | null }

const customer = async (storeId: string, fields: { email?: string; phone?: string; name: string; status?: string }) =>
  (
    await db.sql<{ id: string }[]>`
      insert into customer (store_id, email, phone, name, status, email_verified_at, created_at)
      values (${storeId}, ${fields.email ?? null}, ${fields.phone ?? null}, ${fields.name}, ${fields.status ?? 'active'}, ${now}, ${now}) returning id`
  )[0]?.id ?? ''

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  const rows = await db.sql<{ id: string; email: string; name: string; role_key: StaffRole }[]>`select id, email, name, role_key from staff_user order by created_at`
  for (const r of rows) if (!staffByRole.has(r.role_key)) staffByRole.set(r.role_key, { id: r.id, email: r.email, name: r.name, role: r.role_key })
  ids.mehta = (await db.sql<{ id: string }[]>`select id from store where name = 'Mehta Textiles'`)[0]?.id ?? ''
  ids.kiko = (await db.sql<{ id: string }[]>`select id from store where name = 'Kiko Kids'`)[0]?.id ?? ''
  const [harbor] = await db.sql<{ id: string; partner_id: string }[]>`select id, partner_id from store where name = 'Harbor Coffee Co.'`
  ids.ns = harbor?.partner_id ?? ''
  ids.priyaMehta = await customer(ids.mehta, { ...priya, name: 'Priya S.' })
  ids.priyaKiko = await customer(ids.kiko, { email: priya.email, name: 'Priya Sharma' })
  // The same national number in another country: a different person (decided on #42).
  ids.usNumber = await customer(harbor?.id ?? '', { phone: '+19876543210', name: 'Dana Wells' })
  ids.deleted = await customer(ids.mehta, { email: 'gone.person@example.com', name: 'Gone Person', status: 'deleted' })
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('the list', () => {
  it('masks email and phone for every role: the full value is never in a list response', async () => {
    for (const role of staffByRole.keys()) {
      const response = await run<List>(list, as(role), { s: 'priya' })
      expect(response.raw, role).not.toContain(priya.email)
      expect(response.raw, role).not.toContain('9876543210')
      const mine = response.data?.customers.items.find((r) => r.id === ids.priyaMehta)
      if (role !== 'staff-partner-manager') expect(mine, role).toMatchObject({ email: 'pr***@gmail.com', phone: '+91 ***** 43210', phoneRegion: '+91' })
    }
  })

  it('finds an exact email in every store it is used, counts them over every page, and still shows it masked', async () => {
    const found = await run<List>(list, as('staff-super-admin'), { s: 'Priya.Sharma@gmail.com' })
    expect(found.data?.customers.items.map((r) => r.id).sort()).toEqual([ids.priyaKiko, ids.priyaMehta].sort())
    expect(found.data?.customers.match).toEqual({ kind: 'email', accounts: 2, regions: [] })
    expect(found.raw).not.toContain(priya.email)
    expect((await run<List>(list, as('staff-super-admin'), { s: 'priya.sharma@gmail' })).data?.customers.items).toEqual([])
  })

  it('finds a phone by its digits with or without the calling code, never by a part of it, and names each number’s country', async () => {
    const withCode = await run<List>(list, as('staff-support'), { s: '+91 98765 43210' })
    expect(withCode.data?.customers.items.map((r) => r.id)).toEqual([ids.priyaMehta])
    const national = await run<List>(list, as('staff-support'), { s: '(987) 654-3210' })
    expect(national.data?.customers.items.map((r) => r.id).sort()).toEqual([ids.priyaMehta, ids.usNumber].sort())
    expect(national.data?.customers.match).toMatchObject({ kind: 'phone', accounts: 2 })
    expect([...(national.data?.customers.match?.regions ?? [])].sort()).toEqual(['+1', '+91'])
    expect(national.raw).not.toContain('9876543210')
    expect((await run<List>(list, as('staff-support'), { s: '98765432' })).data?.customers.items).toEqual([])
    expect((await run<List>(list, as('staff-support'), { s: '876543210' })).data?.customers.items).toEqual([])
  })

  it('filters by partner, store, status and sign-in method, and offers the partner’s stores once one is chosen', async () => {
    const sa = as('staff-super-admin')
    const byStore = await run<List>(list, sa, { f: { store: ids.kiko } })
    expect(byStore.data?.customers.items.map((r) => r.id)).toEqual([ids.priyaKiko])
    const deleted = (await run<List>(list, sa, { f: { status: 'deleted' } })).data?.customers.items ?? []
    expect(deleted.map((r) => r.id)).toEqual([ids.deleted])
    expect(deleted[0]).toMatchObject({ name: null, email: null, phone: null, phoneRegion: null })
    expect((await run<List>(list, sa, { f: { via: 'mobile' } })).data?.customers.items.map((r) => r.id)).toEqual([ids.usNumber])
    const ns = await run<List>(list, sa, { f: { partner: ids.ns } })
    expect(ns.data?.customers.items.map((r) => r.id)).toEqual([ids.usNumber])
    expect(ns.data?.customers.stores.length).toBeGreaterThan(0)
    expect((await run(list, sa, { f: { status: 'blocked' } })).code).toBe('INVALID_INPUT')
    expect((await run(list, sa, { s: '12' })).code).toBe('INVALID_INPUT')
  })

  it('shows a Partner manager its assigned partners’ customers only', async () => {
    const pm = as('staff-partner-manager')
    const seen = (await run<List>(list, pm)).data?.customers.items ?? []
    const assigned = new Set((await db.sql<{ partner_id: string }[]>`select partner_id from staff_partner_assignment where staff_user_id = ${pm.id} and removed_at is null`).map((r) => r.partner_id))
    const partnerOf = new Map((await db.sql<{ id: string; partner_id: string }[]>`select c.id, s.partner_id from customer c join store s on s.id = c.store_id`).map((r) => [r.id, r.partner_id]))
    expect(seen.every((r) => assigned.has(partnerOf.get(r.id) ?? ''))).toBe(true)
    const outside = [...partnerOf.entries()].find(([, p]) => !assigned.has(p))?.[0]
    if (outside) expect((await run<Detail>(detail, pm, { id: outside })).data?.customer).toBeNull()
    // Nor the store choices of a partner outside the assignment.
    const other = (await db.sql<{ id: string }[]>`select id from partner where not (id::text = any(string_to_array(${[...assigned].join(',')}, ','))) limit 1`)[0]?.id
    if (other) expect((await run<List>(list, pm, { f: { partner: other } })).data?.customers.stores).toEqual([])
  })
})

describe('the detail', () => {
  it('unmasks email and phone for Super admin and Support only, and logs every view naming staff, customer and store', async () => {
    for (const role of staffByRole.keys()) {
      const before = (await db.sql`select 1 from activity_log where action = 'customer.viewed' and target_id = ${ids.priyaMehta}`).length
      const got = (await run<Detail>(detail, as(role), { id: ids.priyaMehta })).data?.customer
      if (role === 'staff-partner-manager' && got === null) continue
      const full = role === 'staff-super-admin' || role === 'staff-support'
      expect(got, role).toMatchObject(full ? { email: priya.email, phone: priya.phone, contactsMasked: false } : { email: 'pr***@gmail.com', phone: '+91 ***** 43210', contactsMasked: true })
      const after = (await db.sql`select 1 from activity_log where action = 'customer.viewed' and target_id = ${ids.priyaMehta}`).length
      expect(after - before, role).toBe(1)
    }
    const [entry] = await db.sql<{ actor_kind: string; actor_label: string; target_label: string; store_id: string; visibility: string; customer_id: string | null }[]>`
      select actor_kind, actor_label, target_label, store_id, visibility, customer_id from activity_log where action = 'customer.viewed' order by occurred_at desc limit 1`
    expect(entry).toMatchObject({ actor_kind: 'staff', target_label: 'Priya S. at Mehta Textiles', store_id: ids.mehta, visibility: 'staff', customer_id: ids.priyaMehta })
  })

  it('shows a deleted account with no personal field, for any role', async () => {
    const got = (await run<Detail>(detail, as('staff-super-admin'), { id: ids.deleted })).data?.customer
    expect(got).toMatchObject({ name: null, email: null, phone: null, status: 'deleted', contactsMasked: false })
    expect((await run<Detail>(detail, as('staff-super-admin'), { id: crypto.randomUUID() })).data?.customer).toBeNull()
  })
})

describe('the schema', () => {
  it('carries no address, order contents, payment detail, password or link to another store, and no customer mutation', () => {
    const schema = adminSchema as GraphQLSchema
    // Every type a customer's data is carried in; the page and its match only wrap them.
    const types = Object.values(schema.getTypeMap()).filter((t) => (isObjectType(t) || isInterfaceType(t)) && /^Customer/.test(t.name) && !['CustomerPage', 'CustomerMatch'].includes(t.name))
    const fields = types.flatMap((t) => Object.keys((t as { getFields: () => Record<string, unknown> }).getFields()).map((f) => `${t.name}.${f}`))
    expect(fields.length).toBeGreaterThan(10)
    expect(fields.filter((f) => /address|password|payment|card|line|item|total|amount|linked|other|accounts?$|related|sameAs/i.test(f.split('.')[1] ?? ''))).toEqual([])
    const mutations = Object.keys(schema.getMutationType()?.getFields() ?? {})
    expect(mutations.filter((m) => /customer/i.test(m))).toEqual([])
  })
})
