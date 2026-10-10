import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { storePolicy, type StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { handleSupportSession, supportSessionPaths } from '#apis/store/supportSession'
import { hashSessionId } from '#auth/session'
import { storeRoleHas, type StorePermission } from '#auth/storePermissions'
import { resolveStoreStanding, storeHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { storeActivityFor, supportCookieName } from '#auth/storeSupport'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { prepareEmail } from '#saas/email/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #331 (SAPI 21): a partner support session on the store's side (ACCESS.md §8, §11): the
// exchange, read-only until the store allows writes, the "never" list, the switch, and isolation.

let db: TestDatabase
let t: Tenants
const start = new Date('2026-10-05T09:00:00Z')
let clock = start
const hosts = { a: 'store.partner-a.example', b: 'store.partner-b.example' }
const people = { owner: '', manager: '', staff: '', supplier: '', a2Owner: '', bOwner: '' }
const seats = { owner: '', manager: '', staff: '', supplier: '', a2Owner: '', bOwner: '' }
const cookies: Record<keyof typeof people, string> = { owner: '', manager: '', staff: '', supplier: '', a2Owner: '', bOwner: '' }
const agents = { priya: '', sam: '', bo: '' }

type Who = keyof typeof people
const partnerOf = (who: Who) => (who === 'bOwner' ? t.partnerB : t.partnerA)
const storeOf = (who: Who) => (who === 'bOwner' ? t.storeB1 : who === 'a2Owner' ? t.storeA2 : t.storeA1)

const user = async (partnerId: string, email: string, name: string) =>
  (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`)[0]?.id ?? ''
const seat = async (userId: string, storeId: string, role: string, sellerId: string | null = null) =>
  (await db.sql<{ id: string }[]>`insert into membership (user_id, store_id, seller_id, role_key, status) values (${userId}, ${storeId}, ${sellerId}, ${role}, 'active') returning id`)[0]?.id ?? ''
const agent = async (partnerId: string, email: string) =>
  (await db.sql<{ id: string }[]>`insert into partner_user (partner_id, email, name, role_key, status) values (${partnerId}, ${email}, ${email.split('@')[0] ?? 'x'}, 'partner-support', 'active') returning id`)[0]?.id ?? ''

/** A session as #202's start leaves it, with a handoff token the test knows. */
const opened = async (who: Who, agentId: string, token: string, minutes = 30) => {
  const [row] = await db.sql<{ id: string }[]>`
    insert into support_session (partner_id, store_id, membership_id, partner_user_id, reason, ticket, started_at, expires_at, handoff_hash, handoff_expires_at)
    values (${partnerOf(who)}, ${storeOf(who)}, ${seats[who]}, ${agentId}, 'Photos look blurry', 'ZD-4821', ${clock}, ${new Date(clock.getTime() + minutes * 60_000)}, ${await hashSessionId(token)}, ${new Date(clock.getTime() + 5 * 60_000)})
    returning id
  `
  return row?.id ?? ''
}

const portal = (host: string, path: string, body: unknown, cookie?: string) =>
  handleSupportSession(
    new Request(`https://${host}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { origin: `https://${host}`, 'cf-connecting-ip': '203.0.113.7', ...(cookie ? { cookie: `${supportCookieName}=${cookie}` } : {}) } }),
    new URL(`https://${host}${path}`),
    { sql: db.sql, partnerId: host === hosts.a ? t.partnerA : t.partnerB, activity: activityLog, now: () => clock, allowExchange: async () => true, allowRead: async () => true },
  )

/** The support cookie the exchange sets, or '' when it refused. */
const enter = async (token: string, host = hosts.a): Promise<string> => {
  const response = await portal(host, supportSessionPaths.handoff, { token })
  return /__Host-portal_support=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? ''
}

type PortalView = { session: { state: string; endedBy: string | null; writeRequest: { state: string } | null } & Record<string, unknown> }
const currentOf = async (cookie: string) => (await (await portal(hosts.a, supportSessionPaths.current, {}, cookie)).json()) as PortalView

type Caller = { person: Who } | { support: string; partnerId?: string; store?: string }

const contextFor = async (caller: Caller): Promise<StoreContext> => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const partnerId = 'person' in caller ? partnerOf(caller.person) : (caller.partnerId ?? t.partnerA)
  const headers: Record<string, string> = 'person' in caller ? { cookie: `${storeCookieName}=${cookies[caller.person]}`, [storeHeader]: storeOf(caller.person) } : { cookie: `${supportCookieName}=${caller.support}`, ...(caller.store ? { [storeHeader]: caller.store } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, clock, activityLog, facts)
  return { standing, partnerId, sql: db.sql, activity: storeActivityFor(standing, activityLog), facts, now: () => clock }
}

const gql = async <T = Record<string, unknown>>(source: string, caller: Caller, variables: Record<string, unknown> = {}) => {
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, variableValues: variables, contextValue: await contextFor(caller) })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const q = {
  access: `{ supportAccess { allowed sessions { nodes { id agentName partnerName actingAs { name role } reason ticket endedBy endedByName access allowedBy writeRequest { note state } } } } }`,
  banner: `{ storeState { support { partnerName agentFirstName sessionId access allowedBy writeRequest { note state } } } }`,
  set: `mutation($a: Boolean!) { setSupportAccess(allowed: $a) { allowed ended } }`,
  allow: `mutation($id: ID!) { allowSupportWrite(sessionId: $id) }`,
  deny: `mutation($id: ID!) { denySupportWrite(sessionId: $id) }`,
  ask: `mutation($n: String!) { requestSupportWrite(note: $n) }`,
  taxSetup: `{ taxSetup { pricesIncludeTax } }`,
  includeTax: `mutation($i: Boolean!) { setPricesIncludeTax(included: $i) }`,
}

type AccessView = { supportAccess: { allowed: boolean; sessions: { nodes: { id: string; agentName: string; endedBy: string | null; endedByName: string | null; access: string; allowedBy: string | null; writeRequest: { note: string; state: string } | null }[] } } }

const entries = (sessionId: string) =>
  db.sql<{ action: string; actor_kind: string; actor_id: string | null; on_behalf_of_id: string | null; reason: string | null; target_label: string | null; visibility: string }[]>`
    select action, actor_kind, actor_id, on_behalf_of_id, reason, target_label, visibility from activity_log where access_ref = ${sessionId} order by occurred_at, id
  `

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'portal', ${hosts.a}, 'live', 'CNAME', 'x'), (${t.partnerB}, 'portal', ${hosts.b}, 'live', 'CNAME', 'x')`
  people.owner = await user(t.partnerA, 'owner@a.example', 'Olivia Owner')
  people.manager = await user(t.partnerA, 'manager@a.example', 'Mo Manager')
  people.staff = await user(t.partnerA, 'staff@a.example', 'Sam Staff')
  people.supplier = await user(t.partnerA, 'nadia@anand.example', 'Nadia Tran')
  people.a2Owner = await user(t.partnerA, 'owner@a2.example', 'Ada Owner')
  people.bOwner = await user(t.partnerB, 'owner@b.example', 'Bea Owner')
  seats.owner = await seat(people.owner, t.storeA1, 'owner')
  seats.manager = await seat(people.manager, t.storeA1, 'manager')
  seats.staff = await seat(people.staff, t.storeA1, 'staff')
  seats.supplier = await seat(people.supplier, t.storeA1, 'supplier-admin', t.sellerA1First)
  seats.a2Owner = await seat(people.a2Owner, t.storeA2, 'owner')
  seats.bOwner = await seat(people.bOwner, t.storeB1, 'owner')
  agents.priya = await agent(t.partnerA, 'priya@partner-a.example')
  agents.sam = await agent(t.partnerA, 'sam@partner-a.example')
  agents.bo = await agent(t.partnerB, 'bo@partner-b.example')
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

beforeEach(async () => {
  // Each test starts with no open session, support on, and a fresh clock step.
  clock = new Date(clock.getTime() + 60 * 60_000)
  await db.sql`update support_session set ended_at = ${clock} where ended_at is null`
  await db.sql`update store set support_access_allowed = true, status = 'trial'`
  await db.sql`update membership set status = 'active'`
  // Fresh person sessions at the test's clock, inside their idle bound (ACCESS.md §4).
  for (const who of Object.keys(people) as Who[]) cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: partnerOf(who) }, clock))
})

describe('the exchange', () => {
  it('spends a link once for a cookie that acts as the user, read-only, and logs the entry', async () => {
    const id = await opened('owner', agents.priya, 'tok-enter')
    const cookie = await enter('tok-enter')
    expect(cookie).not.toBe('')
    expect(await enter('tok-enter')).toBe('')
    const current = await currentOf(cookie)
    expect(current.session).toMatchObject({ id, state: 'open', endedBy: null, agentName: 'priya', actingAs: { name: 'Olivia Owner', role: 'owner' }, access: 'read', writeRequest: null })
    expect((await gql(q.taxSetup, { support: cookie })).code).toBeUndefined()
    expect((await entries(id)).map((e) => e.action)).toEqual(['support_session.entered', 'support_session.viewed'])
    const viewed = (await entries(id))[1]
    expect(viewed).toMatchObject({ actor_kind: 'support_session', actor_id: id, on_behalf_of_id: agents.priya, target_label: 'taxSetup', visibility: 'store' })
  })

  it('refuses a link past its five minutes, on another partner’s host, or once support is off', async () => {
    await opened('owner', agents.priya, 'tok-late')
    clock = new Date(clock.getTime() + 6 * 60_000)
    expect(await enter('tok-late')).toBe('')
    await db.sql`update support_session set ended_at = ${clock} where ended_at is null`
    await opened('owner', agents.priya, 'tok-host')
    expect(await enter('tok-host', hosts.b)).toBe('')
    await db.sql`update store set support_access_allowed = false where id = ${t.storeA1}`
    expect(await enter('tok-host')).toBe('')
    const bad = await portal(hosts.a, supportSessionPaths.handoff, { token: 'tok-host' })
    expect(await bad.json()).toEqual({ ok: false, code: 'HANDOFF_INVALID' })
  })

  it('lets one of two exchanges of the same link win', async () => {
    await opened('owner', agents.priya, 'tok-race')
    const both = await Promise.all([enter('tok-race'), enter('tok-race')])
    expect(both.filter((c) => c !== '')).toHaveLength(1)
  })
})

describe('read-only until the store allows writes', () => {
  it('refuses every mutation a read-only session reaches, except asking for writes', async () => {
    await opened('owner', agents.priya, 'tok-every')
    const ctx = await contextFor({ support: await enter('tok-every') })
    const mutation = storeSchema.getMutationType()
    const codes = new Map<string, string>()
    for (const field of Object.values(mutation?.getFields() ?? {})) {
      const access = field.extensions.access
      if (!access) throw new Error(`${field.name} declares no access`)
      const code = await storePolicy.authorize(access, ctx, {}, 'mutation', { name: field.name, root: true }).then(
        () => 'admitted',
        (error: { extensions?: { code?: string } }) => error.extensions?.code ?? 'error',
      )
      codes.set(field.name, code)
    }
    expect([...codes].filter(([, code]) => code === 'admitted').map(([name]) => name)).toEqual(['requestSupportWrite'])
    // FORBIDDEN is a supplier's own field, which the Owner's seat never holds.
    expect([...codes].filter(([, c]) => !['admitted', 'SUPPORT_READ_ONLY', 'BLOCKED_FOR_SUPPORT', 'FORBIDDEN'].includes(c))).toEqual([])
    const fields = mutation?.getFields() ?? {}
    const forbiddenHeld = [...codes].filter(([name, c]) => c === 'FORBIDDEN' && storeRoleHas({ side: 'merchant', role: 'owner' }, String(fields[name]?.extensions.access?.permission) as StorePermission))
    expect(forbiddenHeld).toEqual([])
    expect(codes.get('setPricesIncludeTax')).toBe('SUPPORT_READ_ONLY')
    expect(codes.get('changePassword')).toBe('BLOCKED_FOR_SUPPORT')
    expect(codes.get('inviteMember')).toBe('BLOCKED_FOR_SUPPORT')
  })

  it('refuses a real write end to end and the database refuses it too', async () => {
    await opened('owner', agents.priya, 'tok-write')
    const cookie = await enter('tok-write')
    expect((await gql(q.includeTax, { support: cookie }, { i: true })).code).toBe('SUPPORT_READ_ONLY')
    expect((await gql(`{ profile { email } }`, { support: cookie })).code).toBe('BLOCKED_FOR_SUPPORT')
    expect((await gql(`{ myStores { pageInfo { hasNextPage } } }`, { support: cookie })).code).toBe('BLOCKED_FOR_SUPPORT')
  })
})

describe('write elevation', () => {
  it('shows the request in the banner, lets a Manager allow it, emails the Owners and attributes the write', async () => {
    const id = await opened('owner', agents.priya, 'tok-allow')
    const cookie = await enter('tok-allow')
    expect((await gql(q.ask, { support: cookie }, { n: 'Fix the product photos for ZD-4821' })).data?.['requestSupportWrite']).toBe(true)
    expect((await gql(q.ask, { support: cookie }, { n: 'Again' })).code).toBe('ALREADY_ASKED')
    expect((await gql(q.ask, { person: 'owner' }, { n: 'Not mine' })).code).toBe('FORBIDDEN')
    const banner = (await gql<{ storeState: { support: Record<string, unknown> } }>(q.banner, { person: 'staff' })).data?.storeState.support
    expect(banner).toMatchObject({ sessionId: id, access: 'read', writeRequest: { note: 'Fix the product photos for ZD-4821', state: 'pending' } })
    expect((await gql(q.allow, { person: 'staff' }, { id })).code).toBe('FORBIDDEN')
    expect((await gql(q.allow, { person: 'supplier' }, { id })).code).toBe('FORBIDDEN')
    expect((await gql(q.allow, { person: 'bOwner' }, { id })).code).toBe('NOT_PENDING')
    expect((await gql(q.allow, { person: 'a2Owner' }, { id })).code).toBe('NOT_PENDING')
    expect((await gql(q.allow, { person: 'manager' }, { id })).data?.['allowSupportWrite']).toBe(true)
    expect((await gql(q.allow, { person: 'owner' }, { id })).code).toBe('NOT_PENDING')

    const [email] = await db.sql<{ payload: { template: string }; store_id: string }[]>`select payload, store_id from outbox where idempotency_key like ${`%support-write-allowed:${id}%`}`
    expect(email).toMatchObject({ payload: { template: 'support-write-allowed' }, store_id: t.storeA1 })
    const prepared = await withSystemScope(db.sql, (tx) => prepareEmail(tx, { payload: email?.payload, partnerId: t.partnerA, storeId: t.storeA1 }, { adminHost: 'admin.example', platformHost: 'platform.example' }, clock))
    expect(prepared.send && prepared.to).toEqual(['owner@a.example'])

    expect((await gql(q.includeTax, { support: cookie }, { i: true })).code).toBeUndefined()
    const write = (await entries(id)).find((e) => e.action !== 'support_session.viewed' && e.actor_kind === 'support_session' && !e.action.startsWith('support_session.'))
    expect(write).toMatchObject({ actor_kind: 'support_session', actor_id: id, on_behalf_of_id: agents.priya })
    expect((await entries(id)).map((e) => e.action)).toEqual(expect.arrayContaining(['support_session.write_requested', 'support_session.write_allowed']))
  })

  it('keeps the "never" list refused once allowed: people, its own access, the switch, the person’s account', async () => {
    const id = await opened('owner', agents.priya, 'tok-never')
    const cookie = await enter('tok-never')
    await gql(q.ask, { support: cookie }, { n: 'Shipping rates' })
    await gql(q.allow, { person: 'owner' }, { id })
    expect((await gql(q.set, { support: cookie }, { a: false })).code).toBe('BLOCKED_FOR_SUPPORT')
    expect((await gql(q.allow, { support: cookie }, { id })).code).toBe('BLOCKED_FOR_SUPPORT')
    expect((await gql(`mutation { inviteMember(email: "x@a.example", role: "staff") }`, { support: cookie })).code).toBe('BLOCKED_FOR_SUPPORT')
    expect((await gql(`mutation { changePassword(current: "a", next: "b") }`, { support: cookie })).code).toBe('BLOCKED_FOR_SUPPORT')
    // An Owner's own Allow sends no email: only a Manager's does.
    expect(await db.sql`select 1 from outbox where idempotency_key like ${`%support-write-allowed:${id}%`}`).toHaveLength(0)
  })

  it('denies: the session stays read-only, and may ask again', async () => {
    const id = await opened('owner', agents.priya, 'tok-deny')
    const cookie = await enter('tok-deny')
    await gql(q.ask, { support: cookie }, { n: 'Edit a product' })
    expect((await gql(q.deny, { person: 'manager' }, { id })).data?.['denySupportWrite']).toBe(true)
    expect((await gql(q.includeTax, { support: cookie }, { i: false })).code).toBe('SUPPORT_READ_ONLY')
    const current = await currentOf(cookie)
    expect(current.session.writeRequest?.state).toBe('denied')
    expect((await gql(q.ask, { support: cookie }, { n: 'Please, one product' })).data?.['requestSupportWrite']).toBe(true)
  })
})

describe('the switch and the log', () => {
  it('Off ends every open session at once; the cookie acts as nobody; the log says the store ended it', async () => {
    const id = await opened('owner', agents.priya, 'tok-off')
    const other = await opened('staff', agents.sam, 'tok-off-2')
    const cookie = await enter('tok-off')
    expect((await gql(q.set, { person: 'manager' }, { a: false })).code).toBe('FORBIDDEN')
    expect((await gql<{ setSupportAccess: { ended: number } }>(q.set, { person: 'owner' }, { a: false })).data?.setSupportAccess).toEqual({ allowed: false, ended: 2 })
    expect((await gql(q.taxSetup, { support: cookie })).code).toBe('UNAUTHENTICATED')
    expect(await enter('tok-off-2')).toBe('')
    const log = (await gql<AccessView>(q.access, { person: 'owner' })).data?.supportAccess
    expect(log?.allowed).toBe(false)
    expect(log?.sessions.nodes.find((s) => s.id === id)).toMatchObject({ endedBy: 'store', endedByName: 'Olivia Owner', agentName: 'priya' })
    expect((await entries(other)).map((e) => [e.action, e.reason])).toEqual([['support_session.ended', 'support_off']])
    const current = await currentOf(cookie)
    expect(current.session).toMatchObject({ state: 'ended', endedBy: 'store' })
  })

  it('lists only the acting store’s sessions, to the Owner alone', async () => {
    const a1 = await opened('owner', agents.priya, 'tok-log-a1')
    const a2 = await opened('a2Owner', agents.sam, 'tok-log-a2')
    const b1 = await opened('bOwner', agents.bo, 'tok-log-b1')
    const ids = async (who: Who) => (await gql<AccessView>(q.access, { person: who })).data?.supportAccess.sessions.nodes.map((s) => s.id) ?? []
    expect(await ids('owner')).toContain(a1)
    expect(await ids('owner')).not.toEqual(expect.arrayContaining([a2]))
    expect(await ids('owner')).not.toEqual(expect.arrayContaining([b1]))
    expect(await ids('a2Owner')).toEqual([a2])
    expect(await ids('bOwner')).toEqual([b1])
    for (const who of ['manager', 'staff', 'supplier'] as const) expect((await gql(q.access, { person: who })).code).toBe('FORBIDDEN')
  })
})

describe('ends and races', () => {
  it('runs out at 30 minutes with no extension: the cookie, the request and the Allow all stop', async () => {
    const id = await opened('owner', agents.priya, 'tok-expire')
    const cookie = await enter('tok-expire')
    await gql(q.ask, { support: cookie }, { n: 'Change a price' })
    clock = new Date(clock.getTime() + 31 * 60_000)
    expect((await gql(q.taxSetup, { support: cookie })).code).toBe('UNAUTHENTICATED')
    expect((await gql(q.allow, { person: 'owner' }, { id })).code).toBe('NOT_PENDING')
    const current = await currentOf(cookie)
    expect(current.session).toMatchObject({ state: 'expired', endedBy: 'expired' })
  })

  it('an Allow racing the switch going Off never leaves a session that writes', async () => {
    const id = await opened('owner', agents.priya, 'tok-race-off')
    const cookie = await enter('tok-race-off')
    await gql(q.ask, { support: cookie }, { n: 'Fix it' })
    await Promise.all([gql(q.allow, { person: 'manager' }, { id }), gql(q.set, { person: 'owner' }, { a: false })])
    expect((await gql(q.includeTax, { support: cookie }, { i: true })).code).toBe('UNAUTHENTICATED')
    const [row] = await db.sql<{ ended_at: Date | null }[]>`select ended_at from support_session where id = ${id}`
    expect(row?.ended_at).not.toBeNull()
  })

  it('a start that raced Off ends on first use; a user gone ends it as target gone', async () => {
    const raced = await opened('owner', agents.priya, 'tok-raced')
    const cookie = await enter('tok-raced')
    await db.sql`update store set support_access_allowed = false where id = ${t.storeA1}`
    expect((await gql(q.taxSetup, { support: cookie })).code).toBe('UNAUTHENTICATED')
    expect((await entries(raced)).at(-1)).toMatchObject({ action: 'support_session.ended', actor_kind: 'job', reason: 'support_off' })
    await db.sql`update store set support_access_allowed = true where id = ${t.storeA1}`
    const gone = await opened('manager', agents.sam, 'tok-gone')
    const managerCookie = await enter('tok-gone')
    await db.sql`update membership set status = 'suspended' where id = ${seats.manager}`
    expect((await gql(q.taxSetup, { support: managerCookie })).code).toBe('UNAUTHENTICATED')
    expect((await entries(gone)).at(-1)).toMatchObject({ action: 'support_session.ended', reason: 'target_gone' })
  })

  it('End now in the bar ends it as the agent, once', async () => {
    const id = await opened('owner', agents.priya, 'tok-end')
    const cookie = await enter('tok-end')
    expect(await (await portal(hosts.a, supportSessionPaths.end, { id }, cookie)).json()).toEqual({ ok: true })
    expect(await (await portal(hosts.a, supportSessionPaths.end, { id }, cookie)).json()).toEqual({ ok: false, code: 'SESSION_NOT_ENDED' })
    expect((await currentOf(cookie)).session).toMatchObject({ state: 'ended', endedBy: 'agent' })
    expect((await gql(q.taxSetup, { support: cookie })).code).toBe('UNAUTHENTICATED')
  })
})

describe('isolation (ACCESS.md §11)', () => {
  it('a session never reaches another store, another partner’s host, or past its supplier seat', async () => {
    await opened('owner', agents.priya, 'tok-iso')
    const cookie = await enter('tok-iso')
    expect((await gql(q.taxSetup, { support: cookie, store: t.storeA2 })).code).toBe('FORBIDDEN')
    const [crossing] = await db.sql<{ actor_kind: string; visibility: string }[]>`select actor_kind, visibility from activity_log where action = 'store.crossing_refused' and actor_kind = 'support_session'`
    expect(crossing).toEqual({ actor_kind: 'support_session', visibility: 'staff' })
    // Capped at five a minute, as a person's crossings are.
    for (let i = 0; i < 7; i += 1) expect((await gql(q.taxSetup, { support: cookie, store: t.storeA2 })).code).toBe('FORBIDDEN')
    expect(await db.sql`select 1 from activity_log where action = 'store.crossing_refused' and actor_kind = 'support_session'`).toHaveLength(5)
    expect((await gql(q.taxSetup, { support: cookie, partnerId: t.partnerB })).code).toBe('UNAUTHENTICATED')

    await opened('supplier', agents.sam, 'tok-iso-supplier')
    const supplierCookie = await enter('tok-iso-supplier')
    expect((await gql(q.taxSetup, { support: supplierCookie })).code).toBe('FORBIDDEN')
    expect((await gql(q.access, { support: supplierCookie })).code).toBe('FORBIDDEN')
    const banner = (await gql<{ storeState: { support: { sessionId: string | null } | null } }>(q.banner, { support: supplierCookie })).data?.storeState.support
    expect(banner?.sessionId ?? null).toBeNull()
  })

  it('a person’s banner shows only an open session on their own store', async () => {
    await opened('a2Owner', agents.sam, 'tok-iso-banner')
    expect((await gql<{ storeState: { support: unknown } }>(q.banner, { person: 'owner' })).data?.storeState.support).toBeNull()
    expect((await gql<{ storeState: { support: { partnerName: string } | null } }>(q.banner, { person: 'a2Owner' })).data?.storeState.support?.partnerName).toBe('Partner A')
    expect((await gql<{ storeState: { support: unknown } }>(q.banner, { person: 'bOwner' })).data?.storeState.support).toBeNull()
  })
})
