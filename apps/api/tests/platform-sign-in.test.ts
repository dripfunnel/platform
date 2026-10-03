import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handlePlatformAuth, lockMs, type PlatformAuthDeps } from '#apis/platform/auth'
import { resolvePartner } from '#auth/partnerCaller'
import { hashPassword } from '#auth/password'
import { partnerCookieName } from '#auth/partnerSession'
import { secretBox } from '#auth/secretBox'
import { codeAt, newTotpSecret, stepAt } from '#auth/totp'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #156: partner sign-in, the second factor, enrolment and the lock.

let db: TestDatabase
let t: Tenants
let now = new Date('2026-10-03T09:00:10Z')
const host = 'platform.dripfunnel.com'
const password = 'northstar-partners'
const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
let secrets: Awaited<ReturnType<typeof secretBox>>
let attempts = 0
const ids = { plain: '', twoFactor: '', mustEnrol: '', racer: '' }
const twoFactorSecret = newTotpSecret()

const deps = (): PlatformAuthDeps => ({
  sql: db.sql,
  activity: activityLog,
  platformHost: host,
  secrets,
  now: () => now,
  allowAttempt: async () => {
    attempts += 1
    return true
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

const bodyOf = async (response: Response) => (await response.json()) as { step?: string; next?: string }
const cookieOf = (response: Response) => response.headers.get('set-cookie')?.match(new RegExp(`${partnerCookieName}=([^;]+)`))?.[1] ?? ''
const signedInAs = async (cookie: string) => (await resolvePartner(db.sql, new Request(`https://${host}/api`, { headers: { cookie: `${partnerCookieName}=${cookie}` } }), now))?.user.id

const userIn = async (partnerId: string, email: string, secretEnc: string | null) => {
  const [row] = await db.sql<{ id: string }[]>`
    insert into partner_user (partner_id, email, name, role_key, status, password_hash, two_factor_secret_enc)
    values (${partnerId}, ${email}, 'Someone', 'partner-admin', 'active', ${await hashPassword(password)}, ${secretEnc}) returning id
  `
  if (!row) throw new Error('fixture insert returned no row')
  return row.id
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  secrets = await secretBox(key)
  ids.plain = await userIn(t.partnerA, 'alex@northstar.example', null)
  ids.twoFactor = await userIn(t.partnerA, 'maya@northstar.example', await secrets.seal(twoFactorSecret))
  ids.racer = await userIn(t.partnerA, 'rae@northstar.example', await secrets.seal(twoFactorSecret))
  await db.sql`update partner set second_factor_required = true where id = ${t.partnerB}`
  ids.mustEnrol = await userIn(t.partnerB, 'jonas@kaufladen.example', null)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('sign-in', () => {
  it('answers an unknown email and a wrong password byte for byte the same', async () => {
    const unknown = await post('sign-in', { email: 'nobody@northstar.example', password })
    const wrong = await post('sign-in', { email: 'alex@northstar.example', password: 'not-the-password' })
    expect([unknown.status, [...unknown.headers], await unknown.text()]).toEqual([wrong.status, [...wrong.headers], await wrong.text()])
    expect(await (await post('sign-in', { email: 'alex@northstar.example', password: 'nope-nope-nope' })).json()).toEqual({ ok: false, code: 'INVALID_CREDENTIALS' })
  })

  it('signs a user without 2-factor straight in, and keeps `next` on this host', async () => {
    const response = await post('sign-in', { email: 'ALEX@northstar.example', password, next: '//evil.example/x' })
    expect(await response.json()).toEqual({ ok: true, step: 'done', next: '/dashboard' })
    expect(await signedInAs(cookieOf(response))).toBe(ids.plain)
    const kept = await post('sign-in', { email: 'alex@northstar.example', password, next: '/stores?status=live' })
    expect((await bodyOf(kept)).next).toBe('/stores?status=live')
  })

  it('logs the sign-in and the refusal, with no password in either', async () => {
    const entries = await db.sql`select action, actor_id, reason, visibility from activity_log where action like 'partner_user.sign%' order by occurred_at`
    expect(entries.some((e) => e['action'] === 'partner_user.signed_in' && e['actor_id'] === ids.plain)).toBe(true)
    expect(entries.some((e) => e['action'] === 'partner_user.sign_in_refused' && e['reason'] === 'invalid_credentials' && e['actor_id'] === null)).toBe(true)
    expect(JSON.stringify(await db.sql`select * from activity_log`)).not.toContain(password)
  })

  it('asks every route for an attempt, per address and per account', async () => {
    const before = attempts
    await post('sign-in', { email: 'alex@northstar.example', password })
    expect(attempts - before).toBe(2)
  })
})

describe('the second factor', () => {
  const pending = async () => cookieOf(await post('sign-in', { email: 'maya@northstar.example', password }))

  it('holds a password-only session short of the console until the code is right', async () => {
    const response = await post('sign-in', { email: 'maya@northstar.example', password })
    expect((await bodyOf(response)).step).toBe('second-factor')
    const cookie = cookieOf(response)
    expect(await signedInAs(cookie)).toBeUndefined()
    expect(await (await post('second-factor', { code: await codeAt(twoFactorSecret, stepAt(now)) }, cookie)).json()).toEqual({ ok: true })
    expect(await signedInAs(cookie)).toBe(ids.twoFactor)
  })

  it('calls a replayed code expired, without counting it as a wrong one', async () => {
    const replay = await post('second-factor', { code: await codeAt(twoFactorSecret, stepAt(now)) }, await pending())
    expect(await replay.json()).toEqual({ ok: false, code: 'CODE_EXPIRED' })
  })

  it('counts down five wrong codes, then locks for 15 minutes, queues the notice and refuses even the right code', async () => {
    now = new Date(now.getTime() + 60_000)
    const cookie = await pending()
    for (const left of [4, 3, 2, 1]) expect(await (await post('second-factor', { code: '000001' }, cookie)).json()).toEqual({ ok: false, code: 'WRONG_CODE', triesLeft: left })
    expect(await (await post('second-factor', { code: '000001' }, cookie)).json()).toEqual({ ok: false, code: 'LOCKED', minutes: 15 })
    expect(await (await post('second-factor', { code: await codeAt(twoFactorSecret, stepAt(now)) }, cookie)).json()).toEqual({ ok: false, code: 'LOCKED', minutes: 15 })
    expect(await (await post('sign-in', { email: 'maya@northstar.example', password })).json()).toEqual({ ok: false, code: 'LOCKED', minutes: 15 })
    const refusals = await db.sql<{ reason: string; visibility: string }[]>`select reason, visibility from activity_log where action = 'partner_user.second_factor_refused' and actor_id = ${ids.twoFactor}`
    expect(refusals.filter((r) => r.reason === 'WRONG_CODE' && r.visibility === 'partner').length).toBeGreaterThanOrEqual(5)
    const [notice] = await db.sql<{ payload: { template: string; to: string } }[]>`select payload from outbox where kind = 'email'`
    expect(notice?.payload).toMatchObject({ template: 'partner-user-locked', to: 'maya@northstar.example' })
    now = new Date(now.getTime() + lockMs + 60_000)
    const later = await pending()
    expect(await (await post('second-factor', { code: await codeAt(twoFactorSecret, stepAt(now)) }, later)).json()).toEqual({ ok: true })
  })

  it('locks after five wrong codes even when they arrive at once', async () => {
    const cookie = cookieOf(await post('sign-in', { email: 'rae@northstar.example', password }))
    const answers = await Promise.all(Array.from({ length: 8 }, () => post('second-factor', { code: '000001' }, cookie).then(bodyOf)))
    const codes = answers.map((a) => (a as { code?: string }).code)
    expect(codes.filter((c) => c === 'WRONG_CODE')).toHaveLength(4)
    expect(codes.filter((c) => c === 'LOCKED')).toHaveLength(4)
  })

  it('refuses the second-factor step without a pending session, and says NOT_CONNECTED without the key', async () => {
    expect(await (await post('second-factor', { code: '123456' })).json()).toEqual({ ok: false, code: 'INVALID_CREDENTIALS' })
    const response = await handlePlatformAuth(
      new Request(`https://${host}/api/auth/second-factor`, { method: 'POST', body: '{"code":"123456"}', headers: { origin: `https://${host}`, 'cf-connecting-ip': '203.0.113.9' } }),
      { ...deps(), secrets: null },
    )
    expect(await response.json()).toEqual({ ok: false, code: 'NOT_CONNECTED' })
  })
})

describe('enrolment when the partner requires 2-factor', () => {
  it('forces it at the next sign-in, issues a secret, and lets in only on a code from that secret', async () => {
    const response = await post('sign-in', { email: 'jonas@kaufladen.example', password })
    expect((await bodyOf(response)).step).toBe('enrol')
    const cookie = cookieOf(response)
    expect(await signedInAs(cookie)).toBeUndefined()
    const issued = (await (await post('enrol-second-factor', {}, cookie)).json()) as { ok: boolean; secret: string; uri: string }
    expect(issued.uri).toContain(`secret=${issued.secret}`)
    expect(await (await post('enrol-second-factor', { code: '000001' }, cookie)).json()).toMatchObject({ ok: false, code: 'WRONG_CODE' })
    expect(await (await post('enrol-second-factor', { code: await codeAt(issued.secret, stepAt(now)) }, cookie)).json()).toEqual({ ok: true })
    expect(await signedInAs(cookie)).toBe(ids.mustEnrol)
    const [row] = await db.sql<{ two_factor_secret_enc: string }[]>`select two_factor_secret_enc from partner_user where id = ${ids.mustEnrol}`
    expect(row?.two_factor_secret_enc).not.toContain(issued.secret)
    expect(await secrets.open(row?.two_factor_secret_enc ?? '')).toBe(issued.secret)
    expect((await bodyOf(await post('sign-in', { email: 'jonas@kaufladen.example', password }))).step).toBe('second-factor')
  })

  it('never lets a stale enrol session replace a secret the user has since set up', async () => {
    const ids2 = await db.sql<{ id: string }[]>`
      insert into partner_user (partner_id, email, name, role_key, status, password_hash)
      values (${t.partnerB}, 'petra@kaufladen.example', 'Petra', 'partner-admin', 'active', ${await hashPassword(password)}) returning id
    `
    const stale = cookieOf(await post('sign-in', { email: 'petra@kaufladen.example', password }))
    const staleSecret = ((await (await post('enrol-second-factor', {}, stale)).json()) as { secret: string }).secret
    const fresh = cookieOf(await post('sign-in', { email: 'petra@kaufladen.example', password }))
    const freshSecret = ((await (await post('enrol-second-factor', {}, fresh)).json()) as { secret: string }).secret
    expect(await (await post('enrol-second-factor', { code: await codeAt(freshSecret, stepAt(now)) }, fresh)).json()).toEqual({ ok: true })
    expect(await (await post('enrol-second-factor', { code: await codeAt(staleSecret, stepAt(now)) }, stale)).json()).toEqual({ ok: false, code: 'INVALID_CREDENTIALS' })
    expect(await (await post('enrol-second-factor', {}, stale)).json()).toEqual({ ok: false, code: 'INVALID_CREDENTIALS' })
    const [row] = await db.sql<{ two_factor_secret_enc: string }[]>`select two_factor_secret_enc from partner_user where id = ${ids2[0]?.id ?? ''}`
    expect(await secrets.open(row?.two_factor_secret_enc ?? '')).toBe(freshSecret)
  })
})
