import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handlePlatformAuth, type PlatformAuthDeps } from '#apis/platform/auth'
import { resolvePartner } from '#auth/partnerCaller'
import { createPartnerSession, partnerCookieName } from '#auth/partnerSession'
import { mintInvitationToken, mintResetToken, passwordResetRequestKind } from '#auth/partnerTokens'
import { secretBox } from '#auth/secretBox'
import { withSystemScope } from '#db/scoped/index'
import { partnerPasswordResetDeliverer } from '#jobs/queues/deliverers/partnerPasswordReset'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #208: accepting a partner invitation, skipping 2-factor, and resetting a password.

let db: TestDatabase
let t: Tenants
let now = new Date('2026-10-03T09:00:00Z')
const host = 'platform.dripfunnel.com'
const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
let secrets: Awaited<ReturnType<typeof secretBox>>
const attempts: string[] = []
const spent = new Set<string>()

const deps = (): PlatformAuthDeps => ({
  sql: db.sql,
  activity: activityLog,
  platformHost: host,
  secrets,
  now: () => now,
  allowAttempt: async (k) => {
    attempts.push(k)
    return !spent.has(k)
  },
})

const post = (path: string, body: unknown, cookie?: string) =>
  handlePlatformAuth(
    new Request(`https://${host}/api/auth/${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { origin: `https://${host}`, 'cf-connecting-ip': '203.0.113.9', 'content-type': 'application/json', ...(cookie ? { cookie: `${partnerCookieName}=${cookie}` } : {}) },
    }),
    deps(),
  )

const relayResets = () =>
  relayDue(db.sql, { [passwordResetRequestKind]: partnerPasswordResetDeliverer(db.sql) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })

const cookieOf = (response: Response) => response.headers.get('set-cookie')?.match(new RegExp(`${partnerCookieName}=([^;]+)`))?.[1] ?? ''
const signedInAs = async (cookie: string) => (await resolvePartner(db.sql, new Request(`https://${host}/api`, { headers: { cookie: `${partnerCookieName}=${cookie}` } }), now))?.user.id

/** An invited user with a sent invitation, and the token its email would carry. */
const invite = async (partnerId: string, email: string, by: { kind: 'staff' | 'partner_user'; label: string } = { kind: 'partner_user', label: 'Jonas Weber' }) => {
  const [user] = await db.sql<{ id: string }[]>`insert into partner_user (partner_id, email, name, role_key, status) values (${partnerId}, ${email}, 'Invited', 'partner-admin', 'invited') returning id`
  const [invitation] = await db.sql<{ id: string }[]>`
    insert into partner_invitation (partner_id, partner_user_id, sent_at, expires_at, invited_by_kind, invited_by_label, created_at)
    values (${partnerId}, ${user?.id ?? ''}, ${now}, ${new Date(now.getTime() + 7 * 86_400_000)}, ${by.kind}, ${by.label}, ${now}) returning id`
  const token = await withSystemScope(db.sql, (tx) => mintInvitationToken(tx, invitation?.id ?? '', now))
  if (!token) throw new Error('no token minted')
  return { userId: user?.id ?? '', invitationId: invitation?.id ?? '', token }
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  secrets = await secretBox(key)
  await db.sql`update partner set name = 'Northstar Commerce' where id = ${t.partnerA}`
  await db.sql`update partner set second_factor_required = true where id = ${t.partnerB}`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('invitations', () => {
  it('shows a valid invitation, and names each closed one: used, replaced, expired, unknown', async () => {
    const owner = await invite(t.partnerA, 'petra@northstar.example')
    expect(await (await post('invitation', { token: owner.token })).json()).toEqual({
      ok: true,
      invitation: { partner: 'Northstar Commerce', role: 'partner-admin', email: 'petra@northstar.example', invitedBy: 'Jonas Weber', secondFactorRequired: false },
    })
    const fromStaff = await invite(t.partnerA, 'olaf@northstar.example', { kind: 'staff', label: 'Maya Ortiz' })
    expect(((await (await post('invitation', { token: fromStaff.token })).json()) as { invitation: { invitedBy: string } }).invitation.invitedBy).toBe('DripFunnel')

    const unknown = await post('invitation', { token: 'not-a-token' })
    expect([unknown.status, await unknown.json()]).toEqual([400, { ok: false, code: 'INVITATION_INVALID' }])

    const old = await invite(t.partnerA, 'replaced@northstar.example')
    await db.sql`update partner_invitation set revoked_at = ${now} where id = ${old.invitationId}`
    await db.sql`insert into partner_invitation (partner_id, partner_user_id, sent_at, expires_at, invited_by_kind, invited_by_label, created_at)
      values (${t.partnerA}, ${old.userId}, ${now}, ${new Date(now.getTime() + 86_400_000)}, 'partner_user', 'Jonas Weber', ${new Date(now.getTime() + 1000)})`
    expect(await (await post('invitation', { token: old.token })).json()).toEqual({ ok: false, code: 'INVITATION_REPLACED' })

    const late = await invite(t.partnerA, 'late@northstar.example')
    now = new Date(now.getTime() + 8 * 86_400_000)
    expect(await (await post('invitation', { token: late.token })).json()).toEqual({ ok: false, code: 'INVITATION_EXPIRED' })
    now = new Date('2026-10-03T09:00:00Z')
  })

  it('refuses an empty name as NAME_REQUIRED, not as a weak password', async () => {
    const { token, userId } = await invite(t.partnerA, 'noname@northstar.example')
    const refused = await post('accept-invitation', { token, name: '   ', password: 'a-long-enough-password' })
    expect([refused.status, await refused.json()]).toEqual([400, { ok: false, code: 'NAME_REQUIRED' }])
    const [user] = await db.sql<{ status: string }[]>`select status from partner_user where id = ${userId}`
    expect(user?.status).toBe('invited')
  })

  it('accepts once: a weak password is refused, then the account is usable and the link reads as used', async () => {
    const { token, userId } = await invite(t.partnerA, 'accept@northstar.example')
    expect(await (await post('accept-invitation', { token, name: 'Accept Me', password: 'short' })).json()).toEqual({ ok: false, code: 'WEAK_PASSWORD' })
    const accepted = await post('accept-invitation', { token, name: '  Accept Me ', password: 'a-long-enough-password' })
    expect(await accepted.json()).toEqual({ ok: true, step: 'enrol', secondFactorRequired: false })
    const cookie = cookieOf(accepted)
    // Step 2 of 2 first: the session isn't a full one until 2-factor is set up or skipped.
    expect(await signedInAs(cookie)).toBeUndefined()
    expect(await (await post('skip-second-factor', {}, cookie)).json()).toEqual({ ok: true })
    expect(await signedInAs(cookie)).toBe(userId)
    const [user] = await db.sql<{ name: string; status: string }[]>`select name, status from partner_user where id = ${userId}`
    expect(user).toEqual({ name: 'Accept Me', status: 'active' })
    expect(await (await post('accept-invitation', { token, name: 'Again', password: 'a-long-enough-password' })).json()).toEqual({ ok: false, code: 'INVITATION_USED' })
    expect(await (await post('invitation', { token })).json()).toEqual({ ok: false, code: 'INVITATION_USED' })
    const signIn = await post('sign-in', { email: 'accept@northstar.example', password: 'a-long-enough-password' })
    expect(await signIn.json()).toEqual({ ok: true, step: 'done', next: '/dashboard' })
    const logged = await db.sql`select * from activity_log where actor_id = ${userId}`
    expect(logged.some((e) => e['action'] === 'partner_user.invitation_accepted')).toBe(true)
    expect(JSON.stringify(logged)).not.toContain(token)
    expect(JSON.stringify(logged)).not.toContain('a-long-enough-password')
  })

  it('refuses to skip 2-factor when the partner requires it, and enrols instead', async () => {
    const { token } = await invite(t.partnerB, 'must@kaufladen.example')
    expect(((await (await post('invitation', { token })).json()) as { invitation: { secondFactorRequired: boolean } }).invitation.secondFactorRequired).toBe(true)
    const accepted = await post('accept-invitation', { token, name: 'Must Enrol', password: 'a-long-enough-password' })
    expect(await accepted.json()).toEqual({ ok: true, step: 'enrol', secondFactorRequired: true })
    const cookie = cookieOf(accepted)
    const skipped = await post('skip-second-factor', {}, cookie)
    expect([skipped.status, await skipped.json()]).toEqual([400, { ok: false, code: 'SECOND_FACTOR_REQUIRED' }])
    const issued = (await (await post('enrol-second-factor', {}, cookie)).json()) as { ok: boolean; secret: string }
    expect(issued.ok).toBe(true)
    expect(await (await post('skip-second-factor', {})).json()).toEqual({ ok: false, code: 'INVALID_CREDENTIALS' })
  })

  it('lets a re-invited person set up 2-factor afresh, whatever they had before removal', async () => {
    const { token, userId } = await invite(t.partnerB, 'back@kaufladen.example')
    await db.sql`update partner_user set two_factor_secret_enc = ${await secrets.seal('OLDSECRET')}, two_factor_enrolled_at = ${now}, locked_until = ${new Date(now.getTime() + 60_000)} where id = ${userId}`
    const accepted = await post('accept-invitation', { token, name: 'Back Again', password: 'a-long-enough-password' })
    const cookie = cookieOf(accepted)
    expect(((await (await post('enrol-second-factor', {}, cookie)).json()) as { ok: boolean }).ok).toBe(true)
    const [row] = await db.sql<{ last_sign_in_at: Date | null; locked_until: Date | null }[]>`select last_sign_in_at, locked_until from partner_user where id = ${userId}`
    expect(row).toEqual({ last_sign_in_at: null, locked_until: null })
  })
})

describe('password reset', () => {
  it('answers a known and an unknown email byte for byte the same, with the same single write, and resets only the known one', async () => {
    const [user] = await db.sql<{ id: string }[]>`
      insert into partner_user (partner_id, email, name, role_key, status, password_hash) values (${t.partnerA}, 'reset@northstar.example', 'Reset', 'partner-admin', 'active', 'x') returning id`
    const counts = async () =>
      (await db.sql<{ resets: number; outbox: number; activity: number }[]>`
        select (select count(*)::int from partner_password_reset) as resets, (select count(*)::int from outbox) as outbox, (select count(*)::int from activity_log) as activity`)[0]
    const before = await counts()
    const known = await post('request-password-reset', { email: 'RESET@northstar.example' })
    const afterKnown = await counts()
    const unknown = await post('request-password-reset', { email: 'nobody@northstar.example' })
    const afterUnknown = await counts()
    expect([known.status, [...known.headers], await known.text()]).toEqual([unknown.status, [...unknown.headers], await unknown.text()])
    // ACCESS.md §2: timing must not tell them apart either, so each request writes one outbox row and nothing else.
    expect(afterKnown).toEqual({ ...before, outbox: (before?.outbox ?? 0) + 1 })
    expect(afterUnknown).toEqual({ ...before, outbox: (before?.outbox ?? 0) + 2 })
    const requests = await db.sql<{ payload: Record<string, unknown> }[]>`select payload from outbox where kind = ${passwordResetRequestKind} order by created_at`
    expect(requests.map((r) => Object.keys(r.payload).sort())).toEqual([
      ['email', 'ip', 'requestId', 'requestedAt', 'userAgent'],
      ['email', 'ip', 'requestId', 'requestedAt', 'userAgent'],
    ])

    expect((await relayResets()).delivered).toBe(2)
    const queued = await db.sql<{ payload: { to: string } }[]>`select payload from outbox where kind = 'email' and payload->>'template' = 'partner-password-reset'`
    expect(queued.map((q) => q.payload.to)).toEqual(['reset@northstar.example'])
    expect(JSON.stringify(queued)).not.toMatch(/token/i)
    const logged = await db.sql<{ occurred_at: Date; ip: string }[]>`select occurred_at, ip from activity_log where actor_id = ${user?.id ?? ''} and action = 'partner_user.password_reset_requested'`
    expect(logged.map((e) => [e.occurred_at.toISOString(), e.ip])).toEqual([[now.toISOString(), '203.0.113.9']])
    expect(attempts).toContain('reset:nobody@northstar.example')

    // A closed partner's account gets no reset, as it gets no sign-in.
    const [closed] = await db.sql<{ id: string }[]>`insert into partner (name, state) values ('Closed Partner', 'closed') returning id`
    await db.sql`insert into partner_user (partner_id, email, name, role_key, status, password_hash) values (${closed?.id ?? ''}, 'gone@closed.example', 'Gone', 'partner-admin', 'active', 'x')`
    await post('request-password-reset', { email: 'gone@closed.example' })
    await relayResets()
    expect(await db.sql`select 1 from partner_password_reset r join partner_user u on u.id = r.partner_user_id where u.email = 'gone@closed.example'`).toHaveLength(0)
  })

  it('writes one reset, email and entry per request, however often the relay delivers it', async () => {
    await post('request-password-reset', { email: 'reset@northstar.example' })
    const [request] = await db.sql<{ id: string; payload: Record<string, unknown> }[]>`
      select id, payload from outbox where kind = ${passwordResetRequestKind} and delivered_at is null`
    const effect = { id: request?.id ?? '', kind: passwordResetRequestKind, idempotencyKey: 'k', payload: request?.payload, partnerId: null, storeId: null, attempt: 1 }
    const deliverer = partnerPasswordResetDeliverer(db.sql)
    await deliverer.deliver(effect, new AbortController().signal)
    await deliverer.deliver(effect, new AbortController().signal)
    expect(await db.sql`select 1 from partner_password_reset where request_id = ${request?.id ?? ''}`).toHaveLength(1)
    const [reset] = await db.sql<{ id: string }[]>`select id from partner_password_reset where request_id = ${request?.id ?? ''}`
    expect(await db.sql`select 1 from outbox where payload->>'partnerPasswordResetId' = ${reset?.id ?? ''}`).toHaveLength(1)
    await relayResets()
  })

  it('refuses a spent email alike whether or not it has an account, and queues nothing', async () => {
    spent.add('reset:reset@northstar.example').add('reset:nobody@northstar.example')
    const before = await db.sql`select id from outbox`
    const known = await post('request-password-reset', { email: ' Reset@Northstar.example ' })
    const unknown = await post('request-password-reset', { email: 'nobody@northstar.example' })
    expect([known.status, await known.json()]).toEqual([429, { ok: false, code: 'RATE_LIMITED' }])
    expect([unknown.status, [...unknown.headers], await unknown.text()]).toEqual([known.status, [...known.headers], JSON.stringify({ ok: false, code: 'RATE_LIMITED' })])
    expect(await db.sql`select id from outbox`).toHaveLength(before.length)
    spent.clear()
  })

  it('resets once within 30 minutes and ends every session of that user', async () => {
    const [user] = await db.sql<{ id: string }[]>`select id from partner_user where email = 'reset@northstar.example'`
    const userId = user?.id ?? ''
    const [reset] = await db.sql<{ id: string }[]>`select id from partner_password_reset where partner_user_id = ${userId} order by created_at limit 1`
    const token = await withSystemScope(db.sql, (tx) => mintResetToken(tx, reset?.id ?? '', now))
    expect(await withSystemScope(db.sql, (tx) => mintResetToken(tx, reset?.id ?? '', now))).toBeNull()
    const sessions = await withSystemScope(db.sql, async (tx) => [await createPartnerSession(tx, userId, now), await createPartnerSession(tx, userId, now)])
    expect(await signedInAs(sessions[0] ?? '')).toBe(userId)

    expect(await (await post('reset-password', { token, password: 'short' })).json()).toEqual({ ok: false, code: 'WEAK_PASSWORD' })
    expect(await (await post('reset-password', { token, password: 'a-brand-new-password' })).json()).toEqual({ ok: true })
    for (const s of sessions) expect(await signedInAs(s)).toBeUndefined()
    expect(await (await post('reset-password', { token, password: 'another-new-password' })).json()).toEqual({ ok: false, code: 'RESET_INVALID' })
    expect(await (await post('sign-in', { email: 'reset@northstar.example', password: 'a-brand-new-password' })).json()).toMatchObject({ ok: true })
    expect(JSON.stringify(await db.sql`select * from activity_log where actor_id = ${userId}`)).not.toContain('a-brand-new-password')

    await post('request-password-reset', { email: 'reset@northstar.example' })
    await relayResets()
    const [later] = await db.sql<{ id: string }[]>`select id from partner_password_reset where partner_user_id = ${userId} and used_at is null`
    const lateToken = await withSystemScope(db.sql, (tx) => mintResetToken(tx, later?.id ?? '', now))
    now = new Date(now.getTime() + 31 * 60_000)
    expect(await (await post('reset-password', { token: lateToken, password: 'a-brand-new-password' })).json()).toEqual({ ok: false, code: 'RESET_INVALID' })
  })
})
