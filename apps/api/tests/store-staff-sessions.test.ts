import { graphql, isObjectType, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { handleStoreAuth } from '#apis/store/auth'
import { handleStaffSession, staffSessionPaths } from '#apis/store/staffSession'
import { hashSessionId } from '#auth/session'
import { resolveStoreStanding, storeHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { staffCookieName } from '#auth/storeStaff'
import { storeActivityFor } from '#auth/storeSupport'
import { withSystemScope } from '#db/scoped/index'
import { storeSchema } from '#apis/store/schema'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Staff impersonating a store user on the store's portal host (ACCESS.md §8.1, §8.3): the exchange,
// the caller, the blocked list, the notice, and every way a session ends.

let db: TestDatabase
let t: Tenants
const start = new Date('2026-10-30T09:00:00Z')
let clock = start
const hosts = { a: 'store.partner-a.example', b: 'store.partner-b.example' }
const people = { owner: '', manager: '', supplier: '', a2Owner: '' }
const seats = { owner: '', manager: '', supplier: '', a2Owner: '' }
const cookies = { owner: '', manager: '', supplier: '', a2Owner: '' }
let neha = ''
let maya = ''

type Who = keyof typeof people
const storeOf = (who: Who) => (who === 'a2Owner' ? t.storeA2 : t.storeA1)

const user = async (email: string, name: string) =>
  (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, ${name}, 'active') returning id`)[0]?.id ?? ''
const seat = async (userId: string, role: string, sellerId: string | null = null, storeId = t.storeA1) =>
  (await db.sql<{ id: string }[]>`insert into membership (user_id, store_id, seller_id, role_key, status) values (${userId}, ${storeId}, ${sellerId}, ${role}, 'active') returning id`)[0]?.id ?? ''

/** An impersonation as the Admin API's start leaves it (#40), with a handoff token the test knows. */
const started = async (who: Who, token: string, staffId = neha) => {
  const [row] = await db.sql<{ id: string }[]>`
    insert into impersonation (staff_user_id, target_kind, target_id, membership_id, partner_id, store_id, reason, started_at, expires_at, handoff_hash, handoff_expires_at)
    values (${staffId}, 'person', ${people[who]}, ${seats[who]}, ${t.partnerA}, ${t.storeA1}, 'Checking a refund', ${clock}, ${new Date(clock.getTime() + 30 * 60_000)}, ${await hashSessionId(token)}, ${new Date(clock.getTime() + 5 * 60_000)})
    returning id
  `
  return row?.id ?? ''
}

const portal = (host: string, path: string, body: unknown, cookie?: string) =>
  handleStaffSession(
    new Request(`https://${host}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { origin: `https://${host}`, 'cf-connecting-ip': '203.0.113.7', ...(cookie ? { cookie: `${staffCookieName}=${cookie}` } : {}) } }),
    new URL(`https://${host}${path}`),
    { sql: db.sql, partnerId: host === hosts.a ? t.partnerA : t.partnerB, activity: activityLog, now: () => clock, allowExchange: async () => true, allowRead: async () => true },
  )

/** The staff cookie the exchange sets, or '' when it refused. */
const enter = async (token: string, host = hosts.a): Promise<string> => {
  const response = await portal(host, staffSessionPaths.handoff, { token })
  return new RegExp(`${staffCookieName}=([^;]+)`).exec(response.headers.get('set-cookie') ?? '')?.[1] ?? ''
}

type View = { session: { state: string; endedBy: string | null; actingAs: { name: string; role: string; store: string } } | null }
const currentOf = async (cookie: string) => (await (await portal(hosts.a, staffSessionPaths.current, {}, cookie)).json()) as View

type Caller = { person: Who } | { staff: string; store?: string }

const contextFor = async (caller: Caller): Promise<StoreContext> => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers: Record<string, string> =
    'person' in caller ? { cookie: `${storeCookieName}=${cookies[caller.person]}`, [storeHeader]: storeOf(caller.person) } : { cookie: `${staffCookieName}=${caller.staff}`, ...(caller.store ? { [storeHeader]: caller.store } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, clock, activityLog, facts)
  return { standing, partnerId: t.partnerA, sql: db.sql, activity: storeActivityFor(standing, activityLog), facts, now: () => clock }
}

const gql = async <T = Record<string, unknown>>(source: string, caller: Caller, variables: Record<string, unknown> = {}) => {
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, variableValues: variables, contextValue: await contextFor(caller) })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const entries = (sessionId: string) =>
  db.sql<{ action: string; actor_kind: string; actor_id: string | null; on_behalf_of_id: string | null; reason: string | null }[]>`
    select action, actor_kind, actor_id, on_behalf_of_id, reason from activity_log where access_ref = ${sessionId} order by occurred_at, id
  `

const notice = `{ staffSessionNotice { kind staffName actingAs endsAt } }`

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  people.owner = await user('owner@a.example', 'Olivia Owner')
  people.manager = await user('manager@a.example', 'Mo Manager')
  people.supplier = await user('nadia@anand.example', 'Nadia Tran')
  seats.owner = await seat(people.owner, 'owner')
  seats.manager = await seat(people.manager, 'manager')
  seats.supplier = await seat(people.supplier, 'supplier-admin', t.sellerA1First)
  people.a2Owner = await user('owner@a2.example', 'Ada Owner')
  seats.a2Owner = await seat(people.a2Owner, 'owner', null, t.storeA2)
  neha = (await db.sql<{ id: string }[]>`insert into staff_user (sso_subject, email, name, role_key, status) values ('sso-neha', 'neha@dripfunnel.example', 'Neha Rao', 'staff-support', 'active') returning id`)[0]?.id ?? ''
  maya = (await db.sql<{ id: string }[]>`insert into staff_user (sso_subject, email, name, role_key, status) values ('sso-maya', 'maya@dripfunnel.example', 'Maya Ortiz', 'staff-support', 'active') returning id`)[0]?.id ?? ''
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

beforeEach(async () => {
  // One open impersonation per staff member: each test starts with none, and a fresh clock step.
  clock = new Date(clock.getTime() + 2 * 60 * 60_000)
  await db.sql`update impersonation set ended_at = ${clock}, end_reason = 'staff' where ended_at is null`
  await db.sql`update membership set status = 'active'`
  for (const who of Object.keys(people) as Who[]) cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: t.partnerA }, clock))
})

describe('the exchange', () => {
  it('spends a link once for a cookie that acts as the user in their seat', async () => {
    await started('manager', 'tok-once')
    const cookie = await enter('tok-once')
    expect(cookie).not.toBe('')
    expect((await currentOf(cookie)).session).toMatchObject({ state: 'open', endedBy: null, actingAs: { name: 'Mo Manager', role: 'manager' } })
    expect(await enter('tok-once')).toBe('')
  })

  it('refuses a link on another partner’s host and leaves it good on its own', async () => {
    await started('manager', 'tok-host')
    expect(await enter('tok-host', hosts.b)).toBe('')
    expect(await enter('tok-host')).not.toBe('')
  })

  it('refuses an expired link', async () => {
    await started('manager', 'tok-late')
    clock = new Date(clock.getTime() + 6 * 60_000)
    expect(await enter('tok-late')).toBe('')
  })
})

describe('the caller', () => {
  it('reads as the user acted as, in one store, and offers no other', async () => {
    await started('manager', 'tok-me')
    const staff = await enter('tok-me')
    const { data } = await gql<{ me: { name: string; acting: { store: { id: string } } }; myStores: { nodes: { store: { id: string }; membershipId: string }[] } }>(
      `{ me { name acting { store { id } } } myStores { nodes { store { id } membershipId } } }`,
      { staff },
    )
    expect(data?.me).toMatchObject({ name: 'Mo Manager', acting: { store: { id: t.storeA1 } } })
    expect(data?.myStores.nodes).toEqual([{ store: { id: t.storeA1 }, membershipId: seats.manager }])
  })

  it('names another store only as a crossing, logged on the staff member’s behalf', async () => {
    await started('manager', 'tok-cross')
    const staff = await enter('tok-cross')
    expect((await gql(`{ storeState { readOnly } }`, { staff, store: t.storeA2 })).code).toBe('FORBIDDEN')
    const [crossing] = await db.sql<{ actor_id: string; on_behalf_of_id: string | null }[]>`select actor_id, on_behalf_of_id from activity_log where action = 'store.crossing_refused' order by occurred_at desc limit 1`
    expect(crossing).toEqual({ actor_id: people.manager, on_behalf_of_id: neha })
  })

  it('writes as the user, with the staff member and the session on every entry', async () => {
    const id = await started('owner', 'tok-write')
    const staff = await enter('tok-write')
    expect((await gql(`mutation { setPricesIncludeTax(included: true) }`, { staff })).code).toBeUndefined()
    expect(await entries(id)).toContainEqual(expect.objectContaining({ actor_kind: 'person', actor_id: people.owner, on_behalf_of_id: neha }))
  })
})

describe('the blocked list (ACCESS.md §8.1)', () => {
  const fields = () => {
    const schema = storeSchema as GraphQLSchema
    const mutations = schema.getMutationType()
    return [schema.getQueryType(), mutations].flatMap((type) => (type && isObjectType(type) ? Object.values(type.getFields()).map((field) => ({ field, mutation: type === mutations })) : []))
  }
  const blocked = (kind: 'impersonation') => fields().filter(({ field }) => field.extensions.access?.blockedFor?.includes(kind)).map(({ field }) => field.name).sort()
  const signIn = ['changeEmail', 'changePassword', 'regenerateBackupCodes', 'setSecondFactor', 'signOutOtherSessions']
  const moneyDetails = ['connectGateway', 'connectStripe', 'finishStripeConnect', 'setPaymentMethod']
  // The store's own AI account and the Owner's consent to bill it, as the partner console's AI keys (#275).
  // Credentials and data channels that outlive the session; revoking, removing and uninstalling stay open.
  const outlasting = ['createApiKey', 'installApp', 'rotateApiKey', 'saveWebhook']
  const aiAccount = ['beginStoreAiOauth', 'connectStoreAiAccount', 'finishStoreAiOauth', 'removeStoreAiAccount', 'setStoreAiFallback', 'setStoreAiSwitch']
  // The storefront's design, studio and preview links were declared before #1012.
  const storefront = ['askDesign', 'chooseTemplate', 'designChat', 'designText', 'discardDraft', 'endPreviewLinks', 'goBackToVersion', 'previewLink', 'publishBefore', 'publishDesign', 'publishNow', 'renewStudioSession', 'saveDesignText', 'studioSession', 'undoDesignChange']

  it('declares the user’s sign-in and sessions, money details, the store’s AI account, the store switch and the storefront’s design', () => {
    expect(blocked('impersonation')).toEqual([...signIn, ...moneyDetails, ...aiAccount, ...outlasting, 'switchStore', ...storefront].sort())
  })

  it('leaves no mutation on the user’s own account open but their name and theme', () => {
    const open = fields().filter(({ field, mutation }) => mutation && field.extensions.access?.scope === 'session' && !field.extensions.access.blockedFor?.includes('impersonation'))
    expect(open.map(({ field }) => field.name).sort()).toEqual(['setTheme', 'updateProfile'])
  })

  it('refuses every declared field and every Owner change, whatever the role', async () => {
    await started('owner', 'tok-blocked')
    const staff = await enter('tok-blocked')
    const refused = [
      `mutation { changeEmail(email: "new@a.example", password: "a") }`,
      `mutation { changePassword(current: "a", next: "b") }`,
      `mutation { setSecondFactor(method: "app") { __typename } }`,
      `mutation { regenerateBackupCodes }`,
      `mutation { signOutOtherSessions }`,
      `mutation { switchStore(storeId: "${t.storeA1}") { membershipId } }`,
      `mutation { setPaymentMethod(token: "pm_x") { asOf } }`,
      `mutation { connectGateway(provider: "cod") }`,
      `mutation { connectStripe }`,
      `mutation { finishStripeConnect(key: "k") }`,
      `mutation { connectStoreAiAccount(provider: "anthropic", key: "k") }`,
      `mutation { beginStoreAiOauth(provider: "anthropic") }`,
      `mutation { finishStoreAiOauth(response: "r") }`,
      `mutation { setStoreAiSwitch(on: true) }`,
      `mutation { setStoreAiFallback(on: true) }`,
      `mutation { removeStoreAiAccount }`,
      `mutation { createApiKey(name: "Feed", scopes: ["catalog.read"]) { __typename } }`,
      `mutation { rotateApiKey(id: "${seats.owner}") { __typename } }`,
      `mutation { saveWebhook(url: "https://hooks.example/x", events: ["order.created"]) { id } }`,
      `mutation { installApp(appId: "${seats.owner}", scopes: ["catalog.read"]) }`,
      `mutation { inviteMember(email: "new-owner@a.example", role: "owner") }`,
      `mutation { removeMember(membershipId: "${seats.owner}") }`,
      `mutation { changeRole(membershipId: "${seats.manager}", role: "owner") }`,
    ]
    for (const source of refused) expect((await gql(source, { staff })).code, source).toBe('BLOCKED_WHILE_IMPERSONATING')
    expect((await gql(`mutation($m: ID!) { changeRole(membershipId: $m, role: "staff") }`, { staff }, { m: seats.manager })).code).toBeUndefined()
  })
})

describe('the notice', () => {
  it('tells the store’s people who is in as whom, but not the staff member or a supplier outside the seat', async () => {
    await started('manager', 'tok-notice')
    const staff = await enter('tok-notice')
    expect((await gql<{ staffSessionNotice: unknown }>(notice, { person: 'owner' })).data?.staffSessionNotice).toMatchObject({ kind: 'impersonation', staffName: 'Neha Rao', actingAs: 'Mo Manager' })
    expect((await gql<{ staffSessionNotice: unknown }>(notice, { person: 'supplier' })).data?.staffSessionNotice).toBeNull()
    expect((await gql<{ staffSessionNotice: unknown }>(notice, { staff })).data?.staffSessionNotice).toBeNull()
  })

  it('tells a supplier of its own seat even when a newer session is on the merchant side', async () => {
    await started('supplier', 'tok-supplier')
    await enter('tok-supplier')
    clock = new Date(clock.getTime() + 60_000)
    await started('manager', 'tok-newer', maya)
    await enter('tok-newer')
    expect((await gql<{ staffSessionNotice: unknown }>(notice, { person: 'supplier' })).data?.staffSessionNotice).toMatchObject({ staffName: 'Neha Rao', actingAs: 'Nadia Tran' })
    expect((await gql<{ staffSessionNotice: unknown }>(notice, { person: 'owner' })).data?.staffSessionNotice).toMatchObject({ staffName: 'Maya Ortiz', actingAs: 'Mo Manager' })
  })

  it('never tells another store, which reads its own store from the session, not the client', async () => {
    await started('manager', 'tok-other')
    await enter('tok-other')
    expect((await gql<{ staffSessionNotice: unknown }>(notice, { person: 'a2Owner' })).data?.staffSessionNotice).toBeNull()
  })
})

describe('ending', () => {
  it('ends from the portal, logged as the staff member, and the cookie acts as nobody after', async () => {
    const id = await started('manager', 'tok-end')
    const staff = await enter('tok-end')
    expect((await portal(hosts.a, staffSessionPaths.end, { id }, staff)).status).toBe(200)
    expect((await currentOf(staff)).session).toMatchObject({ state: 'ended', endedBy: 'portal' })
    expect((await contextFor({ staff })).standing.kind).toBe('signed-out')
    expect(await entries(id)).toContainEqual(expect.objectContaining({ action: 'impersonation.ended', actor_kind: 'staff', actor_id: neha }))
    expect((await portal(hosts.a, staffSessionPaths.end, { id }, staff)).status).toBe(400)
  })

  it('ends when the staff member signs out of the portal, and clears the cookie', async () => {
    const id = await started('manager', 'tok-out')
    const staff = await enter('tok-out')
    const response = await handleStoreAuth(
      new Request(`https://${hosts.a}/api/auth/sign-out`, { method: 'POST', headers: { origin: `https://${hosts.a}`, 'cf-connecting-ip': '203.0.113.7', cookie: `${staffCookieName}=${staff}` } }),
      { sql: db.sql, activity: activityLog, partnerId: t.partnerA, host: hosts.a, secrets: null, now: () => clock, allowAttempt: async () => true },
    )
    expect(response.headers.get('set-cookie')).toContain(`${staffCookieName}=;`)
    expect((await currentOf(staff)).session).toMatchObject({ state: 'ended', endedBy: 'portal' })
    expect(await entries(id)).toContainEqual(expect.objectContaining({ action: 'impersonation.ended', actor_kind: 'staff', actor_id: neha }))
  })

  it('ends at its next read once the seat is gone, logged by the job with the reason', async () => {
    const id = await started('manager', 'tok-gone')
    const staff = await enter('tok-gone')
    await db.sql`update membership set status = 'suspended' where id = ${seats.manager}`
    expect((await contextFor({ staff })).standing.kind).toBe('signed-out')
    expect((await currentOf(staff)).session).toMatchObject({ state: 'ended', endedBy: 'targetGone' })
    expect(await entries(id)).toContainEqual(expect.objectContaining({ action: 'impersonation.ended', actor_kind: 'job', reason: 'target_gone' }))
  })

  it('reads as expired once its time is up', async () => {
    await started('manager', 'tok-time')
    const staff = await enter('tok-time')
    clock = new Date(clock.getTime() + 31 * 60_000)
    expect((await currentOf(staff)).session).toMatchObject({ state: 'expired', endedBy: 'expiry' })
    expect((await contextFor({ staff })).standing.kind).toBe('signed-out')
  })
})
