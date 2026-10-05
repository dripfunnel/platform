import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { handleStoreAuth, type StoreAuthDeps } from '#apis/store/auth'
import { storeSchema } from '#apis/store/schema'
import { hashPassword, verifyPassword } from '#auth/password'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { resolveStoreStanding } from '#auth/storeCaller'
import { storeCookieName } from '#auth/storeSession'
import { mintStoreInvitationToken, mintUserResetToken, userPasswordResetRequestKind } from '#auth/storeTokens'
import { withSystemScope } from '#db/scoped/index'
import { userPasswordResetDeliverer } from '#jobs/queues/deliverers/userPasswordReset'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #290 (SAPI 2, part 2): store invitations (/accept-invite, /join) and password reset on a
// partner's portal host, never on another's.

let db: TestDatabase
let t: Tenants
let secrets: SecretBox
const now = new Date('2026-10-05T09:00:00Z')
const host = 'store.partner-a.example'
const hostB = 'store.partner-b.example'
const password = 'correct horse battery'
const day = 86_400_000

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  secrets = await secretBox(btoa('k'.repeat(32)))
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'portal', ${host}, 'live', 'CNAME', 'x'), (${t.partnerB}, 'portal', ${hostB}, 'live', 'CNAME', 'x')`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const deps = (overrides: Partial<StoreAuthDeps> = {}): StoreAuthDeps => ({ sql: db.sql, activity: activityLog, partnerId: t.partnerA, host, secrets, now: () => now, allowAttempt: async () => true, ...overrides })
const onB = () => deps({ partnerId: t.partnerB, host: hostB })

const cookieOf = (response: Response) => /__Host-portal_session=([^;]*)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? ''

const post = async (path: string, body: unknown, cookie = '', d = deps()) => {
  const response = await handleStoreAuth(
    new Request(`https://${d.host}${path}`, { method: 'POST', headers: { origin: `https://${d.host}`, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...(cookie ? { cookie: `${storeCookieName}=${cookie}` } : {}) }, body: JSON.stringify(body) }),
    d,
  )
  return { status: response.status, body: (await response.json()) as Record<string, unknown>, cookie: cookieOf(response), setCookie: response.headers.get('set-cookie') ?? '' }
}

const me = async (cookie: string) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const standing = await resolveStoreStanding(db.sql, new Request(`https://${host}/api/`, { headers: { cookie: `${storeCookieName}=${cookie}` } }), t.partnerA, now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source: '{ me { name email } }', contextValue })
  return (result.data as { me: { name: string; email: string } | null } | null)?.me ?? null
}

const person = async (partnerId: string, email: string, status: 'invited' | 'active', extra: { name?: string; twoFactor?: boolean } = {}) => {
  const [row] = await db.sql<{ id: string }[]>`
    insert into "user" (partner_id, email, name, status, password_hash, two_factor_method, two_factor_enrolled_at, phone)
    values (${partnerId}, ${email}, ${extra.name ?? 'Someone'}, ${status}, ${status === 'active' ? await hashPassword(password) : null}, ${extra.twoFactor ? 'sms' : null}, ${extra.twoFactor ? now : null}, ${extra.twoFactor ? '+16145550190' : null})
    returning id
  `
  return row?.id ?? ''
}

/** An invitation as the inviter's step leaves it: an `invited` membership and the invitation row, with its link minted. */
const invite = async (o: { storeId: string; email: string; role: string; userId: string; sellerId?: string | null }) => {
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${o.userId}, ${o.storeId}, ${o.sellerId ?? null}, ${o.role}, 'invited')`
  const [row] = await db.sql<{ id: string }[]>`
    insert into invitation (store_id, seller_id, email, role_key, expires_at, invited_by_label)
    values (${o.storeId}, ${o.sellerId ?? null}, ${o.email}, ${o.role}, ${new Date(now.getTime() + 7 * day)}, 'Priya Shah') returning id
  `
  const token = await withSystemScope(db.sql, (tx) => mintStoreInvitationToken(tx, row?.id ?? '', now))
  if (!token) throw new Error('invitation token not minted')
  return { id: row?.id ?? '', token }
}

const membershipStatus = async (userId: string, storeId: string) =>
  (await db.sql<{ status: string }[]>`select status from membership where user_id = ${userId} and store_id = ${storeId}`)[0]?.status

describe('looking up an invitation', () => {
  it('says which store, role and path, on the partner’s own host only', async () => {
    const id = await person(t.partnerA, 'lookup@a.example', 'invited')
    const { token } = await invite({ storeId: t.storeA1, email: 'lookup@a.example', role: 'staff', userId: id })
    expect((await post('/api/auth/invitation', { token })).body).toEqual({
      ok: true,
      invitation: { store: 'Store A1', role: 'staff', supplier: null, email: 'lookup@a.example', invitedBy: 'Priya Shah', path: 'new' },
    })
    expect((await post('/api/auth/invitation', { token }, '', onB())).body).toEqual({ ok: false, code: 'INVITATION_INVALID' })
    expect((await post('/api/auth/invitation', { token: 'not-a-token' })).body).toEqual({ ok: false, code: 'INVITATION_INVALID' })
  })

  it('names the inviter on an expired link, and tells a replaced link from a used one', async () => {
    const id = await person(t.partnerA, 'late@a.example', 'invited')
    const expired = await invite({ storeId: t.storeA1, email: 'late@a.example', role: 'staff', userId: id })
    await db.sql`update invitation set expires_at = ${new Date(now.getTime() - day)} where id = ${expired.id}`
    expect((await post('/api/auth/invitation', { token: expired.token })).body).toEqual({ ok: false, code: 'INVITATION_EXPIRED', invitedBy: 'Priya Shah' })
    await db.sql`update invitation set revoked_at = ${now} where id = ${expired.id}`
    await db.sql`insert into invitation (store_id, email, role_key, expires_at, invited_by_label, created_at) values (${t.storeA1}, 'late@a.example', 'staff', ${new Date(now.getTime() + day)}, 'Priya Shah', now() + interval '1 minute')`
    expect((await post('/api/auth/invitation', { token: expired.token })).body).toEqual({ ok: false, code: 'INVITATION_REPLACED' })
  })
})

describe('accepting as a new person', () => {
  it('asks for a name and a long enough password', async () => {
    const id = await person(t.partnerA, 'checks@a.example', 'invited')
    const { token } = await invite({ storeId: t.storeA1, email: 'checks@a.example', role: 'staff', userId: id })
    expect((await post('/api/auth/accept-invitation', { token, name: '  ', password })).body).toEqual({ ok: false, code: 'NAME_REQUIRED' })
    expect((await post('/api/auth/accept-invitation', { token, name: 'Meera', password: 'short' })).body).toEqual({ ok: false, code: 'WEAK_PASSWORD' })
  })

  it('sets the name and password, proves the address, opens the store, and works once', async () => {
    const id = await person(t.partnerA, 'meera@a.example', 'invited')
    const { token } = await invite({ storeId: t.storeA1, email: 'meera@a.example', role: 'staff', userId: id })
    const res = await post('/api/auth/accept-invitation', { token, name: 'Meera Iyer', password })
    expect(res.body).toEqual({ ok: true, step: 'done' })
    expect(await me(res.cookie)).toEqual({ name: 'Meera Iyer', email: 'meera@a.example' })
    expect(await membershipStatus(id, t.storeA1)).toBe('active')
    const [u] = await db.sql<{ status: string; email_verified_at: Date | null }[]>`select status, email_verified_at from "user" where id = ${id}`
    expect(u?.status).toBe('active')
    expect(u?.email_verified_at).not.toBeNull()
    const [entry] = await db.sql<{ store_id: string; visibility: string; reason: string }[]>`select store_id, visibility, reason from activity_log where action = 'person.invitation_accepted' and actor_id = ${id}`
    expect(entry).toEqual({ store_id: t.storeA1, visibility: 'store', reason: 'staff' })
    expect((await post('/api/auth/accept-invitation', { token, name: 'Meera Iyer', password })).body).toEqual({ ok: false, code: 'INVITATION_USED' })
  })

  it('holds a new Owner at 2-factor set-up before the store opens', async () => {
    const id = await person(t.partnerA, 'new.owner@a.example', 'invited')
    const { token } = await invite({ storeId: t.storeA2, email: 'new.owner@a.example', role: 'owner', userId: id })
    const res = await post('/api/auth/accept-invitation', { token, name: 'New Owner', password })
    expect(res.body).toEqual({ ok: true, step: 'enrol' })
    expect(res.setCookie).toContain('Max-Age=600')
    expect(await me(res.cookie)).toBeNull()
  })

  it('never sets a password on an existing account through a join link', async () => {
    const id = await person(t.partnerA, 'existing@a.example', 'active')
    const { token } = await invite({ storeId: t.storeA2, email: 'existing@a.example', role: 'staff', userId: id })
    expect((await post('/api/auth/accept-invitation', { token, name: 'Intruder', password: 'a different password' })).body).toEqual({ ok: false, code: 'INVITATION_INVALID' })
    const [u] = await db.sql<{ password_hash: string; name: string }[]>`select password_hash, name from "user" where id = ${id}`
    expect(await verifyPassword(password, u?.password_hash ?? null)).toBe(true)
    expect(u?.name).toBe('Someone')
  })
})

describe('joining with an existing account', () => {
  const signIn = async (email: string) => (await post('/api/auth/sign-in', { email, password })).cookie

  it('needs the invited account’s own session: no session, or someone else’s, is refused', async () => {
    const id = await person(t.partnerA, 'joiner@a.example', 'active')
    await person(t.partnerA, 'bystander@a.example', 'active')
    const { token } = await invite({ storeId: t.storeA2, email: 'joiner@a.example', role: 'manager', userId: id })
    expect((await post('/api/auth/join', { token })).body).toEqual({ ok: false, code: 'INVALID_CREDENTIALS' })
    expect((await post('/api/auth/join', { token }, await signIn('bystander@a.example'))).body).toEqual({ ok: false, code: 'INVITATION_INVALID' })
    expect(await membershipStatus(id, t.storeA2)).toBe('invited')
    const own = await signIn('joiner@a.example')
    expect((await post('/api/auth/join', { token }, own)).body).toEqual({ ok: true, step: 'done' })
    expect(await membershipStatus(id, t.storeA2)).toBe('active')
  })

  it('holds someone joining as an Owner without 2-factor at set-up', async () => {
    const id = await person(t.partnerA, 'promoted@a.example', 'active')
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${id}, ${t.storeA1}, 'staff', 'active')`
    const { token } = await invite({ storeId: t.storeA2, email: 'promoted@a.example', role: 'owner', userId: id })
    const cookie = await signIn('promoted@a.example')
    const res = await post('/api/auth/join', { token }, cookie)
    expect(res.body).toEqual({ ok: true, step: 'enrol' })
    expect(await me(cookie)).toBeNull()
  })

  it('never joins a link from another partner’s host', async () => {
    const id = await person(t.partnerA, 'wanderer@a.example', 'active')
    const { token } = await invite({ storeId: t.storeA1, email: 'wanderer@a.example', role: 'staff', userId: id })
    expect((await post('/api/auth/join', { token }, await signIn('wanderer@a.example'), onB())).body).toEqual({ ok: false, code: 'INVALID_CREDENTIALS' })
  })
})

describe('resetting a password', () => {
  const relayResets = () => relayDue(db.sql, { [userPasswordResetRequestKind]: userPasswordResetDeliverer(db.sql) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
  const resetsOf = async (userId: string) => db.sql<{ id: string }[]>`select id from user_password_reset where user_id = ${userId} order by created_at desc`

  it('answers the same for an unknown email, and writes a reset only for the host partner’s account', async () => {
    const a = await person(t.partnerA, 'shared@both.example', 'active')
    const b = await person(t.partnerB, 'shared@both.example', 'active')
    const known = await post('/api/auth/request-password-reset', { email: 'Shared@Both.example' })
    const unknown = await post('/api/auth/request-password-reset', { email: 'nobody@a.example' })
    expect(known.body).toEqual({ ok: true })
    expect(unknown.body).toEqual(known.body)
    await relayResets()
    expect(await resetsOf(a)).toHaveLength(1)
    expect(await resetsOf(b)).toHaveLength(0)
    const [email] = await db.sql<{ payload: { template: string; to: string } }[]>`select payload from outbox where kind = 'email' and payload->>'template' = 'user-password-reset'`
    expect(email?.payload).toMatchObject({ template: 'user-password-reset', to: 'shared@both.example' })
  })

  it('refuses past the per-address limit without saying whether the account exists', async () => {
    expect((await post('/api/auth/request-password-reset', { email: 'x@a.example' }, '', deps({ allowAttempt: async (key) => !key.includes(':reset:') }))).body).toEqual({ ok: false, code: 'RATE_LIMITED' })
  })

  it('works once, ends every other session, and signs in here as far as 2-factor allows', async () => {
    const id = await person(t.partnerA, 'forgetful@a.example', 'active', { twoFactor: true })
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${id}, ${t.storeA1}, 'staff', 'active')`
    const elsewhere = (await post('/api/auth/sign-in', { email: 'forgetful@a.example', password })).cookie
    await post('/api/auth/request-password-reset', { email: 'forgetful@a.example' })
    await relayResets()
    const [reset] = await resetsOf(id)
    const token = (await withSystemScope(db.sql, (tx) => mintUserResetToken(tx, reset?.id ?? '', now))) ?? ''
    expect((await post('/api/auth/reset-password', { token, password: 'short' })).body).toEqual({ ok: false, code: 'WEAK_PASSWORD' })
    expect((await post('/api/auth/reset-password', { token, password: 'a brand new passphrase' }, '', onB())).body).toEqual({ ok: false, code: 'RESET_INVALID' })
    const res = await post('/api/auth/reset-password', { token, password: 'a brand new passphrase' })
    expect(res.body).toEqual({ ok: true, step: 'second-factor', method: 'sms' })
    // Only the session this reset opened is left: the one from before is gone.
    const [left] = await db.sql<{ n: number }[]>`select count(*)::int as n from user_session where user_id = ${id}`
    expect(left?.n).toBe(1)
    expect(elsewhere).not.toBe('')
    expect((await post('/api/auth/reset-password', { token, password: 'another new passphrase' })).body).toEqual({ ok: false, code: 'RESET_INVALID' })
    expect((await post('/api/auth/sign-in', { email: 'forgetful@a.example', password: 'a brand new passphrase' })).body).toMatchObject({ ok: true, step: 'second-factor' })
  })

  it('lifts a sign-in pause, as the locked screen promises', async () => {
    const id = await person(t.partnerA, 'paused@a.example', 'active')
    await db.sql`update "user" set locked_until = ${new Date(now.getTime() + 15 * 60_000)}, failed_code_count = 5 where id = ${id}`
    await post('/api/auth/request-password-reset', { email: 'paused@a.example' })
    await relayResets()
    const [reset] = await resetsOf(id)
    const token = (await withSystemScope(db.sql, (tx) => mintUserResetToken(tx, reset?.id ?? '', now))) ?? ''
    expect((await post('/api/auth/reset-password', { token, password: 'a brand new passphrase' })).body).toEqual({ ok: true, step: 'done' })
  })
})
