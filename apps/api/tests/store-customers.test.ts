import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { selectCatalogExport } from '#db/scoped/catalogExports'
import { withScope, withSystemScope } from '#db/scoped/index'
import { buildCustomerExport, ensureGuestCustomer } from '#engine/modules/customers/index'
import { catalogExportDeliverer } from '#jobs/queues/deliverers/catalogExport'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #312 (SAPI 13), part 1: the store's customers, their groups, tags, notes and marketing consent, and the
// customers export (FIRST-RELEASE §7; DATA-MODEL §7.5): the merchant side's only, store by store (ACCESS §11).

let db: TestDatabase
let t: Tenants
type Who = 'owner' | 'manager' | 'staff' | 'supplier' | 'other'
const cookies = {} as Record<Who, string>

const facts = { requestId: 'r', ip: null, userAgent: null }
const gql = async (source: string, who: Who, as: { support?: 'read' } = {}) => {
  const headers: Record<string, string> = {
    cookie: `${storeCookieName}=${cookies[who]}`,
    [storeHeader]: who === 'other' ? t.storeA2 : t.storeA1,
    ...(who === 'supplier' ? { [supplierHeader]: t.sellerA1First } : {}),
  }
  const resolved = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  const standing = as.support && resolved.kind === 'acting'
    ? { ...resolved, caller: { ...resolved.caller, context: { ...resolved.caller.context, caller: { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: as.support } } } }
    : resolved
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, payments: null, secrets: null, now: () => new Date() }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

/** A placed order, paid unless it says otherwise, for a customer or a guest. */
const order = async (number: string, o: { storeId?: string; customerId?: string | null; email: string | null; phone?: string | null; city: string; total: number; refunded?: number; paid?: boolean; currency?: string; test?: boolean }) => {
  const storeId = o.storeId ?? t.storeA1
  const [row] = await db.sql<{ id: string }[]>`
    insert into "order" (store_id, customer_id, state, payment_state, currency, number, placed_at, subtotal_amount, shipping_amount, total_amount, refunded_amount, payment_method, email, phone, shipping_address)
    values (${storeId}, ${o.customerId ?? null}, 'placed', ${o.paid === false ? 'pending' : o.refunded ? 'partly_refunded' : 'paid'}, ${o.currency ?? 'INR'}, ${number}, now(), ${o.total}, 0, ${o.total}, ${o.refunded ?? 0},
      ${o.paid === false ? 'cod' : 'stripe'}, ${o.email}, ${o.phone ?? null},
      ${db.sql.json({ name: 'Priya Shah', line1: '1 Road', line2: null, city: o.city, region: 'MH', postalCode: '411001', country: 'IN', phone: null })})
    returning id`
  if (o.test) {
    await db.sql`insert into payment (order_id, store_id, provider, kind, state, amount, currency, mode) values (${row?.id ?? ''}, ${storeId}, 'stripe', 'card', 'captured', ${o.total}, 'INR', 'test')`
  }
  return row?.id ?? ''
}

const customerId = async (email: string, storeId = t.storeA1) => (await db.sql<{ id: string }[]>`select id from customer where store_id = ${storeId} and email = ${email}`)[0]?.id ?? ''
const entries = (action: string) => db.sql<{ target_id: string; customer_id: string | null; changes: unknown; reason: string | null }[]>`
  select target_id, customer_id, changes, reason from activity_log where action = ${action} order by occurred_at`

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update seller set access_level = 'vendor-orders-fulfil' where id = ${t.sellerA1First}`
  const person = async (email: string, role: string, seller: string | null = null, storeId = t.storeA1) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, ${email.split('@')[0] ?? ''}, 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${u?.id ?? ''}, ${storeId}, ${seller}, ${role}, 'active')`
    return withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
  }
  cookies.owner = await person('owner@a1.example', 'owner')
  cookies.manager = await person('manager@a1.example', 'manager')
  cookies.staff = await person('staff@a1.example', 'staff')
  cookies.supplier = await person('anand@a1.example', 'supplier-admin', t.sellerA1First)
  cookies.other = await person('owner@a2.example', 'owner', null, t.storeA2)

  // Priya has an account; Ravi bought as a guest twice, once by number only; Meera's test order makes no customer.
  await db.sql`update customer set name = 'Priya Shah', phone = '+919800000001', phone_verified_at = now(), tags = '{VIP}' where id = ${t.customerA1}`
  await order('A-1', { customerId: t.customerA1, email: 'priya@example.com', city: 'Pune', total: 5000, refunded: 1000 })
  await order('A-2', { customerId: t.customerA1, email: 'priya@example.com', city: 'Pune', total: 2000, currency: 'USD' })
  await order('A-3', { email: 'ravi@example.com', city: 'Delhi', total: 3000, paid: false })
  await order('A-4', { email: null, phone: '+919800000002', city: 'Mumbai', total: 1500 })
  await order('A-5', { email: 'meera@example.com', city: 'Goa', total: 900, test: true })
  await order('B-1', { storeId: t.storeA2, customerId: t.customerA2, email: 'priya@example.com', city: 'Chennai', total: 7000 })
  await withSystemScope(db.sql, async (tx) => {
    await ensureGuestCustomer(tx, { storeId: t.storeA1, email: 'ravi@example.com', phone: '+919800000003', name: 'Ravi Kumar', now: new Date() })
    await ensureGuestCustomer(tx, { storeId: t.storeA1, email: 'ravi@example.com', phone: null, name: 'Ravi K', now: new Date() })
    await ensureGuestCustomer(tx, { storeId: t.storeA1, email: null, phone: '+919800000002', name: 'Sunil Rao', now: new Date() })
    await ensureGuestCustomer(tx, { storeId: t.storeA1, email: 'priya@example.com', phone: null, name: 'Someone else', now: new Date() })
  })
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const list = async (who: Who, args = '') =>
  (await gql(`{ customers${args} { nodes { name email phone hasAccount tags city orders spent { amount currency } } } }`, who)).data?.['customers'] as { nodes: Record<string, unknown>[] } | null

describe('the customers list', () => {
  it('holds everyone who has bought or been added, newest first, with their orders and what they paid less refunds', async () => {
    const page = await list('staff')
    expect(page?.nodes).toEqual([
      { name: 'Sunil Rao', email: null, phone: '+919800000002', hasAccount: false, tags: [], city: 'Mumbai', orders: 1, spent: [{ amount: '1500', currency: 'INR' }] },
      // A guest's row keeps the email only, so a number typed at checkout links nothing until it is proven.
      { name: 'Ravi Kumar', email: 'ravi@example.com', phone: null, hasAccount: false, tags: [], city: 'Delhi', orders: 1, spent: [] },
      { name: 'Priya Shah', email: 'priya@example.com', phone: '+919800000001', hasAccount: true, tags: ['VIP'], city: 'Pune', orders: 2, spent: [{ amount: '4000', currency: 'INR' }, { amount: '2000', currency: 'USD' }] },
    ])
    expect((await gql('{ customerCount }', 'staff')).data?.['customerCount']).toBe(3)
    // A guest's order isn't linked to the account its email might later prove (ACCESS §2.1).
    expect((await db.sql`select 1 from "order" where customer_id is not null and number in ('A-3', 'A-4')`)).toHaveLength(0)
  })

  it('searches names, emails, numbers and tags, and pages', async () => {
    expect((await list('owner', '(search: "vip")'))?.nodes.map((n) => n.name)).toEqual(['Priya Shah'])
    expect((await list('owner', '(search: "9800000002")'))?.nodes.map((n) => n.name)).toEqual(['Sunil Rao'])
    expect((await list('owner', '(search: "%")'))?.nodes).toEqual([])
    const first = (await gql('{ customers(first: 2) { nodes { name } pageInfo { hasNextPage endCursor } } }', 'owner')).data?.['customers'] as { nodes: { name: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string } }
    expect([first.nodes.length, first.pageInfo.hasNextPage]).toEqual([2, true])
    const next = (await gql(`{ customers(first: 2, after: "${first.pageInfo.endCursor}") { nodes { name } } }`, 'owner')).data?.['customers'] as { nodes: { name: string }[] }
    expect(next.nodes.map((n) => n.name)).toEqual(['Priya Shah'])
  })

  it('opens a customer with contact, consent, groups and their newest orders', async () => {
    const found = (await gql(`{ customer(id: "${t.customerA1}") { name emailVerified phoneVerified hasAccount note consent { state source channels } groupIds addresses { city } ordersCount orders { number total { amount currency } } } }`, 'staff')).data?.['customer']
    expect(found).toEqual({
      name: 'Priya Shah', emailVerified: false, phoneVerified: true, hasAccount: true, note: null, consent: { state: 'not_asked', source: null, channels: [] }, groupIds: [], addresses: [], ordersCount: 2,
      orders: [{ number: 'A-2', total: { amount: '2000', currency: 'USD' } }, { number: 'A-1', total: { amount: '5000', currency: 'INR' } }],
    })
  })
})

describe('adding and changing a customer', () => {
  it('adds one with no email sent, opens the existing one for a known email, and refuses a number another has', async () => {
    const added = (await gql('mutation { addCustomer(name: " Alex Morgan ", email: "Alex@Example.com") { id existed } }', 'staff')).data?.['addCustomer'] as { id: string; existed: boolean }
    expect(added.existed).toBe(false)
    expect(await db.sql`select name, email, status, consent_source from customer where id = ${added.id}`).toEqual([{ name: 'Alex Morgan', email: 'alex@example.com', status: 'unverified', consent_source: 'added_by_hand' }])
    expect(await db.sql`select 1 from outbox where kind = 'email'`).toHaveLength(0)
    expect((await gql('mutation { addCustomer(name: "Priya", email: "priya@example.com") { id existed } }', 'staff')).data?.['addCustomer']).toEqual({ id: t.customerA1, existed: true })
    expect((await gql('mutation { addCustomer(name: "X", email: "x@example.com", phone: "+919800000001") { id } }', 'staff')).code).toBe('NUMBER_TAKEN')
    expect((await gql('mutation { addCustomer(name: "X", email: "not an email") { id } }', 'staff')).code).toBe('INVALID_INPUT')
    expect((await entries('customer.added')).map((e) => [e.target_id, e.customer_id])).toEqual([[added.id, added.id]])
  })

  it('changes the name, an unproven number and the default address, never a number the shopper proved', async () => {
    const id = await customerId('ravi@example.com')
    const edit = (args: string) => gql(`mutation { updateCustomer(id: "${id}"${args}) }`, 'manager')
    expect((await edit(', name: "Ravi Kumar", phone: "+91 98000 00009", address: { name: "Ravi", line1: "2 Lane", city: "Agra", country: "in" }')).data?.['updateCustomer']).toBe(true)
    expect((await edit(', address: { name: "Ravi", line1: "3 Lane", city: "Agra", country: "IN" }')).data?.['updateCustomer']).toBe(true)
    const after = (await gql(`{ customer(id: "${id}") { phone city addresses { line1 isDefault } } }`, 'staff')).data?.['customer']
    expect(after).toEqual({ phone: '+919800000009', city: 'Agra', addresses: [{ line1: '3 Lane', isDefault: true }] })
    expect((await gql(`mutation { updateCustomer(id: "${t.customerA1}", phone: "+919800000010") }`, 'manager')).code).toBe('VERIFIED')
    expect((await edit(', phone: "+919800000001"')).code).toBe('NUMBER_TAKEN')
    expect((await edit(', name: "  "')).code).toBe('INVALID_INPUT')
    // The fields that changed, never their values (LOGGING §4.1).
    expect((await entries('customer.edited'))[0]?.changes).toEqual(['phone', 'address'].map((field) => ({ field, before: null, after: 'changed', redacted: false })))
  })

  it('keeps tags, a team note and a recorded stop, logging none of their text', async () => {
    expect((await gql(`mutation { setCustomerTags(id: "${t.customerA1}", tags: ["VIP", " Repeat ", "vip"]) }`, 'staff')).data?.['setCustomerTags']).toEqual(['VIP', 'Repeat'])
    expect((await gql(`mutation { setCustomerTags(id: "${t.customerA1}", tags: ["${'x'.repeat(25)}"]) }`, 'staff')).code).toBe('INVALID_INPUT')
    expect((await gql(`mutation { setCustomerNote(id: "${t.customerA1}", note: "Prefers gift wrap") }`, 'staff')).data?.['setCustomerNote']).toBe(true)
    await db.sql`update customer set consent_state = 'opted_in', consent_source = 'checkout', consent_channels = '{email,sms}' where id = ${t.customerA1}`
    expect((await gql(`mutation { recordMarketingStop(id: "${t.customerA1}") }`, 'staff')).data?.['recordMarketingStop']).toBe(true)
    const found = (await gql(`{ customer(id: "${t.customerA1}") { tags note consent { state source channels } } }`, 'staff')).data?.['customer']
    expect(found).toEqual({ tags: ['VIP', 'Repeat'], note: 'Prefers gift wrap', consent: { state: 'stopped', source: 'recorded_by_store', channels: [] } })
    const logged = JSON.stringify(await db.sql`select changes, reason from activity_log where action like 'customer.%'`)
    expect(logged).not.toMatch(/gift wrap|Repeat/)
    expect((await entries('customer.consent_recorded'))[0]?.changes).toEqual([{ field: 'consent', before: 'opted_in', after: 'stopped', redacted: false }])
  })
})

describe('customer groups', () => {
  it('makes, renames and deletes groups, names unique whatever their case, and sets a customer’s groups', async () => {
    const make = async (name: string) => (await gql(`mutation { createGroup(name: "${name}") }`, 'staff'))
    const vip = (await make('Wholesale')).data?.['createGroup'] as string
    const press = (await make('Press')).data?.['createGroup'] as string
    expect((await make('wholesale')).code).toBe('NAME_TAKEN')
    expect((await gql(`mutation { setCustomerGroups(id: "${t.customerA1}", groupIds: ["${vip}", "${press}"]) }`, 'staff')).data?.['setCustomerGroups']).toHaveLength(2)
    expect((await list('staff', `(groupId: "${press}")`))?.nodes.map((n) => n.name)).toEqual(['Priya Shah'])
    expect((await gql(`mutation { updateGroup(id: "${vip}", name: "Trade", description: "Shops that resell") }`, 'staff')).data?.['updateGroup']).toBe(true)
    expect((await gql('{ customerGroups { name description members } }', 'staff')).data?.['customerGroups']).toEqual([
      { name: 'Press', description: null, members: 1 },
      { name: 'Trade', description: 'Shops that resell', members: 1 },
    ])
    expect((await gql(`mutation { deleteGroup(id: "${press}") }`, 'staff')).data?.['deleteGroup']).toBe(true)
    expect((await gql(`{ customer(id: "${t.customerA1}") { groupIds } }`, 'staff')).data?.['customer']).toEqual({ groupIds: [vip] })
    expect((await make('Press')).code).toBeUndefined()
  })
})

describe('across stores and callers (ACCESS §11)', () => {
  it('shows another store none of this store’s customers, groups or counts, and lets it change none of them', async () => {
    const theirs = await list('other')
    expect(theirs?.nodes.map((n) => [n.name, n.city, n.orders])).toEqual([[null, 'Chennai', 1]])
    expect((await gql('{ customerCount customerGroups { id } }', 'other')).data).toEqual({ customerCount: 1, customerGroups: [] })
    expect((await gql(`{ customer(id: "${t.customerA1}") { id } }`, 'other')).data?.['customer']).toBeNull()
    const group = (await gql('{ customerGroups { id } }', 'owner')).data?.['customerGroups'] as { id: string }[]
    for (const m of [
      `setCustomerNote(id: "${t.customerA1}", note: "x")`,
      `setCustomerTags(id: "${t.customerA1}", tags: ["x"])`,
      `recordMarketingStop(id: "${t.customerA1}")`,
      `updateCustomer(id: "${t.customerA1}", name: "x")`,
      `setCustomerGroups(id: "${t.customerA1}", groupIds: [])`,
      `updateGroup(id: "${group[0]?.id ?? ''}", name: "x")`,
      `deleteGroup(id: "${group[0]?.id ?? ''}")`,
    ]) {
      expect((await gql(`mutation { ${m} }`, 'other')).code, m).toBe('NOT_FOUND')
    }
    // Its own customer can't be put in this store's group either.
    expect((await gql(`mutation { setCustomerGroups(id: "${t.customerA2}", groupIds: ["${group[0]?.id ?? ''}"]) }`, 'other')).code).toBe('NOT_FOUND')
    expect(await db.sql`select 1 from customer_group_member where store_id = ${t.storeA2}`).toHaveLength(0)
  })

  it('refuses a supplier every customers query and mutation', async () => {
    for (const q of ['{ customers { nodes { id } } }', '{ customerCount }', `{ customer(id: "${t.customerA1}") { id } }`, '{ customerGroups { id } }', '{ customerExports { id } }']) {
      expect((await gql(q, 'supplier')).code, q).toBe('FORBIDDEN')
    }
    for (const m of ['addCustomer(name: "x", email: "x@example.com") { id }', `setCustomerNote(id: "${t.customerA1}", note: "x")`, 'createGroup(name: "x")', 'exportCustomers']) {
      expect((await gql(`mutation { ${m} }`, 'supplier')).code, m).toBe('FORBIDDEN')
    }
  })

  it('keeps the tables away from a supplier’s role and refuses a read-only support session every change', async () => {
    const supplier = { caller: { kind: 'person' as const, userId: crypto.randomUUID(), sessionId: '' }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'seller' as const, sellerId: t.sellerA1First }, subscription: 'active' as const }
    for (const table of ['customer', 'customer_group', 'customer_group_member']) {
      await expect(withScope(db.sql, supplier, (tx) => tx.unsafe(`select 1 from ${table} limit 1`)), table).rejects.toThrow(/permission denied/i)
    }
    expect((await gql(`mutation { setCustomerNote(id: "${t.customerA1}", note: "x") }`, 'owner', { support: 'read' })).code).toBe('READ_ONLY')
    expect((await gql('mutation { createGroup(name: "Support") }', 'owner', { support: 'read' })).code).toBe('READ_ONLY')
    expect((await gql('mutation { exportCustomers }', 'owner', { support: 'read' })).code).toBe('FORBIDDEN')
    expect((await gql('{ customers { nodes { id } } }', 'owner', { support: 'read' })).code).toBeUndefined()
  })
})

describe('the customers export', () => {
  const relay = () => relayDue(db.sql, { 'export.catalog': catalogExportDeliverer(db.sql) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })

  it('gives Staff a file of the list the filter chooses, a row a currency, and reads it back only for the asker', async () => {
    const asked = await gql('mutation { exportCustomers(search: "priya") }', 'staff')
    const id = asked.data?.['exportCustomers'] as string
    await relay()
    const file = (await gql(`{ customerExport(id: "${id}") { state rows csv } }`, 'staff')).data?.['customerExport'] as { state: string; rows: number; csv: string }
    expect([file.state, file.rows]).toEqual(['done', 1])
    expect(file.csv.split('\n')).toEqual([
      'name,email,phone,city,orders,spent,currency,tags,groups,marketing consent',
      // A number's + is kept as text, never run as a formula (core/csv).
      "Priya Shah,priya@example.com,'+919800000001,Pune,2,40.00,INR,VIP; Repeat,Trade,stopped",
      "Priya Shah,priya@example.com,'+919800000001,Pune,2,20.00,USD,VIP; Repeat,Trade,stopped",
    ])
    for (const who of ['owner', 'other'] as const) expect((await gql(`{ customerExport(id: "${id}") { id } }`, who)).data?.['customerExport'], who).toBeNull()
    expect((await gql(`{ orderExport(id: "${id}") { id } }`, 'staff')).data?.['orderExport']).toBeNull()
    expect((await entries('customer.exported'))[0]?.changes).toEqual([{ field: 'filter', before: null, after: '{"groupId":null,"search":"searched"}', redacted: false }])
  })

  it('gives another store’s export none of this store’s customers, and cuts a file at its cap', async () => {
    const id = (await gql('mutation { exportCustomers }', 'other')).data?.['exportCustomers'] as string
    await relay()
    const file = (await gql(`{ customerExport(id: "${id}") { csv } }`, 'other')).data?.['customerExport'] as { csv: string }
    expect(file.csv.split('\n')).toHaveLength(2)
    expect(file.csv).toContain('Chennai')
    const mine = (await gql('mutation { exportCustomers }', 'owner')).data?.['exportCustomers'] as string
    const merchant = { caller: { kind: 'person' as const, userId: crypto.randomUUID(), sessionId: '' }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' as const }, subscription: 'active' as const }
    const built = await withScope(db.sql, merchant, async (tx) => {
      const job = await selectCatalogExport(tx, t.storeA1, mine)
      if (!job) throw new Error('no job')
      return buildCustomerExport(tx, job, 2)
    })
    expect([built.rows, built.truncated, built.csv.split('\n').at(-1)]).toEqual([2, true, 'Cut at 2 customers: narrow the filter for the rest.'])
  })
})
