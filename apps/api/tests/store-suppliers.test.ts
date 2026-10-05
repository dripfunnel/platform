import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { handleStoreAuth, type StoreAuthDeps } from '#apis/store/auth'
import { storeSchema } from '#apis/store/schema'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { mintStoreInvitationToken } from '#auth/storeTokens'
import type { CallerContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #295 (SAPI 5, parts 2 and 3): Settings › Supplier, the Owner's, and Your team, a Supplier admin's. Inviting creates the company and its first
// Supplier admin; suspending hides or keeps selling; removing ends access and hides, keeping the mark.

let db: TestDatabase
let t: Tenants
let secrets: SecretBox
const now = new Date('2026-10-05T09:00:00Z')
const host = 'store.partner-a.example'
const password = 'correct horse battery'
type Who = 'owner' | 'manager' | 'bOwner'
const people: Record<Who, string> = { owner: '', manager: '', bOwner: '' }
const cookies: Record<Who, string> = { owner: '', manager: '', bOwner: '' }
const plans = { full: '', none: '', one: '' }

const user = async (partnerId: string, email: string, name: string) =>
  (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`)[0]?.id ?? ''

const subscribe = async (storeId: string, partnerId: string, planId: string) => {
  await db.sql`update store set plan_id = ${planId}, pricing_currency = 'INR' where id = ${storeId}`
  await db.sql`delete from store_subscription where store_id = ${storeId}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${storeId}, ${partnerId}, ${planId}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})`
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  secrets = await secretBox(btoa('k'.repeat(32)))
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'portal', ${host}, 'live', 'CNAME', 'x')`
  const plan = async (partnerId: string, name: string, suppliers: number | null) => {
    const [row] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${name}, 'live') returning id`
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${row?.id ?? ''}, ${partnerId}, 1, 'products', 100)`
    if (suppliers !== null) {
      await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled) values (${row?.id ?? ''}, ${partnerId}, 1, 'suppliers_enabled', true)`
      await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${row?.id ?? ''}, ${partnerId}, 1, 'suppliers', ${suppliers})`
    }
    return row?.id ?? ''
  }
  plans.full = await plan(t.partnerA, 'Business', 50)
  plans.none = await plan(t.partnerA, 'Growth', null)
  plans.one = await plan(t.partnerA, 'Business lite', 3)
  await subscribe(t.storeA1, t.partnerA, plans.full)
  await subscribe(t.storeB1, t.partnerB, await plan(t.partnerB, 'B Business', 50))
  people.owner = await user(t.partnerA, 'owner@a.example', 'Olivia')
  people.manager = await user(t.partnerA, 'manager@a.example', 'Mo')
  people.bOwner = await user(t.partnerB, 'owner@b.example', 'Bea')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.manager}, ${t.storeA1}, 'manager', 'active'), (${people.bOwner}, ${t.storeB1}, 'owner', 'active')`
  for (const who of Object.keys(cookies) as Who[]) {
    cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: who === 'bOwner' ? t.partnerB : t.partnerA }, now))
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

type Acting = { cookie: string; seller: string; storeId?: string; partnerId?: string }
const gql = async (source: string, who: Who | Acting, variables: Record<string, unknown> = {}) => {
  const b = who === 'bOwner'
  const partnerId = typeof who === 'object' && who.partnerId ? who.partnerId : b ? t.partnerB : t.partnerA
  const storeId = typeof who === 'object' && who.storeId ? who.storeId : b ? t.storeB1 : t.storeA1
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers: Record<string, string> =
    typeof who === 'string' ? { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeId } : { cookie: `${storeCookieName}=${who.cookie}`, [storeHeader]: storeId, [supplierHeader]: who.seller }
  const standing = await resolveStoreStanding(db.sql, new Request(`https://${host}/api/`, { headers }), partnerId, now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: activityLog, facts, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, errors: result.errors }
}

const invite = async (who: Who, input: Record<string, unknown>) => {
  const result = await gql('mutation I($input: InviteSupplierInput!) { inviteSupplier(input: $input) }', who, { input })
  return { id: result.data?.['inviteSupplier'] as string | undefined, code: result.code, errors: result.errors }
}
type SupplierOut = { id: string; name: string; accessLevel: string; shippingMode: string; labelAccount: string; status: string; users: number; products: number; hideProductsWhileSuspended: boolean | null }
const supplierOf = async (who: Who, id: string) =>
  (await gql('query S($id: ID!) { supplier(id: $id) { id name accessLevel shippingMode labelAccount status users products hideProductsWhileSuspended } }', who, { id })).data?.['supplier'] as SupplierOut | null

const authDeps = (): StoreAuthDeps => ({ sql: db.sql, activity: activityLog, partnerId: t.partnerA, host, secrets, now: () => now, allowAttempt: async () => true })
const accept = async (email: string) => {
  const [row] = await db.sql<{ id: string }[]>`select id from invitation where lower(email) = lower(${email}) and accepted_at is null and revoked_at is null order by created_at desc limit 1`
  const token = await withSystemScope(db.sql, (tx) => mintStoreInvitationToken(tx, row?.id ?? '', now))
  const response = await handleStoreAuth(
    new Request(`https://${host}/api/auth/accept-invitation`, { method: 'POST', headers: { origin: `https://${host}`, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' }, body: JSON.stringify({ token, name: 'Anand Rao', password }) }),
    authDeps(),
  )
  const body = (await response.json()) as Record<string, unknown>
  return { body, cookie: /__Host-portal_session=([^;]*)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? '' }
}

const product = async (who: Who | { cookie: string; seller: string }, name: string) =>
  ((await gql('mutation S($input: ProductInput!) { saveProduct(input: $input) { id } }', who, { input: { name, options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }] } })).data?.['saveProduct'] as { id: string } | undefined)?.id ?? ''
const visibility = async (id: string) => (await db.sql<{ visibility: string; hidden_by: string | null; seller_id: string | null }[]>`select visibility, hidden_by, seller_id from product where id = ${id}`)[0]

describe('inviting a supplier', () => {
  it('creates the company and its first user, a Supplier admin, with the email on its way', async () => {
    const made = await invite('owner', { name: 'Anand Weaves', email: 'anand@weaves.example', accessLevel: 'vendor-catalogue' })
    expect(made.code).toBeUndefined()
    expect(await supplierOf('owner', made.id ?? '')).toMatchObject({ name: 'Anand Weaves', accessLevel: 'vendor-catalogue', shippingMode: 'to-store', labelAccount: 'store', status: 'invited', users: 1, products: 0 })
    const [invitation] = await db.sql<{ role_key: string; seller_id: string }[]>`select role_key, seller_id from invitation where email = 'anand@weaves.example'`
    expect(invitation).toEqual({ role_key: 'supplier-admin', seller_id: made.id })
    expect(await db.sql`select 1 from outbox where kind = 'email' and payload->>'to' = 'anand@weaves.example'`).toHaveLength(1)
    expect(await db.sql`select 1 from activity_log where action = 'supplier.invited' and target_id = ${made.id ?? ''}`).toHaveLength(1)
  })

  it('makes the supplier active once its first user joins, who then works in it as its admin', async () => {
    const made = await invite('owner', { name: 'Bhatia Crafts', email: 'raj@bhatia.example', accessLevel: 'vendor-catalogue', shippingMode: 'to-shopper', labelAccount: 'own' })
    const joined = await accept('raj@bhatia.example')
    expect(joined.body).toMatchObject({ ok: true })
    expect(await supplierOf('owner', made.id ?? '')).toMatchObject({ status: 'active', shippingMode: 'to-shopper', labelAccount: 'own' })
    const supplier = { cookie: joined.cookie, seller: made.id ?? '' }
    expect(((await gql('{ me { acting { role tier } } }', supplier)).data?.['me'] as { acting: { role: string; tier: string } }).acting).toEqual({ role: 'supplier-admin', tier: 'vendor-catalogue' })
    expect(await product(supplier, 'Bhatia lamp')).not.toBe('')
  })

  it('refuses a name already used, whatever its case, someone on the merchant side, and what isn’t valid', async () => {
    await invite('owner', { name: 'Kesari Looms', email: 'one@kesari.example', accessLevel: 'vendor-stock' })
    expect((await invite('owner', { name: '  kesari LOOMS ', email: 'two@kesari.example', accessLevel: 'vendor-stock' })).code).toBe('DUPLICATE_SUPPLIER')
    expect((await invite('owner', { name: 'Mo Supply', email: 'MANAGER@a.example', accessLevel: 'vendor-stock' })).code).toBe('ALREADY_MEMBER')
    expect((await invite('owner', { name: 'Odd', email: 'odd@odd.example', accessLevel: 'vendor-everything' })).code).toBe('INVALID_INPUT')
    expect((await invite('owner', { name: 'Odd', email: 'odd@odd.example', accessLevel: 'vendor-stock', shippingMode: 'by-drone' })).code).toBe('INVALID_INPUT')
    expect((await invite('owner', { name: 'Odd', email: 'not an email', accessLevel: 'vendor-stock' })).code).toBe('INVALID_EMAIL')
    expect((await invite('owner', { name: ' ', email: 'odd@odd.example', accessLevel: 'vendor-stock' })).code).toBe('INVALID_INPUT')
  })

  it('needs the plan’s suppliers, and stops at its limit with nothing written', async () => {
    await subscribe(t.storeA1, t.partnerA, plans.none)
    try {
      expect((await invite('owner', { name: 'Off plan', email: 'off@plan.example', accessLevel: 'vendor-stock' })).errors?.[0]?.extensions).toMatchObject({ code: 'PLAN_LIMIT', key: 'suppliers_enabled', unlockedBy: { id: plans.full } })
    } finally {
      await subscribe(t.storeA1, t.partnerA, plans.full)
    }
    await subscribe(t.storeA1, t.partnerA, plans.one)
    try {
      const [{ n } = { n: 0 }] = await db.sql<{ n: number }[]>`select count(*)::int as n from seller where store_id = ${t.storeA1} and status <> 'removed'`
      expect(n).toBeGreaterThanOrEqual(3)
      const outbox = (await db.sql<{ n: number }[]>`select count(*)::int as n from outbox`)[0]?.n
      expect((await invite('owner', { name: 'One too many', email: 'many@plan.example', accessLevel: 'vendor-stock' })).errors?.[0]?.extensions).toMatchObject({ code: 'PLAN_LIMIT', key: 'suppliers', limit: 3 })
      expect(await db.sql`select 1 from seller where name = 'One too many'`).toHaveLength(0)
      expect((await db.sql<{ n: number }[]>`select count(*)::int as n from outbox`)[0]?.n).toBe(outbox)
    } finally {
      await subscribe(t.storeA1, t.partnerA, plans.full)
    }
  })

  it('is the Owner’s alone, and another store’s Owner sees none of it', async () => {
    expect((await invite('manager', { name: 'By Mo', email: 'mo@supply.example', accessLevel: 'vendor-stock' })).code).toBe('FORBIDDEN')
    expect((await gql('{ suppliers { nodes { id } } }', 'manager')).code).toBe('FORBIDDEN')
    const ours = ((await gql('{ suppliers(first: 50) { nodes { id } } }', 'owner')).data?.['suppliers'] as { nodes: { id: string }[] }).nodes
    expect(ours.length).toBeGreaterThan(0)
    expect(((await gql('{ suppliers(first: 50) { nodes { id } } }', 'bOwner')).data?.['suppliers'] as { nodes: { id: string }[] }).nodes.some((n) => ours.some((o) => o.id === n.id))).toBe(false)
    expect(await supplierOf('bOwner', ours[0]?.id ?? '')).toBeNull()
    expect((await gql('mutation R($id: ID!) { removeSupplier(id: $id) }', 'bOwner', { id: ours[0]?.id })).code).toBe('NOT_FOUND')
  })
})

describe('changing a supplier', () => {
  it('changes what it can do and how it ships, at once for its people', async () => {
    const made = await invite('owner', { name: 'Tier Co', email: 'tier@co.example', accessLevel: 'vendor-catalogue' })
    const supplier = { cookie: (await accept('tier@co.example')).cookie, seller: made.id ?? '' }
    expect(await product(supplier, 'Tier mug')).not.toBe('')
    expect((await gql('mutation A($id: ID!) { setSupplierAccess(id: $id, accessLevel: "vendor-stock") }', 'owner', { id: made.id })).data?.['setSupplierAccess']).toBe(true)
    // Stock only: no catalogue writes from the next request on (ACCESS §5.2).
    expect((await gql('mutation S($input: ProductInput!) { saveProduct(input: $input) { id } }', supplier, { input: { name: 'Blocked', options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }] } })).code).toBe('FORBIDDEN')
    expect((await gql('mutation A($id: ID!) { setSupplierAccess(id: $id, accessLevel: "vendor-anything") }', 'owner', { id: made.id })).code).toBe('INVALID_INPUT')
    expect((await gql('mutation M($id: ID!) { setSupplierShippingMode(id: $id, shippingMode: "to-shopper", labelAccount: "own") }', 'owner', { id: made.id })).data?.['setSupplierShippingMode']).toBe(true)
    expect(await supplierOf('owner', made.id ?? '')).toMatchObject({ accessLevel: 'vendor-stock', shippingMode: 'to-shopper', labelAccount: 'own' })
    expect((await gql('mutation M($id: ID!) { setSupplierShippingMode(id: $id, shippingMode: "to-moon") }', 'owner', { id: made.id })).code).toBe('INVALID_INPUT')
    const actions = (await db.sql<{ action: string }[]>`select action from activity_log where target_id = ${made.id ?? ''} order by occurred_at`).map((a) => a.action)
    expect(actions).toEqual(expect.arrayContaining(['supplier.access_changed', 'supplier.shipping_mode_changed']))
  })

  it('suspends with its products hidden, shuts its people out, and brings them back as they were on resume', async () => {
    const made = await invite('owner', { name: 'Pause Co', email: 'pause@co.example', accessLevel: 'vendor-catalogue' })
    const supplier = { cookie: (await accept('pause@co.example')).cookie, seller: made.id ?? '' }
    const shown = await product(supplier, 'Pause vase')
    const alreadyHidden = await product(supplier, 'Pause bowl')
    await db.sql`update product set visibility = 'hidden' where id = ${alreadyHidden}`
    expect((await gql('mutation S($id: ID!) { suspendSupplier(id: $id, hideProducts: true) }', 'owner', { id: made.id })).data?.['suspendSupplier']).toBe(1)
    expect(await visibility(shown)).toMatchObject({ visibility: 'hidden', hidden_by: 'seller_suspended' })
    expect(await supplierOf('owner', made.id ?? '')).toMatchObject({ status: 'suspended', hideProductsWhileSuspended: true })
    expect((await gql('{ me { acting { role } } }', supplier)).data?.['me']).toMatchObject({ acting: null })
    expect((await gql('mutation S($id: ID!) { suspendSupplier(id: $id, hideProducts: false) }', 'owner', { id: made.id })).code).toBe('ALREADY_SUSPENDED')
    expect((await gql('mutation R($id: ID!) { resumeSupplier(id: $id) }', 'owner', { id: made.id })).data?.['resumeSupplier']).toBe(1)
    expect(await visibility(shown)).toMatchObject({ visibility: 'visible', hidden_by: null })
    expect(await visibility(alreadyHidden)).toMatchObject({ visibility: 'hidden', hidden_by: null })
    expect((await gql('{ me { acting { role } } }', supplier)).data?.['me']).toMatchObject({ acting: { role: 'supplier-admin' } })
    expect((await gql('mutation R($id: ID!) { resumeSupplier(id: $id) }', 'owner', { id: made.id })).code).toBe('NOT_SUSPENDED')
  })

  it('suspends keeping its products on sale when the Owner chooses', async () => {
    const made = await invite('owner', { name: 'Keep Co', email: 'keep@co.example', accessLevel: 'vendor-catalogue' })
    const supplier = { cookie: (await accept('keep@co.example')).cookie, seller: made.id ?? '' }
    const id = await product(supplier, 'Keep jug')
    expect((await gql('mutation S($id: ID!) { suspendSupplier(id: $id, hideProducts: false) }', 'owner', { id: made.id })).data?.['suspendSupplier']).toBe(0)
    expect(await visibility(id)).toMatchObject({ visibility: 'visible', hidden_by: null })
  })

  it('removes: its people lose access, its invitations close, its products are hidden and kept as its own, and its name is free again', async () => {
    const made = await invite('owner', { name: 'Gone Co', email: 'gone@co.example', accessLevel: 'vendor-catalogue' })
    const supplier = { cookie: (await accept('gone@co.example')).cookie, seller: made.id ?? '' }
    const id = await product(supplier, 'Gone plate')
    await db.sql`insert into invitation (store_id, seller_id, email, role_key, expires_at, invited_by_label) values (${t.storeA1}, ${made.id ?? ''}, 'second@co.example', 'supplier-member', ${new Date(now.getTime() + 86_400_000)}, 'Raj')`
    expect((await gql('mutation R($id: ID!) { removeSupplier(id: $id) }', 'owner', { id: made.id })).data?.['removeSupplier']).toBe(1)
    expect(await visibility(id)).toEqual({ visibility: 'hidden', hidden_by: 'seller_removed', seller_id: made.id })
    expect((await gql('{ me { acting { role } } }', supplier)).data?.['me']).toMatchObject({ acting: null })
    expect(await db.sql`select 1 from invitation where seller_id = ${made.id ?? ''} and revoked_at is null and accepted_at is null`).toHaveLength(0)
    expect(await supplierOf('owner', made.id ?? '')).toBeNull()
    expect(await db.sql`select 1 from activity_log where action = 'supplier.removed' and target_id = ${made.id ?? ''} and reason = 'products hidden: 1'`).toHaveLength(1)
    // The merchant may show a removed supplier's product, which then no longer waits on that removal.
    expect((await gql('mutation U($ids: [ID!]!) { updateProducts(ids: $ids, patch: { visible: true }) }', 'owner', { ids: [id] })).data?.['updateProducts']).toBe(1)
    expect(await visibility(id)).toMatchObject({ visibility: 'visible', hidden_by: null, seller_id: made.id })
    expect((await invite('owner', { name: 'Gone Co', email: 'back@co.example', accessLevel: 'vendor-stock' })).code).toBeUndefined()
  })

  it('lets the merchant show a suspended or removed supplier’s product from its form, which a resume then leaves as the merchant set it', async () => {
    const made = await invite('owner', { name: 'Shown Co', email: 'shown@co.example', accessLevel: 'vendor-catalogue' })
    const id = made.id ?? ''
    const supplier = { cookie: (await accept('shown@co.example')).cookie, seller: id }
    const bowl = await product(supplier, 'Shown bowl')
    const plate = await product(supplier, 'Shown plate')
    const showFromForm = async (productId: string, name: string) => {
      const p = (await gql('query P($id: ID!) { product(id: $id) { revision versions { id } } }', 'owner', { id: productId })).data?.['product'] as { revision: number; versions: { id: string }[] }
      return gql('mutation S($id: ID, $revision: Int, $input: ProductInput!) { saveProduct(id: $id, revision: $revision, input: $input) { id } }', 'owner', {
        id: productId,
        revision: p.revision,
        input: { name, visible: true, options: [], versions: [{ id: p.versions[0]?.id, choices: [], prices: [{ currency: 'INR', amount: '100' }] }] },
      })
    }
    await gql('mutation S($id: ID!) { suspendSupplier(id: $id, hideProducts: true) }', 'owner', { id })
    expect(await visibility(bowl)).toMatchObject({ visibility: 'hidden', hidden_by: 'seller_suspended' })
    expect((await showFromForm(bowl, 'Shown bowl')).code).toBeUndefined()
    expect(await visibility(bowl)).toMatchObject({ visibility: 'visible', hidden_by: null })
    // The merchant hides it again; resuming brings back only what the suspension still holds.
    await gql('mutation U($ids: [ID!]!) { updateProducts(ids: $ids, patch: { visible: false }) }', 'owner', { ids: [bowl] })
    expect((await gql('mutation R($id: ID!) { resumeSupplier(id: $id) }', 'owner', { id })).data?.['resumeSupplier']).toBe(1)
    expect(await visibility(bowl)).toMatchObject({ visibility: 'hidden', hidden_by: null })
    expect(await visibility(plate)).toMatchObject({ visibility: 'visible', hidden_by: null })
    await gql('mutation R($id: ID!) { removeSupplier(id: $id) }', 'owner', { id })
    expect(await visibility(plate)).toMatchObject({ visibility: 'hidden', hidden_by: 'seller_removed' })
    expect((await showFromForm(plate, 'Shown plate')).code).toBeUndefined()
    expect(await visibility(plate)).toEqual({ visibility: 'visible', hidden_by: null, seller_id: id })
  })

  it('refuses every change from another store’s Owner and from the supplier’s own admin, leaving the row and its products as they were', async () => {
    const made = await invite('owner', { name: 'Guard Co', email: 'guard@co.example', accessLevel: 'vendor-catalogue' })
    const id = made.id ?? ''
    const supplier = { cookie: (await accept('guard@co.example')).cookie, seller: id }
    const shown = await product(supplier, 'Guard lamp')
    const rowOf = async () => (await db.sql`select access_level, shipping_mode, label_account, status, suspended_at, removed_at from seller where id = ${id}`)[0]
    const before = { seller: await rowOf(), product: await visibility(shown) }
    const changes = [
      'mutation C($id: ID!) { setSupplierAccess(id: $id, accessLevel: "vendor-orders-fulfil") }',
      'mutation C($id: ID!) { setSupplierShippingMode(id: $id, shippingMode: "to-shopper", labelAccount: "own") }',
      'mutation C($id: ID!) { suspendSupplier(id: $id, hideProducts: true) }',
      'mutation C($id: ID!) { resumeSupplier(id: $id) }',
      'mutation C($id: ID!) { removeSupplier(id: $id) }',
    ]
    for (const change of changes) {
      expect({ change, code: (await gql(change, 'bOwner', { id })).code }).toEqual({ change, code: 'NOT_FOUND' })
      // Its own Supplier admin can't raise its tier, nor change anything else the merchant decides (ACCESS §5.2).
      expect({ change, code: (await gql(change, supplier, { id })).code }).toEqual({ change, code: 'FORBIDDEN' })
    }
    expect((await gql('mutation I($input: InviteSupplierInput!) { inviteSupplier(input: $input) }', supplier, { input: { name: 'Sub Co', email: 'sub@co.example', accessLevel: 'vendor-stock' } })).code).toBe('FORBIDDEN')
    expect((await gql('{ suppliers { nodes { id } } }', supplier)).code).toBe('FORBIDDEN')
    expect({ seller: await rowOf(), product: await visibility(shown) }).toEqual(before)
  })

  it('refuses an invitation into a suspended supplier', async () => {
    const made = await invite('owner', { name: 'Frozen Co', email: 'frozen@co.example', accessLevel: 'vendor-stock' })
    await gql('mutation S($id: ID!) { suspendSupplier(id: $id, hideProducts: false) }', 'owner', { id: made.id })
    expect((await accept('frozen@co.example')).body).toEqual({ ok: false, code: 'INVITATION_INVALID' })
  })

  it('counts and pages its suppliers by status', async () => {
    const counts = (await gql('{ supplierCounts { all active suspended } }', 'owner')).data?.['supplierCounts'] as { all: number; active: number; suspended: number }
    expect(counts.all).toBe(counts.active + counts.suspended)
    const suspended = ((await gql('{ suppliers(filter: "suspended", first: 50) { nodes { status } } }', 'owner')).data?.['suppliers'] as { nodes: { status: string }[] }).nodes
    expect(suspended.length).toBe(counts.suspended)
    expect(suspended.every((s) => s.status === 'suspended')).toBe(true)
    const first = (await gql('{ suppliers(first: 1) { nodes { id } pageInfo { hasNextPage endCursor } } }', 'owner')).data?.['suppliers'] as { nodes: { id: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string } }
    expect(first.pageInfo.hasNextPage).toBe(true)
    const next = (await gql('query P($after: String) { suppliers(first: 1, after: $after) { nodes { id } } }', 'owner', { after: first.pageInfo.endCursor })).data?.['suppliers'] as { nodes: { id: string }[] }
    expect(next.nodes[0]?.id).not.toBe(first.nodes[0]?.id)
    expect((await gql('{ suppliers(filter: "everything") { nodes { id } } }', 'owner')).code).toBe('INVALID_INPUT')
  })
})

describe('a supplier’s own team', () => {
  type Member = { id: string; kind: string; email: string; role: string; you: boolean; lastAdmin: boolean }
  const team = async (who: Acting) =>
    ((await gql('{ mySupplierTeam(first: 50) { nodes { id kind email role you lastAdmin } } }', who)).data?.['mySupplierTeam'] as { nodes: Member[] } | undefined)?.nodes ?? []
  const join = async (email: string, seller: string) => ({ cookie: (await accept(email)).cookie, seller })
  const inviteUser = (who: { cookie: string; seller: string }, email: string, role: string) => gql('mutation I($email: String!, $role: String!) { inviteSupplierUser(email: $email, role: $role) }', who, { email, role })
  const memberId = async (who: { cookie: string; seller: string }, email: string) => (await team(who)).find((m) => m.email === email && m.kind === 'member')?.id ?? ''
  let admin: { cookie: string; seller: string }
  let other: { cookie: string; seller: string }

  beforeAll(async () => {
    // The Owner's earlier invitations fall outside its hourly limit.
    await db.sql`update invitation set created_at = created_at - interval '2 hours'`
  })

  it('lists its people, invites a member who then works in it, and refuses what it can’t do', async () => {
    const made = await invite('owner', { name: 'Crew Co', email: 'lead@crew.example', accessLevel: 'vendor-catalogue' })
    admin = await join('lead@crew.example', made.id ?? '')
    expect(await team(admin)).toEqual([expect.objectContaining({ kind: 'member', email: 'lead@crew.example', role: 'supplier-admin', you: true, lastAdmin: true })])
    const sent = await inviteUser(admin, 'hand@crew.example', 'supplier-member')
    expect(sent.code).toBeUndefined()
    expect(await db.sql`select 1 from outbox where kind = 'email' and payload->>'to' = 'hand@crew.example'`).toHaveLength(1)
    const [entry] = await db.sql<{ seller_id: string; reason: string }[]>`select seller_id, reason from activity_log where action = 'supplier_team.invited' and target_label = 'hand@crew.example'`
    expect(entry).toEqual({ seller_id: made.id, reason: 'supplier-member' })
    const hand = await join('hand@crew.example', made.id ?? '')
    expect((await team(admin)).map((m) => [m.email, m.role])).toEqual(expect.arrayContaining([['hand@crew.example', 'supplier-member'], ['lead@crew.example', 'supplier-admin']]))
    // A member works on products and stock; the team is the admin's.
    expect((await gql('{ mySupplierTeam { nodes { id } } }', hand)).code).toBe('FORBIDDEN')
    expect((await gql('{ mySupplierTeam { nodes { id } } }', 'owner')).code).toBe('FORBIDDEN')
    expect((await inviteUser(admin, 'boss@crew.example', 'owner')).code).toBe('INVALID_INPUT')
    expect((await inviteUser(admin, 'not an email', 'supplier-member')).code).toBe('INVALID_EMAIL')
    expect((await inviteUser(admin, 'HAND@crew.example', 'supplier-member')).code).toBe('ALREADY_MEMBER')
    // Never both the merchant's staff and a supplier in one store (DATA-MODEL §3.3), and a supplier can't tell:
    // the merchant's manager is answered as a stranger is, with no seat held and no email sent.
    const stranger = await inviteUser(admin, 'stranger@elsewhere.example', 'supplier-member')
    const manager = await inviteUser(admin, 'manager@a.example', 'supplier-member')
    expect({ code: manager.code, errors: manager.errors, answered: typeof manager.data?.['inviteSupplierUser'] }).toEqual({ code: stranger.code, errors: stranger.errors, answered: typeof stranger.data?.['inviteSupplierUser'] })
    expect(await db.sql`select 1 from membership where user_id = ${people.manager} and seller_id is not null`).toHaveLength(0)
    expect(await db.sql`select 1 from outbox where kind = 'email' and payload->>'to' = 'manager@a.example'`).toHaveLength(0)
    expect((await team(admin)).filter((m) => m.kind === 'invitation').map((m) => m.email).sort()).toEqual(['manager@a.example', 'stranger@elsewhere.example'])
  })

  it('always keeps one admin', async () => {
    const lead = await memberId(admin, 'lead@crew.example')
    const hand = await memberId(admin, 'hand@crew.example')
    const role = (id: string, r: string) => gql('mutation C($id: ID!, $r: String!) { changeSupplierRole(membershipId: $id, role: $r) }', admin, { id, r })
    const remove = (id: string) => gql('mutation R($id: ID!) { removeSupplierUser(membershipId: $id) }', admin, { id })
    expect((await role(lead, 'supplier-member')).code).toBe('LAST_ADMIN')
    expect((await remove(lead)).code).toBe('LAST_ADMIN')
    expect((await role(hand, 'supplier-admin')).data?.['changeSupplierRole']).toBe(true)
    expect((await team(admin)).every((m) => !m.lastAdmin)).toBe(true)
    expect((await role(hand, 'supplier-member')).data?.['changeSupplierRole']).toBe(true)
    expect((await role(hand, 'supplier-owner')).code).toBe('INVALID_INPUT')
    expect((await remove(hand)).data?.['removeSupplierUser']).toBe(true)
    expect((await team(admin)).filter((m) => m.kind === 'member').map((m) => m.email)).toEqual(['lead@crew.example'])
    expect(await db.sql`select 1 from activity_log where action = 'supplier_team.role_changed' and target_id = ${hand}`).toHaveLength(2)
  })

  it('resends with a new link that replaces the old, and cancels', async () => {
    const first = (await inviteUser(admin, 'late@crew.example', 'supplier-admin')).data?.['inviteSupplierUser'] as string
    const again = (await gql('mutation R($id: ID!) { resendSupplierInvitation(invitationId: $id) }', admin, { id: first })).data?.['resendSupplierInvitation'] as string
    expect(again).not.toBe(first)
    expect((await db.sql<{ revoked: boolean }[]>`select revoked_at is not null as revoked from invitation where id = ${first}`)[0]?.revoked).toBe(true)
    expect((await gql('mutation R($id: ID!) { revokeSupplierInvitation(invitationId: $id) }', admin, { id: again })).data?.['revokeSupplierInvitation']).toBe(true)
    expect((await team(admin)).some((m) => m.email === 'late@crew.example')).toBe(false)
  })

  it('pages its team and holds a Supplier admin to People’s invitation limits', async () => {
    for (const n of [1, 2, 3]) await inviteUser(admin, `page${n}@crew.example`, 'supplier-member')
    const first = (await gql('{ mySupplierTeam(first: 2) { nodes { id } pageInfo { hasNextPage endCursor } } }', admin)).data?.['mySupplierTeam'] as { nodes: { id: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string } }
    expect(first.nodes).toHaveLength(2)
    expect(first.pageInfo.hasNextPage).toBe(true)
    const next = (await gql('query P($after: String) { mySupplierTeam(first: 2, after: $after) { nodes { id } } }', admin, { after: first.pageInfo.endCursor })).data?.['mySupplierTeam'] as { nodes: { id: string }[] }
    expect(next.nodes.some((n) => first.nodes.some((f) => f.id === n.id))).toBe(false)
    // Three a day to one address, a resend included (ACCESS §6.2).
    const sent = (await inviteUser(admin, 'often@crew.example', 'supplier-member')).data?.['inviteSupplierUser'] as string
    const again = (await gql('mutation R($id: ID!) { resendSupplierInvitation(invitationId: $id) }', admin, { id: sent })).data?.['resendSupplierInvitation'] as string
    await gql('mutation R($id: ID!) { resendSupplierInvitation(invitationId: $id) }', admin, { id: again })
    const fourth = await inviteUser(admin, 'often@crew.example', 'supplier-member')
    expect({ code: fourth.code, per: fourth.errors?.[0]?.extensions['per'] }).toEqual({ code: 'RATE_LIMITED', per: 'address' })
    // Twenty an hour from one inviter.
    const [{ n } = { n: 0 }] = await db.sql<{ n: number }[]>`select count(*)::int as n from invitation i join membership m on m.user_id = i.invited_by_user_id where m.seller_id = ${admin.seller} and m.role_key = 'supplier-admin' and i.created_at > ${new Date(now.getTime() - 3_600_000)}`
    for (let i = n; i < 20; i++) expect((await inviteUser(admin, `burst${i}@crew.example`, 'supplier-member')).code).toBeUndefined()
    const over = await inviteUser(admin, 'burst-over@crew.example', 'supplier-member')
    expect({ code: over.code, per: over.errors?.[0]?.extensions['per'] }).toEqual({ code: 'RATE_LIMITED', per: 'inviter' })
    // The tests after this one invite again.
    await db.sql`update invitation set created_at = created_at - interval '2 hours' where seller_id = ${admin.seller}`
  })

  it('reaches only its own supplier: another supplier’s people and the merchant’s invitations are not found', async () => {
    const made = await invite('owner', { name: 'Rival Co', email: 'lead@rival.example', accessLevel: 'vendor-catalogue' })
    other = await join('lead@rival.example', made.id ?? '')
    const rivalLead = await memberId(other, 'lead@rival.example')
    expect((await gql('mutation C($id: ID!) { changeSupplierRole(membershipId: $id, role: "supplier-member") }', admin, { id: rivalLead })).code).toBe('NOT_FOUND')
    expect((await gql('mutation R($id: ID!) { removeSupplierUser(membershipId: $id) }', admin, { id: rivalLead })).code).toBe('NOT_FOUND')
    const [merchantInvite] = await db.sql<{ id: string }[]>`insert into invitation (store_id, email, role_key, expires_at, invited_by_label) values (${t.storeA1}, 'clerk@a.example', 'staff', ${new Date(now.getTime() + 86_400_000)}, 'Olivia') returning id`
    expect((await gql('mutation R($id: ID!) { revokeSupplierInvitation(invitationId: $id) }', admin, { id: merchantInvite?.id })).code).toBe('NOT_FOUND')
    expect((await team(admin)).some((m) => m.email === 'lead@rival.example' || m.email === 'clerk@a.example')).toBe(false)
  })

  it('keeps another store’s Supplier admin, in this partner or another, out of this team', async () => {
    const elsewhere = async (partnerId: string, storeId: string, sellerId: string, email: string): Promise<Acting> => {
      const id = await user(partnerId, email, 'Elsewhere')
      await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${id}, ${storeId}, ${sellerId}, 'supplier-admin', 'active')`
      return { cookie: await withSystemScope(db.sql, (tx) => createUserSession(tx, { id, partnerId }, now)), seller: sellerId, storeId, partnerId }
    }
    const [a2Seller] = await db.sql<{ id: string }[]>`insert into seller (store_id, name, access_level, status) values (${t.storeA2}, 'A2 Supply', 'vendor-catalogue', 'active') returning id`
    await db.sql`update store set status = 'active' where id in (${t.storeA2}, ${t.storeB1})`
    const outsiders = [await elsewhere(t.partnerA, t.storeA2, a2Seller?.id ?? '', 'admin@a2.example'), await elsewhere(t.partnerB, t.storeB1, t.sellerB1, 'admin@b1.example')]
    const lead = await memberId(admin, 'lead@crew.example')
    const invitation = (await inviteUser(admin, 'pending@crew.example', 'supplier-member')).data?.['inviteSupplierUser'] as string
    for (const outsider of outsiders) {
      const theirs = await gql('{ mySupplierTeam(first: 50) { nodes { email } } }', outsider)
      expect(theirs.code).toBeUndefined()
      expect((theirs.data?.['mySupplierTeam'] as { nodes: { email: string }[] }).nodes.some((m) => m.email.endsWith('@crew.example'))).toBe(false)
      for (const change of [
        gql('mutation C($id: ID!) { changeSupplierRole(membershipId: $id, role: "supplier-member") }', outsider, { id: lead }),
        gql('mutation R($id: ID!) { removeSupplierUser(membershipId: $id) }', outsider, { id: lead }),
        gql('mutation R($id: ID!) { resendSupplierInvitation(invitationId: $id) }', outsider, { id: invitation }),
        gql('mutation R($id: ID!) { revokeSupplierInvitation(invitationId: $id) }', outsider, { id: invitation }),
      ]) expect((await change).code).toBe('NOT_FOUND')
      expect((await gql('mutation A($id: ID!) { addSupplierPerson(id: $id, email: "x@y.example") }', outsider, { id: admin.seller })).code).toBe('FORBIDDEN')
    }
    expect((await team(admin)).find((m) => m.email === 'lead@crew.example')).toMatchObject({ role: 'supplier-admin' })
    expect((await team(admin)).some((m) => m.id === invitation)).toBe(true)
  })

  it('is held in the database too: only supplier roles, only its own supplier, and joining is the invitation’s', async () => {
    const as: CallerContext = { caller: { kind: 'person', userId: people.owner, sessionId: 's' }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'seller', sellerId: admin.seller }, subscription: 'active' }
    const expires = new Date(now.getTime() + 86_400_000)
    const sneak = await user(t.partnerA, 'sneak@crew.example', 'Sneak')
    await expect(withScope(db.sql, as, (tx) => tx`insert into invitation (store_id, seller_id, email, role_key, expires_at, invited_by_label) values (${t.storeA1}, ${admin.seller}, 'x@crew.example', 'owner', ${expires}, 'x')`)).rejects.toThrow(/row-level security/)
    await expect(withScope(db.sql, as, (tx) => tx`insert into invitation (store_id, seller_id, email, role_key, expires_at, invited_by_label) values (${t.storeA1}, ${other.seller}, 'x@crew.example', 'supplier-admin', ${expires}, 'x')`)).rejects.toThrow(/row-level security/)
    await expect(withScope(db.sql, as, (tx) => tx`insert into membership (user_id, store_id, seller_id, role_key, status) values (${sneak}, ${t.storeA1}, ${admin.seller}, 'supplier-admin', 'active')`)).rejects.toThrow(/row-level security/)
    await inviteUser(admin, 'waiting@crew.example', 'supplier-member')
    const [held] = await db.sql<{ id: string }[]>`select m.id from membership m join "user" u on u.id = m.user_id where u.email = 'waiting@crew.example'`
    await expect(withScope(db.sql, as, (tx) => tx`update membership set status = 'active' where id = ${held?.id ?? ''}`)).rejects.toThrow(/only invites and removes/)
    const [lead] = await db.sql<{ id: string }[]>`select id from membership where seller_id = ${admin.seller} and status = 'active' limit 1`
    await expect(withScope(db.sql, as, (tx) => tx`update membership set status = 'invited' where id = ${lead?.id ?? ''}`)).rejects.toThrow(/only invites and removes/)
    expect(await withScope(db.sql, as, async (tx) => (await tx`update membership set role_key = 'supplier-member' where seller_id = ${other.seller}`).count)).toBe(0)
  })
})

describe('the Owner adding a person to a supplier', () => {
  it('adds a member, or an admin when the supplier needs one, and refuses a suspended supplier or the merchant’s own people', async () => {
    const made = await invite('owner', { name: 'Lone Co', email: 'lead@lone.example', accessLevel: 'vendor-stock' })
    const id = made.id ?? ''
    const add = (email: string, role?: string) => gql('mutation A($id: ID!, $email: String!, $role: String) { addSupplierPerson(id: $id, email: $email, role: $role) }', 'owner', { id, email, role })
    expect((await add('two@lone.example')).code).toBeUndefined()
    expect((await db.sql<{ role_key: string }[]>`select role_key from invitation where email = 'two@lone.example'`)[0]?.role_key).toBe('supplier-member')
    expect((await add('three@lone.example', 'supplier-admin')).code).toBeUndefined()
    expect((await db.sql<{ role_key: string }[]>`select role_key from invitation where email = 'three@lone.example'`)[0]?.role_key).toBe('supplier-admin')
    expect((await add('Manager@a.example')).code).toBe('ALREADY_MEMBER')
    // People's three a day to one address hold here too.
    await add('twice@lone.example')
    await add('twice@lone.example')
    await add('twice@lone.example')
    const limited = await add('twice@lone.example')
    expect({ code: limited.code, per: limited.errors?.[0]?.extensions['per'] }).toEqual({ code: 'RATE_LIMITED', per: 'address' })
    expect((await add('four@lone.example', 'owner')).code).toBe('INVALID_INPUT')
    expect((await gql('mutation A($id: ID!) { addSupplierPerson(id: $id, email: "x@lone.example") }', 'manager', { id })).code).toBe('FORBIDDEN')
    expect((await gql('mutation A($id: ID!) { addSupplierPerson(id: $id, email: "x@lone.example") }', 'bOwner', { id })).code).toBe('NOT_FOUND')
    await gql('mutation S($id: ID!) { suspendSupplier(id: $id, hideProducts: false) }', 'owner', { id })
    expect((await add('five@lone.example')).code).toBe('SUSPENDED')
    expect(await db.sql`select 1 from activity_log where action = 'supplier.person_added' and target_id = ${id}`).toHaveLength(5)
  })
})
