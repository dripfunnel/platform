import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actingCaller, storePolicy, type StoreContext } from '#apis/store/access'
import { createStoreBuilder, pageInfoType } from '#apis/store/builder'
import { requirePlan, storePage } from '#apis/store/refusals'
import { resolvePortalPartner, resolveStoreStanding, storeHeader, supplierHeader, type StoreStanding } from '#auth/storeCaller'
import { createUserSession, idleMs, storeCookieName } from '#auth/storeSession'
import { secureSchema } from '#apis/graphql/scope'
import { pageOf } from '#core/paging'
import { withScope, withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #288: the Store API's caller on a portal host, its refusals, paging, PLAN_LIMIT, and the
// isolation matrix for what it reads (ACCESS.md §11: caller kind × store × seller).

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-05T09:00:00Z')
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }
const hostA = 'store.partner-a.example'
const hostB = 'store.partner-b.example'
const people = { alice: '', sam: '', bob: '', pat: '' }
const cookies = { alice: '', sam: '', bob: '', pat: '' }

const insertId = async (rows: Promise<{ id: string }[]>): Promise<string> => {
  const row = (await rows)[0]
  if (!row) throw new Error('fixture insert returned no row')
  return row.id
}

const member = async (userId: string, storeId: string, role: string, sellerId: string | null = null) =>
  db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${userId}, ${storeId}, ${sellerId}, ${role}, 'active')`

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  for (const [partner, host] of [[t.partnerA, hostA], [t.partnerB, hostB]] as const) {
    await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${partner}, 'portal', ${host}, 'live', 'CNAME', 'portal.dripfunnel.net')`
  }
  const user = (partnerId: string, name: string) =>
    insertId(db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${`${name.toLowerCase()}@example.test`}, ${name}, 'active') returning id`)
  people.alice = await user(t.partnerA, 'Alice')
  people.sam = await user(t.partnerA, 'Sam')
  people.pat = await user(t.partnerA, 'Pat')
  people.bob = await user(t.partnerB, 'Bob')
  await member(people.alice, t.storeA1, 'owner')
  await member(people.sam, t.storeA1, 'supplier-member', t.sellerA1First)
  await member(people.sam, t.storeA1, 'supplier-admin', t.sellerA1Second)
  await member(people.pat, t.storeA1, 'staff')
  await member(people.bob, t.storeB1, 'owner')
  for (const name of ['alice', 'sam', 'bob', 'pat'] as const) {
    const partnerId = name === 'bob' ? t.partnerB : t.partnerA
    cookies[name] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[name], partnerId }, now))
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const request = (cookie: string | null, headers: Record<string, string> = {}) =>
  new Request(`https://${hostA}/api/`, { headers: { ...(cookie ? { cookie: `${storeCookieName}=${cookie}` } : {}), ...headers } })

const standingOf = (partnerId: string, cookie: string | null, headers: Record<string, string> = {}, at = now) =>
  resolveStoreStanding(db.sql, request(cookie, headers), partnerId, at, activityLog, facts)

// A list read through the scoped layer with the resolved context, so RLS decides what it holds.
const builder = createStoreBuilder()
const PageInfo = pageInfoType(builder)
interface MemberRow { id: string; role_key: string; seller_id: string | null; created_at: Date }
const Member = builder.objectRef<MemberRow>('TestMember').implement({ fields: (f) => ({ id: f.exposeID('id'), role: f.exposeString('role_key'), sellerId: f.exposeString('seller_id', { nullable: true }) }) })
const Members = builder.objectRef<{ nodes: MemberRow[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('TestMembers').implement({
  fields: (f) => ({ nodes: f.field({ type: [Member], resolve: (p) => p.nodes }), pageInfo: f.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
})
builder.queryFields((f) => ({
  members: f.field({
    type: Members,
    args: { first: f.arg.int(), after: f.arg.string() },
    extensions: { access: { api: 'store', scope: 'store-seller', permission: 'catalog.read', target: 'none' } },
    resolve: async (_, args, ctx) => {
      const window = storePage(args)
      const { context } = actingCaller(ctx)
      const rows = await withScope(db.sql, context, (tx) => tx<MemberRow[]>`
        select id, role_key, seller_id, created_at from membership
        where ${window.after ? tx`(created_at, id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
        order by created_at desc, id desc limit ${window.limit + 1}
      `)
      return pageOf(rows, window, (r) => ({ occurredAt: r.created_at, id: r.id }))
    },
  }),
}))
const schema = secureSchema(builder.toSchema(), storePolicy)

const query = async (source: string, standing: StoreStanding) => {
  const contextValue: StoreContext = { standing, partnerId: 'p', activity: { record: async () => undefined }, sql: db.sql, facts, now: () => now }
  const result = await graphql({ schema: schema as GraphQLSchema, source, contextValue })
  return { data: result.data as { members?: { nodes: { id: string; role: string; sellerId: string | null }[]; pageInfo: { endCursor: string | null; hasNextPage: boolean } } } | null | undefined, code: result.errors?.[0]?.extensions['code'] }
}

describe('the portal host', () => {
  it('names the partner whose portal it is, and no one for a host nobody holds', async () => {
    expect(await resolvePortalPartner(db.sql, hostA)).toBe(t.partnerA)
    expect(await resolvePortalPartner(db.sql, hostA.toUpperCase())).toBe(t.partnerA)
    expect(await resolvePortalPartner(db.sql, 'store.nobody.example')).toBeNull()
  })

  it('holds no partner whose host is still waiting for its records, or whose partner is closed', async () => {
    await db.sql`update partner_domain set status = 'waiting' where host = ${hostB}`
    expect(await resolvePortalPartner(db.sql, hostB)).toBeNull()
    await db.sql`update partner_domain set status = 'live' where host = ${hostB}`
    await db.sql`update partner set state = 'closed' where id = ${t.partnerB}`
    expect(await resolvePortalPartner(db.sql, hostB)).toBeNull()
    await db.sql`update partner set state = 'draft' where id = ${t.partnerB}`
  })
})

describe('the store caller', () => {
  it('is signed out without a cookie, with an unknown one, and on another partner’s host', async () => {
    expect((await standingOf(t.partnerA, null)).kind).toBe('signed-out')
    expect((await standingOf(t.partnerA, 'not-a-session')).kind).toBe('signed-out')
    expect((await standingOf(t.partnerB, cookies.alice, { [storeHeader]: t.storeA1 })).kind).toBe('signed-out')
  })

  it('is signed out once the session has idled past its bound', async () => {
    const later = new Date(now.getTime() + idleMs + 60_000)
    const fresh = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people.pat, partnerId: t.partnerA }, now))
    expect((await standingOf(t.partnerA, fresh, { [storeHeader]: t.storeA1 }, later)).kind).toBe('signed-out')
  })

  it('asks for a store before acting, and acts as the membership the store names', async () => {
    expect((await standingOf(t.partnerA, cookies.alice)).kind).toBe('no-store')
    const standing = await standingOf(t.partnerA, cookies.alice, { [storeHeader]: t.storeA1 })
    expect(standing.kind).toBe('acting')
    if (standing.kind !== 'acting') return
    expect(standing.caller.context).toMatchObject({ partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' } })
    expect(standing.caller.role).toEqual({ side: 'merchant', role: 'owner' })
  })

  it('asks a person working for two suppliers which one, and scopes them to it', async () => {
    expect((await standingOf(t.partnerA, cookies.sam, { [storeHeader]: t.storeA1 })).kind).toBe('supplier-required')
    const standing = await standingOf(t.partnerA, cookies.sam, { [storeHeader]: t.storeA1, [supplierHeader]: t.sellerA1Second })
    expect(standing.kind === 'acting' && standing.caller.context.sellerScope).toEqual({ kind: 'seller', sellerId: t.sellerA1Second })
    expect(standing.kind === 'acting' && standing.caller.role).toEqual({ side: 'supplier', role: 'supplier-admin', tier: 'vendor-stock' })
  })

  it('refuses a store the session doesn’t hold, and logs the crossing with both stores and the person', async () => {
    for (const asked of [t.storeA2, t.storeB1, 'not-a-uuid']) {
      expect((await standingOf(t.partnerA, cookies.alice, { [storeHeader]: asked })).kind).toBe('crossing')
    }
    const rows = await db.sql<{ actor_id: string; target_id: string; target_label: string; result: string }[]>`
      select actor_id, target_id, target_label, result from activity_log where action = 'store.crossing_refused' and actor_id = ${people.alice} order by occurred_at, id
    `
    expect(rows.map((r) => r.target_id)).toEqual([t.storeA2, t.storeB1, 'not-a-uuid'])
    expect(rows.every((r) => r.result === 'denied' && r.target_label === `holds ${t.storeA1}`)).toBe(true)
  })

  it('refuses a supplier the person doesn’t work for, a suspended supplier and a suspended membership', async () => {
    expect((await standingOf(t.partnerA, cookies.sam, { [storeHeader]: t.storeA1, [supplierHeader]: t.sellerB1 })).kind).toBe('crossing')
    await db.sql`update seller set status = 'suspended' where id = ${t.sellerA1First}`
    expect((await standingOf(t.partnerA, cookies.sam, { [storeHeader]: t.storeA1, [supplierHeader]: t.sellerA1First })).kind).toBe('crossing')
    await db.sql`update seller set status = 'active' where id = ${t.sellerA1First}`
    await db.sql`update membership set status = 'suspended' where user_id = ${people.pat}`
    expect((await standingOf(t.partnerA, cookies.pat, { [storeHeader]: t.storeA1 })).kind).toBe('crossing')
    await db.sql`update membership set status = 'active' where user_id = ${people.pat}`
  })

  it('reads the membership on every request, so a removal applies on the next one', async () => {
    expect((await standingOf(t.partnerA, cookies.pat, { [storeHeader]: t.storeA1 })).kind).toBe('acting')
    await db.sql`update membership set status = 'suspended' where user_id = ${people.pat}`
    expect((await standingOf(t.partnerA, cookies.pat, { [storeHeader]: t.storeA1 })).kind).toBe('crossing')
    await db.sql`update membership set status = 'active' where user_id = ${people.pat}`
  })
})

describe('isolation through the Store API (ACCESS.md §11)', () => {
  it('lets the merchant side read only its own store’s rows', async () => {
    const { data } = await query('{ members { nodes { id role sellerId } } }', await standingOf(t.partnerA, cookies.alice, { [storeHeader]: t.storeA1 }))
    expect(data?.members?.nodes.map((n) => n.role).sort()).toEqual(['owner', 'staff', 'supplier-admin', 'supplier-member'])
    const bob = await query('{ members { nodes { role } } }', await standingOf(t.partnerB, cookies.bob, { [storeHeader]: t.storeB1 }))
    expect(bob.data?.members?.nodes.map((n) => n.role)).toEqual(['owner'])
  })

  it('lets a supplier read only its own supplier’s rows, never the merchant’s or another supplier’s', async () => {
    const { data } = await query('{ members { nodes { role sellerId } } }', await standingOf(t.partnerA, cookies.sam, { [storeHeader]: t.storeA1, [supplierHeader]: t.sellerA1First }))
    expect(data?.members?.nodes).toEqual([{ role: 'supplier-member', sellerId: t.sellerA1First }])
  })

  it('refuses a crossing caller, a signed-out one and one with no store, with stable codes', async () => {
    expect((await query('{ members { nodes { id } } }', await standingOf(t.partnerA, cookies.alice, { [storeHeader]: t.storeB1 }))).code).toBe('FORBIDDEN')
    expect((await query('{ members { nodes { id } } }', await standingOf(t.partnerA, null))).code).toBe('UNAUTHENTICATED')
    expect((await query('{ members { nodes { id } } }', await standingOf(t.partnerA, cookies.alice))).code).toBe('STORE_REQUIRED')
  })

  it('pages by cursor without a total, and every page stays inside the store', async () => {
    const standing = await standingOf(t.partnerA, cookies.alice, { [storeHeader]: t.storeA1 })
    const first = await query('{ members(first: 3) { nodes { id } pageInfo { endCursor hasNextPage } } }', standing)
    expect(first.data?.members?.nodes).toHaveLength(3)
    expect(first.data?.members?.pageInfo.hasNextPage).toBe(true)
    const cursor = first.data?.members?.pageInfo.endCursor ?? ''
    const second = await query(`{ members(first: 3, after: "${cursor}") { nodes { id } pageInfo { hasNextPage } } }`, standing)
    expect(second.data?.members?.nodes).toHaveLength(1)
    expect(second.data?.members?.pageInfo.hasNextPage).toBe(false)
    const seen = [...(first.data?.members?.nodes ?? []), ...(second.data?.members?.nodes ?? [])].map((n) => n.id)
    const [inStore] = await db.sql<{ n: number }[]>`select count(*)::int as n from membership where store_id = ${t.storeA1}`
    expect(new Set(seen).size).toBe(inStore?.n)
  })
})

describe('PLAN_LIMIT', () => {
  let starter = ''
  let business = ''

  beforeAll(async () => {
    const plan = (partnerId: string, name: string) => insertId(db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${name}, 'live') returning id`)
    starter = await plan(t.partnerA, 'Starter')
    business = await plan(t.partnerA, 'Business')
    const growth = await plan(t.partnerB, 'Growth')
    const set = (planId: string, partnerId: string, key: string, value: boolean | number) =>
      typeof value === 'boolean'
        ? db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled) values (${planId}, ${partnerId}, 1, ${key}, ${value})`
        : db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${planId}, ${partnerId}, 1, ${key}, ${value})`
    await set(starter, t.partnerA, 'aplus', false)
    await set(starter, t.partnerA, 'products', 10)
    await set(business, t.partnerA, 'aplus', true)
    await set(business, t.partnerA, 'products', 1000)
    await set(growth, t.partnerB, 'aplus', true)
    await db.sql`insert into plan_price (plan_id, partner_id, version, currency, monthly_amount) values (${business}, ${t.partnerA}, 1, 'INR', 99900)`
    for (const [storeId, partnerId, planId] of [[t.storeA1, t.partnerA, starter], [t.storeB1, t.partnerB, growth]] as const) {
      await db.sql`update store set plan_id = ${planId} where id = ${storeId}`
      await db.sql`
        insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
        values (${storeId}, ${partnerId}, ${planId}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})
      `
    }
  })

  const contextOf = async (cookie: string, storeId: string, partnerId: string) => {
    const standing = await standingOf(partnerId, cookie, { [storeHeader]: storeId })
    if (standing.kind !== 'acting') throw new Error(`expected acting, got ${standing.kind}`)
    return standing.caller.context
  }

  it('refuses a switch the plan leaves off, naming the partner’s cheapest plan that has it', async () => {
    const context = await contextOf(cookies.alice, t.storeA1, t.partnerA)
    await expect(requirePlan(db.sql, context, 'aplus', now)).rejects.toMatchObject({ extensions: { code: 'PLAN_LIMIT', key: 'aplus', limit: null, unlockedBy: { id: business, name: 'Business' } } })
  })

  it('refuses going past a limit and allows reaching it', async () => {
    const context = await contextOf(cookies.alice, t.storeA1, t.partnerA)
    await expect(requirePlan(db.sql, context, 'products', now, 10)).resolves.toBeUndefined()
    await expect(requirePlan(db.sql, context, 'products', now, 11)).rejects.toMatchObject({ extensions: { code: 'PLAN_LIMIT', limit: 10, unlockedBy: { name: 'Business' } } })
  })

  it('counts a live override instead of the plan’s limit', async () => {
    await db.sql`insert into store_limit_override (store_id, key, amount, duration, reason, created_by_kind, created_by_label) values (${t.storeA1}, 'products', 20, 'always', 'Launch week', 'staff', 'Priya')`
    const context = await contextOf(cookies.alice, t.storeA1, t.partnerA)
    await expect(requirePlan(db.sql, context, 'products', now, 15)).resolves.toBeUndefined()
  })

  it('holds a supplier’s action to the store’s own plan, read in the store’s scope', async () => {
    const standing = await standingOf(t.partnerA, cookies.sam, { [storeHeader]: t.storeA1, [supplierHeader]: t.sellerA1First })
    if (standing.kind !== 'acting') throw new Error(`expected acting, got ${standing.kind}`)
    await expect(requirePlan(db.sql, standing.caller.context, 'products', now, 20)).resolves.toBeUndefined()
    await expect(requirePlan(db.sql, standing.caller.context, 'products', now, 21)).rejects.toMatchObject({ extensions: { code: 'PLAN_LIMIT', limit: 20 } })
  })

  it('refuses a key the plan doesn’t set, and never names another partner’s plan', async () => {
    const context = await contextOf(cookies.bob, t.storeB1, t.partnerB)
    await expect(requirePlan(db.sql, context, 'aplus', now)).resolves.toBeUndefined()
    await expect(requirePlan(db.sql, context, 'offers', now)).rejects.toMatchObject({ extensions: { code: 'PLAN_LIMIT', unlockedBy: null } })
  })
})
