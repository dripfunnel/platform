import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import { createPartnerSession } from '#auth/partnerSession'
import { hashPassword, verifyPassword } from '#auth/password'
import { hashSessionId } from '#auth/session'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createPartnerProfileService } from '#saas/partnerProfile/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #1053: My profile in the partner console, the signed-in user's own name and password.

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-31T09:00:00Z')
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }
const password = 'correct horse battery'
const ids = { maya: '', jess: '', bea: '' }

const userOf = async (partnerId: string, email: string, name: string, role = 'partner-admin') =>
  (await db.sql<{ id: string }[]>`insert into partner_user (partner_id, email, name, role_key, status, password_hash) values (${partnerId}, ${email}, ${name}, ${role}, 'active', ${await hashPassword(password)}) returning id`)[0]?.id ?? ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  ids.maya = await userOf(t.partnerA, 'maya@partner-a.example', 'Maya Chen')
  ids.jess = await userOf(t.partnerA, 'jess@partner-a.example', 'Jess Park', 'partner-read-only')
  ids.bea = await userOf(t.partnerB, 'bea@partner-b.example', 'Bea Owner')
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

beforeEach(async () => {
  await db.sql`update partner_user set failed_code_count = 0, locked_until = null`
})

const callerOf = (userId: string, partnerId = t.partnerA, staff: 'impersonation' | 'setup' | null = null): PartnerCaller => ({
  role: 'partner-admin',
  user: staff === 'setup' ? null : { id: userId, name: 'Maya Chen', email: 'maya@partner-a.example' },
  staff: staff ? { id: crypto.randomUUID(), name: 'Priya Shah', email: 'priya@dripfunnel.example', session: { kind: staff, id: crypto.randomUUID(), expiresAt: new Date('2026-10-31T11:00:00Z') } } : null,
  partner: { id: partnerId, name: 'Northstar Commerce', product: 'Northstar Shops', host: null, state: 'live' },
})

const run = async <T,>(source: string, caller: PartnerCaller, variables: Record<string, unknown>, sessionId: string | null = null) => {
  const profile = createPartnerProfileService({ sql: db.sql, caller, facts, activity: activityLog, sessionId, now: () => now })
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue: { caller, profile } })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const rename = `mutation($name: String!) { updateMyName(name: $name) { ok reason } }`
const change = `mutation($current: String!, $password: String!) { changeMyPassword(current: $current, password: $password) { ok reason triesLeft minutes } }`
type Renamed = { updateMyName: { ok: boolean; reason: string | null } }
type Changed = { changeMyPassword: { ok: boolean; reason: string | null; triesLeft: number | null; minutes: number | null } }

const row = async (id: string) => (await db.sql<{ name: string; password_hash: string; locked_until: Date | null }[]>`select name, password_hash, locked_until from partner_user where id = ${id}`)[0]
const entries = async (action: string) => db.sql<{ actor_id: string; target_id: string; reason: string | null; changes: unknown }[]>`select actor_id, target_id, reason, changes from activity_log where action = ${action}`

describe('changing your name', () => {
  it('saves it for any role, trimmed, and logs who changed whose without the name', async () => {
    expect((await run<Renamed>(rename, callerOf(ids.jess), { name: '  Jess Park-Lee  ' })).data?.updateMyName).toEqual({ ok: true, reason: null })
    expect((await row(ids.jess))?.name).toBe('Jess Park-Lee')
    const [entry] = await entries('partner_user.name_changed')
    expect(entry).toMatchObject({ actor_id: ids.jess, target_id: ids.jess })
    expect(JSON.stringify(entry)).not.toContain('Park-Lee')
  })

  it('refuses an empty name or one over 80 characters', async () => {
    for (const name of ['   ', 'x'.repeat(81)]) expect((await run<Renamed>(rename, callerOf(ids.maya), { name })).data?.updateMyName).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    expect((await row(ids.maya))?.name).toBe('Maya Chen')
  })
})

describe('changing your password', () => {
  it('needs the current one, ends every other session of yours and keeps this one, and logs no password', async () => {
    const sessions = await withSystemScope(db.sql, async (tx) => [await createPartnerSession(tx, ids.maya, now), await createPartnerSession(tx, ids.maya, now), await createPartnerSession(tx, ids.jess, now)])
    const [mine, other, jess] = sessions
    const answer = await run<Changed>(change, callerOf(ids.maya), { current: password, password: 'a brand new password' }, mine ?? null)
    expect(answer.data?.changeMyPassword).toEqual({ ok: true, reason: null, triesLeft: null, minutes: null })
    expect(await verifyPassword('a brand new password', (await row(ids.maya))?.password_hash ?? null)).toBe(true)
    const left = (await db.sql<{ id_hash: string }[]>`select id_hash from partner_session`).map((s) => s.id_hash)
    expect(left).toContain(await hashSessionId(mine ?? ''))
    expect(left).not.toContain(await hashSessionId(other ?? ''))
    expect(left).toContain(await hashSessionId(jess ?? ''))
    expect(JSON.stringify(await entries('partner_user.password_changed'))).not.toContain('brand new')
    await db.sql`update partner_user set password_hash = ${await hashPassword(password)} where id = ${ids.maya}`
  })

  it('refuses a new password under 10 characters', async () => {
    expect((await run<Changed>(change, callerOf(ids.maya), { current: password, password: 'short' })).data?.changeMyPassword.reason).toBe('WEAK_PASSWORD')
  })

  it('counts a wrong current password toward the sign-in lock, and refuses even the right one while locked', async () => {
    const wrong = await run<Changed>(change, callerOf(ids.maya), { current: 'not my password', password: 'a brand new password' })
    expect(wrong.data?.changeMyPassword).toEqual({ ok: false, reason: 'WRONG_PASSWORD', triesLeft: 4, minutes: null })
    for (let i = 0; i < 4; i += 1) await run(change, callerOf(ids.maya), { current: 'not my password', password: 'a brand new password' })
    expect((await row(ids.maya))?.locked_until).not.toBeNull()
    const locked = await run<Changed>(change, callerOf(ids.maya), { current: password, password: 'a brand new password' })
    expect(locked.data?.changeMyPassword).toMatchObject({ ok: false, reason: 'LOCKED', minutes: 15 })
    expect(await verifyPassword(password, (await row(ids.maya))?.password_hash ?? null)).toBe(true)
  })
})

describe('who may', () => {
  it('refuses both changes to a staff impersonation or setup session, which change nothing', async () => {
    const before = await row(ids.maya)
    expect((await run(rename, callerOf(ids.maya, t.partnerA, 'impersonation'), { name: 'Hijacked' })).code).toBe('BLOCKED_WHILE_IMPERSONATING')
    expect((await run(change, callerOf(ids.maya, t.partnerA, 'impersonation'), { current: password, password: 'a brand new password' })).code).toBe('BLOCKED_WHILE_IMPERSONATING')
    expect((await run(rename, callerOf(ids.maya, t.partnerA, 'setup'), { name: 'Hijacked' })).code).toBe('PARTNER_ENTERS_THIS_ITSELF')
    expect((await run(change, callerOf(ids.maya, t.partnerA, 'setup'), { current: password, password: 'a brand new password' })).code).toBe('PARTNER_ENTERS_THIS_ITSELF')
    expect(await row(ids.maya)).toEqual(before)
  })

  it('never changes a user of another partner, whatever the caller claims', async () => {
    const before = await row(ids.bea)
    expect((await run<Renamed>(rename, callerOf(ids.bea, t.partnerA), { name: 'Not Bea' })).data?.updateMyName.reason).toBe('NOT_FOUND')
    expect((await run<Changed>(change, callerOf(ids.bea, t.partnerA), { current: password, password: 'a brand new password' })).data?.changeMyPassword.reason).toBe('NOT_FOUND')
    expect(await row(ids.bea)).toEqual(before)
  })
})
