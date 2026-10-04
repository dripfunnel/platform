import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handlePlatformAuth } from '#apis/platform/auth'
import { platformSchema } from '#apis/platform/schema'
import { resolvePartner, type PartnerCaller } from '#auth/partnerCaller'
import { createPartnerSession, idleMs, partnerCookieName } from '#auth/partnerSession'
import { withScope, withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #155: the partner caller from its cookie, `me`, sign-out, and app_partner's reach.

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-03T09:00:00Z')
const host = 'platform.dripfunnel.com'
const users: Record<'ownerA' | 'suspendedA' | 'ownerB', string> = { ownerA: '', suspendedA: '', ownerB: '' }

const userIn = async (partnerId: string, email: string, status: string) => {
  const [row] = await db.sql<{ id: string }[]>`
    insert into partner_user (partner_id, email, name, role_key, status)
    values (${partnerId}, ${email}, ${email.split('@')[0] ?? email}, 'partner-owner', ${status}) returning id
  `
  if (!row) throw new Error('fixture insert returned no row')
  return row.id
}

const sessionFor = (userId: string, at: Date = now) => withSystemScope(db.sql, (tx) => createPartnerSession(tx, userId, at))

const request = (cookie: string | null, init: RequestInit = {}) =>
  new Request(`https://${host}/api`, { ...init, headers: { ...(cookie ? { cookie: `${partnerCookieName}=${cookie}` } : {}), ...init.headers } })

const me = async (caller: PartnerCaller | null) =>
  (await graphql({ schema: platformSchema as GraphQLSchema, source: '{ me { id email role partner { id name product host state } } }', contextValue: { caller } })).data?.['me']

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set product_name = 'Northstar Shops' where id = ${t.partnerA}`
  await db.sql`update partner set sent_back_reason = 'Logo too small' where id = ${t.partnerB}`
  await db.sql`
    insert into partner_domain (partner_id, kind, host, status, record_type, expected)
    values (${t.partnerA}, 'portal', 'store.northstar.example', 'live', 'CNAME', 'portal.dripfunnel.com')
  `
  users.ownerA = await userIn(t.partnerA, 'maya@northstar.example', 'active')
  users.suspendedA = await userIn(t.partnerA, 'sam@northstar.example', 'suspended')
  users.ownerB = await userIn(t.partnerB, 'jonas@kaufladen.example', 'active')
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('the partner caller', () => {
  it('is the session’s user and partner, and `me` says so', async () => {
    const caller = await resolvePartner(db.sql, request(await sessionFor(users.ownerA)), now, activityLog)
    expect(await me(caller)).toEqual({
      id: users.ownerA,
      email: 'maya@northstar.example',
      role: 'partner-owner',
      partner: { id: t.partnerA, name: 'Partner A', product: 'Northstar Shops', host: 'store.northstar.example', state: 'draft' },
    })
  })

  it('reads another partner’s session as that partner only: a sent-back draft says so', async () => {
    const caller = await resolvePartner(db.sql, request(await sessionFor(users.ownerB)), now, activityLog)
    expect(caller?.partner.id).toBe(t.partnerB)
    expect(caller?.partner.state).toBe('sentback')
    expect(JSON.stringify(await me(caller))).not.toContain(t.partnerA)
  })

  it('is nobody without a cookie, with an unknown one, after the idle bound, when suspended or closed', async () => {
    expect(await me(null)).toBeNull()
    expect(await resolvePartner(db.sql, request(null), now, activityLog)).toBeNull()
    expect(await resolvePartner(db.sql, request('not-a-session'), now, activityLog)).toBeNull()
    const stale = await sessionFor(users.ownerA, new Date(now.getTime() - idleMs - 1000))
    expect(await resolvePartner(db.sql, request(stale), now, activityLog)).toBeNull()
    expect(await resolvePartner(db.sql, request(await sessionFor(users.suspendedA)), now, activityLog)).toBeNull()
    const closing = await sessionFor(users.ownerB)
    await db.sql`update partner set state = 'closed' where id = ${t.partnerB}`
    try {
      expect(await resolvePartner(db.sql, request(closing), now, activityLog)).toBeNull()
    } finally {
      await db.sql`update partner set state = 'draft' where id = ${t.partnerB}`
    }
  })
})

describe('sign-out', () => {
  const signOut = (cookie: string, init: RequestInit = {}) =>
    handlePlatformAuth(
      new Request(`https://${host}/api/auth/sign-out`, { method: 'POST', ...init, headers: { cookie: `${partnerCookieName}=${cookie}`, origin: `https://${host}`, ...init.headers } }),
      { sql: db.sql, activity: activityLog, platformHost: host, secrets: null, now: () => now, allowAttempt: async () => true },
    )

  it('ends the session, clears the cookie and logs it against the partner', async () => {
    const id = await sessionFor(users.ownerA)
    const response = await signOut(id)
    expect(response.status).toBe(302)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(await resolvePartner(db.sql, request(id), now, activityLog)).toBeNull()
    const [entry] = await db.sql<{ actor_kind: string; actor_id: string; partner_id: string; visibility: string; api: string }[]>`
      select actor_kind, actor_id, partner_id, visibility, api from activity_log where action = 'partner_user.signed_out'
    `
    expect(entry).toEqual({ actor_kind: 'partner_user', actor_id: users.ownerA, partner_id: t.partnerA, visibility: 'partner', api: 'platform' })
  })

  it('refuses another origin and a GET, leaving the session live', async () => {
    const id = await sessionFor(users.ownerA)
    expect((await signOut(id, { headers: { origin: 'https://evil.example' } })).status).toBe(403)
    expect((await signOut(id, { method: 'GET' })).status).toBe(405)
    expect(await resolvePartner(db.sql, request(id), now, activityLog)).not.toBeNull()
  })
})

describe('app_partner', () => {
  const partnerA = { caller: { kind: 'partner-user' as const, partnerUserId: 'pu' }, partnerId: '' }

  it('sees its own partner and team, and never a session hash', async () => {
    const context = { ...partnerA, partnerId: t.partnerA }
    expect(await withScope(db.sql, context, async (tx) => (await tx<{ role: string }[]>`select current_user as role`)[0]?.role)).toBe('app_partner')
    expect(await withScope(db.sql, context, async (tx) => (await tx<{ id: string }[]>`select id from partner`).map((r) => r.id))).toEqual([t.partnerA])
    const team = await withScope(db.sql, context, async (tx) => (await tx<{ id: string }[]>`select id from partner_user order by email`).map((r) => r.id))
    expect(team.sort()).toEqual([users.ownerA, users.suspendedA].sort())
    await expect(withScope(db.sql, context, (tx) => tx`select id_hash from partner_session`)).rejects.toThrow(/permission denied/i)
    await expect(withScope(db.sql, context, (tx) => tx`select password_hash from partner_user`)).rejects.toThrow(/permission denied/i)
  })

  it('adds a team member without a password, a secret or a token (#207 review)', async () => {
    const context = { ...partnerA, partnerId: t.partnerA }
    await expect(
      withScope(db.sql, context, (tx) => tx`insert into partner_user (partner_id, email, name, role_key, status, password_hash) values (${t.partnerA}, 'eve@northstar.example', 'Eve', 'partner-owner', 'active', 'x')`),
    ).rejects.toThrow(/permission denied/i)
    await expect(
      withScope(db.sql, context, (tx) => tx`insert into partner_user (partner_id, email, name, role_key, status, two_factor_secret_enc) values (${t.partnerA}, 'eve@northstar.example', 'Eve', 'partner-owner', 'active', 'x')`),
    ).rejects.toThrow(/permission denied/i)
    const [invited] = await withScope(db.sql, context, (tx) => tx<{ id: string }[]>`insert into partner_user (partner_id, email, name, role_key, status) values (${t.partnerA}, 'eve@northstar.example', 'Eve', 'partner-admin', 'invited') returning id`)
    await expect(
      withScope(db.sql, context, (tx) => tx`insert into partner_invitation (partner_id, partner_user_id, token_hash, invited_by_kind, invited_by_label) values (${t.partnerA}, ${invited?.id ?? ''}, 'h', 'partner_user', 'Maya')`),
    ).rejects.toThrow(/permission denied/i)
  })

  it('may not approve, pause or re-house itself, nor leave a state but by submitting (#214)', async () => {
    const context = { ...partnerA, partnerId: t.partnerA }
    const write = (set: string) => withScope(db.sql, context, (tx) => tx.unsafe(`update partner set ${set} where id = '${t.partnerA}'`))
    await expect(write(`state = 'live'`)).rejects.toThrow(/may only submit itself/)
    await expect(write(`approved_at = now()`)).rejects.toThrow(/may only submit itself/)
    await expect(write(`pause_reason = 'x'`)).rejects.toThrow(/may only submit itself/)
    await expect(write(`is_house = true`)).rejects.toThrow(/permission denied/i)
    await expect(write(`state = 'awaiting'`)).resolves.toBeDefined()
    await db.sql`update partner set state = 'draft' where id = ${t.partnerA}`
    await expect(write(`product_name = 'Northstar Shops'`)).resolves.toBeDefined()
  })
})
