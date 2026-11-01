import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveStaff } from '#auth/caller'
import { resolvePartner } from '#auth/partnerCaller'
import { createPartnerSession, idleMs as partnerIdleMs, partnerCookieName } from '#auth/partnerSession'
import { cookieName as staffCookieName, createSession, hashSessionId, idleMs as staffIdleMs, lastSeenWriteMs } from '#auth/session'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, idleMs as storeIdleMs, rememberIdleMs, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// #1124: system scope's role and scope in one statement, and each console's person session check in one query, with every
// rule the separate reads had (ACCESS.md §3, §4; DATA-MODEL.md §5.3).

let db: TestDatabase
let t: Tenants
let sent: string[] = []
let counted: postgres.Sql
let ravi = ''
let sunil = ''
let asha = ''
let priya = ''

const start = new Date('2026-11-01T09:00:00Z')
const at = (ms: number) => new Date(start.getTime() + ms)
const facts = { requestId: null, ip: '203.0.113.1', userAgent: 'test' }

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  counted = postgres(db.url, { max: 1, fetch_types: false, debug: (_c, query) => void sent.push(query.replaceAll(/\s+/g, ' ').trim()) })
  const one = async (q: Promise<{ id: string }[]>) => {
    const [row] = await q
    if (!row) throw new Error('fixture insert returned no row')
    return row.id
  }
  ravi = await one(db.sql`insert into "user" (partner_id, email, name, status, password_hash) values (${t.partnerA}, 'ravi@a.example', 'Ravi', 'active', 'x') returning id`)
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${ravi}, ${t.storeA1}, 'owner', 'active')`
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${ravi}, ${t.storeA2}, 'owner', 'active')`
  sunil = await one(db.sql`insert into "user" (partner_id, email, name, status, password_hash) values (${t.partnerA}, 'sunil@a.example', 'Sunil', 'active', 'x') returning id`)
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${sunil}, ${t.storeA1}, ${t.sellerA1First}, 'supplier-admin', 'active')`
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${sunil}, ${t.storeA1}, ${t.sellerA1Second}, 'supplier-admin', 'active')`
  asha = await one(db.sql`insert into partner_user (partner_id, email, name, role_key, status) values (${t.partnerA}, 'asha@a.example', 'Asha', 'partner-owner', 'active') returning id`)
  priya = await one(db.sql`insert into staff_user (sso_subject, email, name, role_key, status) values ('sub-1124', 'priya@softobotics.com', 'Priya', 'staff-read-only', 'active') returning id`)
}, 60_000)

afterAll(async () => {
  await counted?.end()
  await db?.drop()
})

const storeRequest = (cookie: string, headers: Record<string, string> = {}) => new Request('https://store.example/api/', { headers: { cookie: `${storeCookieName}=${cookie}`, ...headers } })
const standing = (cookie: string, now: Date, headers?: Record<string, string>, sql: postgres.Sql = db.sql) =>
  resolveStoreStanding(sql, storeRequest(cookie, headers), t.partnerA, now, activityLog, facts)
const storeSession = (now: Date, options: { remember?: boolean } = {}, user = ravi, partnerId = t.partnerA) =>
  withSystemScope(db.sql, (tx) => createUserSession(tx, { id: user, partnerId }, now, options))

describe('withSystemScope (C2)', () => {
  it('runs the work as app_system in system scope, set in one statement with no parameters, reset afterwards', async () => {
    sent = []
    const inside = await withSystemScope(counted, async (tx) => (await tx<{ role: string; scope: string }[]>`select current_user::text as role, current_setting('app.scope') as scope`)[0])
    expect(inside).toEqual({ role: 'app_system', scope: 'system' })
    expect(sent.filter((q) => q.includes('set_config') || q.includes('set local role'))).toEqual(["select set_config('role', 'app_system', true), set_config('app.scope', 'system', true)"])
    const [after] = await counted<{ scope: string | null }[]>`select current_setting('app.scope', true) as scope`
    expect(after?.scope ?? '').toBe('')
  })
})

describe('the store portal’s session check (C1)', () => {
  it('finds the person and their seat in the store asked for, in one statement after the setup', async () => {
    const cookie = await storeSession(start)
    sent = []
    const s = await standing(cookie, at(1000), { [storeHeader]: t.storeA1 }, counted)
    expect(s).toMatchObject({ kind: 'acting', person: { id: ravi, name: 'Ravi' }, caller: { store: { id: t.storeA1 }, role: { side: 'merchant' } } })
    const work = sent.filter((q) => !['begin', 'commit'].includes(q) && !q.includes('set_config'))
    expect(work).toHaveLength(1)
  })

  it('reads a missing, expired, idle, half-signed-in or another partner’s session as signed out', async () => {
    expect(await standing('no-such-session', start)).toEqual({ kind: 'signed-out' })
    const cookie = await storeSession(start)
    expect(await standing(cookie, at(storeIdleMs + 1000), { [storeHeader]: t.storeA1 })).toEqual({ kind: 'signed-out' })
    const pending = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: ravi, partnerId: t.partnerA }, start, { stage: 'second-factor' }))
    expect(await standing(pending, at(1000), { [storeHeader]: t.storeA1 })).toEqual({ kind: 'signed-out' })
    const fresh = await storeSession(start)
    expect(await resolveStoreStanding(db.sql, storeRequest(fresh, { [storeHeader]: t.storeA1 }), t.partnerB, at(1000), activityLog, facts)).toEqual({ kind: 'signed-out' })
  })

  it('keeps "remember me" sessions to their own, longer idle limit', async () => {
    const remembered = await storeSession(start, { remember: true })
    expect(await standing(remembered, at(storeIdleMs + 1000), { [storeHeader]: t.storeA1 })).toMatchObject({ kind: 'acting' })
    const untouched = await storeSession(start, { remember: true })
    expect(await standing(untouched, at(rememberIdleMs + 1000), { [storeHeader]: t.storeA1 })).toEqual({ kind: 'signed-out' })
  })

  it('reads a suspended person as signed out', async () => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status, password_hash) values (${t.partnerA}, 'gone@a.example', 'Gone', 'suspended', 'x') returning id`
    const cookie = await storeSession(start, {}, u?.id ?? '')
    expect(await standing(cookie, at(1000), { [storeHeader]: t.storeA1 })).toEqual({ kind: 'signed-out' })
  })

  it('finds the person with no store asked, and with a header that isn’t a store id, without an error', async () => {
    const cookie = await storeSession(start)
    expect(await standing(cookie, at(1000))).toMatchObject({ kind: 'no-store', person: { id: ravi } })
    expect(await standing(cookie, at(1000), { [storeHeader]: 'not-a-uuid' })).toMatchObject({ kind: 'crossing', person: { id: ravi } })
  })

  it('reads a store not held and a closed store as a crossing, logged once per request', async () => {
    const cookie = await storeSession(start)
    const crossings = async () => Number((await db.sql<{ n: string }[]>`select count(*) as n from activity_log where action = 'store.crossing_refused' and actor_id = ${ravi}`)[0]?.n)
    const before = await crossings()
    expect(await standing(cookie, at(1000), { [storeHeader]: t.storeB1 })).toMatchObject({ kind: 'crossing' })
    expect(await crossings()).toBe(before + 1)
    const [was] = await db.sql<{ status: string }[]>`select status from store where id = ${t.storeA2}`
    await db.sql`update store set status = 'closed' where id = ${t.storeA2}`
    expect(await standing(cookie, at(3000), { [storeHeader]: t.storeA2 })).toMatchObject({ kind: 'crossing' })
    await db.sql`update store set status = ${was?.status ?? 'active'} where id = ${t.storeA2}`
  })

  it('gives a person with two supplier seats the one asked for, asks which when none is named, and drops a suspended supplier’s', async () => {
    const cookie = await storeSession(start, {}, sunil)
    expect(await standing(cookie, at(1000), { [storeHeader]: t.storeA1 })).toMatchObject({ kind: 'supplier-required' })
    expect(await standing(cookie, at(1000), { [storeHeader]: t.storeA1, [supplierHeader]: t.sellerA1Second })).toMatchObject({ kind: 'acting', caller: { seller: { id: t.sellerA1Second } } })
    await db.sql`update seller set status = 'suspended' where id = ${t.sellerA1First}`
    expect(await standing(cookie, at(2000), { [storeHeader]: t.storeA1, [supplierHeader]: t.sellerA1First })).toMatchObject({ kind: 'supplier-required' })
    expect(await standing(cookie, at(2000), { [storeHeader]: t.storeA1 })).toMatchObject({ kind: 'acting', caller: { seller: { id: t.sellerA1Second } } })
    await db.sql`update seller set status = 'active' where id = ${t.sellerA1First}`
  })

  it('moves last-seen on only once it is stale', async () => {
    const cookie = await storeSession(start)
    const idHash = await hashSessionId(cookie)
    const lastSeen = async () => (await db.sql<{ at: Date }[]>`select last_seen_at as at from user_session where id_hash = ${idHash}`)[0]?.at.getTime()
    await standing(cookie, at(1000), { [storeHeader]: t.storeA1 })
    expect(await lastSeen()).toBe(start.getTime())
    await standing(cookie, at(lastSeenWriteMs + 1000), { [storeHeader]: t.storeA1 })
    expect(await lastSeen()).toBe(at(lastSeenWriteMs + 1000).getTime())
  })
})

describe('the partner console’s session check (C1)', () => {
  const request = (cookie: string) => new Request('https://platform.example/api/', { headers: { cookie: `${partnerCookieName}=${cookie}` } })

  it('finds the partner user in one statement after the setup', async () => {
    const cookie = await withSystemScope(db.sql, (tx) => createPartnerSession(tx, asha, start))
    sent = []
    expect(await resolvePartner(counted, request(cookie), at(1000), activityLog)).toMatchObject({ role: 'partner-owner', user: { id: asha }, staff: null, partner: { id: t.partnerA } })
    expect(sent.filter((q) => !['begin', 'commit'].includes(q) && !q.includes('set_config'))).toHaveLength(1)
  })

  it('reads an idle session, a suspended user and a closed partner as no session', async () => {
    const cookie = await withSystemScope(db.sql, (tx) => createPartnerSession(tx, asha, start))
    expect(await resolvePartner(db.sql, request(cookie), at(partnerIdleMs + 1000), activityLog)).toBeNull()
    const live = await withSystemScope(db.sql, (tx) => createPartnerSession(tx, asha, start))
    await db.sql`update partner_user set status = 'suspended' where id = ${asha}`
    expect(await resolvePartner(db.sql, request(live), at(1000), activityLog)).toBeNull()
    await db.sql`update partner_user set status = 'active' where id = ${asha}`
    const [was] = await db.sql<{ state: string }[]>`select state from partner where id = ${t.partnerA}`
    await db.sql`update partner set state = 'closed' where id = ${t.partnerA}`
    expect(await resolvePartner(db.sql, request(live), at(1000), activityLog)).toBeNull()
    await db.sql`update partner set state = ${was?.state ?? 'draft'} where id = ${t.partnerA}`
  })
})

describe('the admin console’s session check (C1)', () => {
  const request = (cookie: string) => new Request('https://admin.example/api/', { headers: { cookie: `${staffCookieName}=${cookie}` } })

  it('finds the staff member in one statement after the setup, with whether their credential is fresh', async () => {
    const cookie = await withSystemScope(db.sql, (tx) => createSession(tx, priya, start))
    sent = []
    expect(await resolveStaff(counted, request(cookie), at(1000))).toMatchObject({ staff: { id: priya, role: 'staff-read-only' }, reauthFresh: expect.any(Boolean) })
    expect(sent.filter((q) => !['begin', 'commit'].includes(q) && !q.includes('set_config'))).toHaveLength(1)
  })

  it('reads an idle session and a suspended staff member as no session', async () => {
    const cookie = await withSystemScope(db.sql, (tx) => createSession(tx, priya, start))
    expect(await resolveStaff(db.sql, request(cookie), at(staffIdleMs + 1000))).toBeNull()
    const live = await withSystemScope(db.sql, (tx) => createSession(tx, priya, start))
    await db.sql`update staff_user set status = 'suspended' where id = ${priya}`
    expect(await resolveStaff(db.sql, request(live), at(1000))).toBeNull()
    await db.sql`update staff_user set status = 'active' where id = ${priya}`
  })
})
