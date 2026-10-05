import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { handleStoreAuth, type StoreAuthDeps } from '#apis/store/auth'
import { storeSchema } from '#apis/store/schema'
import { mintEmailChangeToken } from '#auth/emailChangeTokens'
import { hashPassword, verifyPassword } from '#auth/password'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { hashSessionId } from '#auth/session'
import { resolveStoreStanding } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { codeAt, stepAt } from '#auth/totp'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #290 (SAPI 2, part 3): My profile — details, email by link, password, two-step sign-in,
// backup codes, where you're signed in and My activity — always the session's own account.

let db: TestDatabase
let t: Tenants
let secrets: SecretBox
const now = new Date('2026-10-05T09:00:00Z')
const host = 'store.partner-a.example'
const hostB = 'store.partner-b.example'
const password = 'correct horse battery'
const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  secrets = await secretBox(btoa('k'.repeat(32)))
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'portal', ${host}, 'live', 'CNAME', 'x'), (${t.partnerB}, 'portal', ${hostB}, 'live', 'CNAME', 'x')`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const person = async (partnerId: string, email: string, role: 'owner' | 'staff' = 'staff', storeId = t.storeA1) => {
  const [row] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status, password_hash) values (${partnerId}, ${email}, 'Someone', 'active', ${await hashPassword(password)}) returning id`
  const id = row?.id ?? ''
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${id}, ${storeId}, ${role}, 'active')`
  return id
}

const sessionFor = (id: string, partnerId = t.partnerA, userAgent: string | null = chrome) =>
  withSystemScope(db.sql, (tx) => createUserSession(tx, { id, partnerId }, now, { userAgent }))

interface Result {
  data: Record<string, unknown> | null | undefined
  code: string | undefined
}

const gql = async (source: string, cookie: string, partnerId = t.partnerA): Promise<Result> => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const request = new Request(`https://${partnerId === t.partnerA ? host : hostB}/api/`, { headers: { cookie: `${storeCookieName}=${cookie}` } })
  const standing = await resolveStoreStanding(db.sql, request, partnerId, now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: activityLog, facts, secrets, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

const deps = (overrides: Partial<StoreAuthDeps> = {}): StoreAuthDeps => ({ sql: db.sql, activity: activityLog, partnerId: t.partnerA, host, secrets, now: () => now, allowAttempt: async () => true, ...overrides })

const confirm = async (token: string, d = deps()) => {
  const response = await handleStoreAuth(
    new Request(`https://${d.host}/api/auth/confirm-email`, { method: 'POST', headers: { origin: `https://${d.host}`, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' }, body: JSON.stringify({ token }) }),
    d,
  )
  return (await response.json()) as Record<string, unknown>
}

const actions = async (id: string) => (await db.sql<{ action: string }[]>`select action from activity_log where actor_id = ${id} order by occurred_at, id`).map((r) => r.action)

describe('reading my profile', () => {
  it('reads the session’s own account, and nothing for a session of another partner', async () => {
    const id = await person(t.partnerA, 'reader@a.example')
    const cookie = await sessionFor(id)
    const { data } = await gql('{ profile { name email phone theme twoFactor { method backupCodesLeft required } } }', cookie)
    expect(data?.['profile']).toEqual({ name: 'Someone', email: 'reader@a.example', phone: null, theme: null, twoFactor: { method: null, backupCodesLeft: 0, required: false } })
    expect((await gql('{ profile { name } }', cookie, t.partnerB)).code).toBe('UNAUTHENTICATED')
    expect((await gql('{ profile { name } }', 'nope')).code).toBe('UNAUTHENTICATED')
  })

  it('lists only my own live sessions, marks this one, and names the device', async () => {
    const id = await person(t.partnerA, 'devices@a.example')
    const other = await person(t.partnerA, 'someone.else@a.example')
    const cookie = await sessionFor(id)
    await sessionFor(id, t.partnerA, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
    await sessionFor(other)
    const { data } = await gql('{ mySessions { device current } }', cookie)
    const sessions = data?.['mySessions'] as { device: string; current: boolean }[]
    expect(sessions).toHaveLength(2)
    expect(sessions.filter((s) => s.current)).toEqual([{ device: 'Chrome on Windows', current: true }])
    expect(sessions.map((s) => s.device).sort()).toEqual(['Chrome on Windows', 'Safari on iOS'])
  })

  it('shows my own activity only, never someone else’s or a staff-only entry, paged', async () => {
    const id = await person(t.partnerA, 'history@a.example')
    const other = await person(t.partnerA, 'not.me@a.example')
    const cookie = await sessionFor(id)
    for (const [actor, action, visibility] of [[id, 'person.signed_in', 'self'], [id, 'person.signed_out', 'self'], [id, 'store.crossing_refused', 'staff'], [other, 'person.signed_in', 'self']] as const) {
      await db.sql`insert into activity_log (category, action, result, actor_kind, actor_id, partner_id, visibility, occurred_at) values ('auth', ${action}, 'success', 'person', ${actor}, ${t.partnerA}, ${visibility}, ${now})`
    }
    const first = await gql('{ myActivity(first: 1) { nodes { action } pageInfo { hasNextPage endCursor } } }', cookie)
    const page = first.data?.['myActivity'] as { nodes: { action: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string } }
    expect(page.nodes).toHaveLength(1)
    expect(page.pageInfo.hasNextPage).toBe(true)
    const all = await gql('{ myActivity { nodes { action } } }', cookie)
    expect((all.data?.['myActivity'] as { nodes: { action: string }[] }).nodes.map((n) => n.action).sort()).toEqual(['person.signed_in', 'person.signed_out'])
  })
})

describe('changing my details', () => {
  it('saves the name and a full number, refuses what isn’t one, and leaves the theme alone', async () => {
    const id = await person(t.partnerA, 'details@a.example')
    const cookie = await sessionFor(id)
    expect((await gql('mutation { updateProfile(name: "  ") { name } }', cookie)).code).toBe('NAME_REQUIRED')
    expect((await gql('mutation { updateProfile(name: "Meera", phone: "98450 22113") { name } }', cookie)).code).toBe('INVALID_PHONE')
    await gql('mutation { setTheme(theme: "dark") { theme } }', cookie)
    const ok = await gql('mutation { updateProfile(name: " Meera Iyer ", phone: "+919845022113") { name phone theme } }', cookie)
    expect(ok.data?.['updateProfile']).toEqual({ name: 'Meera Iyer', phone: '+919845022113', theme: 'dark' })
    expect(await actions(id)).toContain('person.profile_updated')
  })

  it('saves the theme alone, keeping a name and number changed elsewhere since the page loaded', async () => {
    const id = await person(t.partnerA, 'theme@a.example')
    const cookie = await sessionFor(id)
    await gql('mutation { updateProfile(name: "First", phone: "+919845022114") { name } }', cookie)
    // Another device renames the person after this page read "First".
    await db.sql`update "user" set name = 'Renamed', phone = '+919845022115' where id = ${id}`
    const updates = async () => (await actions(id)).filter((a) => a === 'person.profile_updated').length
    const before = await updates()
    expect((await gql('mutation { setTheme(theme: "dark") { name phone theme } }', cookie)).data?.['setTheme']).toEqual({ name: 'Renamed', phone: '+919845022115', theme: 'dark' })
    // One audited entry for the save, none for a refused theme.
    expect(await updates()).toBe(before + 1)
    expect((await gql('mutation { setTheme(theme: "neon") { theme } }', cookie)).code).toBe('INVALID_INPUT')
    expect(await updates()).toBe(before + 1)
  })

  it('never changes the number sign-in codes go to without texting it first', async () => {
    const id = await person(t.partnerA, 'texted@a.example')
    await db.sql`update "user" set two_factor_method = 'sms', two_factor_enrolled_at = now(), phone = '+16145550120' where id = ${id}`
    const cookie = await sessionFor(id)
    expect((await gql('mutation { updateProfile(name: "T", phone: "+16145550121") { phone } }', cookie)).code).toBe('PHONE_IN_USE_FOR_SIGN_IN')
    expect((await gql('mutation { updateProfile(name: "T", phone: "+16145550120") { name } }', cookie)).data?.['updateProfile']).toEqual({ name: 'T' })
  })
})

describe('changing my email', () => {
  it('changes it only from the link sent to the new address, telling the old one', async () => {
    const id = await person(t.partnerA, 'old.address@a.example')
    const cookie = await sessionFor(id)
    expect((await gql(`mutation { changeEmail(email: "not-an-email", password: "${password}") }`, cookie)).code).toBe('INVALID_EMAIL')
    expect((await gql(`mutation { changeEmail(email: "new.address@a.example", password: "${password}") }`, cookie)).data?.['changeEmail']).toBe(true)
    const emails = await db.sql<{ template: string }[]>`select payload->>'template' as template from outbox where kind = 'email' and payload->>'emailChangeId' is not null order by created_at`
    expect(emails.map((e) => e.template).sort()).toEqual(['user-email-change', 'user-email-changing'])
    expect(((await gql('{ profile { email pendingEmail } }', cookie)).data?.['profile'])).toEqual({ email: 'old.address@a.example', pendingEmail: 'new.address@a.example' })
    const [change] = await db.sql<{ id: string }[]>`select id from user_email_change where user_id = ${id}`
    const token = (await withSystemScope(db.sql, (tx) => mintEmailChangeToken(tx, change?.id ?? '', now))) ?? ''
    expect(await confirm(token, deps({ partnerId: t.partnerB, host: hostB }))).toEqual({ ok: false, code: 'EMAIL_CHANGE_INVALID' })
    expect(await confirm(token)).toEqual({ ok: true })
    expect(await confirm(token)).toEqual({ ok: false, code: 'EMAIL_CHANGE_INVALID' })
    expect(((await gql('{ profile { email pendingEmail } }', cookie)).data?.['profile'])).toEqual({ email: 'new.address@a.example', pendingEmail: null })
    expect(await actions(id)).toEqual(expect.arrayContaining(['person.email_change_requested', 'person.email_changed']))
  })

  it('answers the same for an address another account uses, and then changes nothing', async () => {
    const id = await person(t.partnerA, 'wants.taken@a.example')
    await person(t.partnerA, 'taken@a.example')
    const cookie = await sessionFor(id)
    expect((await gql(`mutation { changeEmail(email: "taken@a.example", password: "${password}") }`, cookie)).data?.['changeEmail']).toBe(true)
    const [change] = await db.sql<{ id: string }[]>`select id from user_email_change where user_id = ${id}`
    const token = (await withSystemScope(db.sql, (tx) => mintEmailChangeToken(tx, change?.id ?? '', now))) ?? ''
    expect(await confirm(token)).toEqual({ ok: false, code: 'EMAIL_CHANGE_INVALID' })
    const [u] = await db.sql<{ email: string }[]>`select email from "user" where id = ${id}`
    expect(u?.email).toBe('wants.taken@a.example')
  })

  it('needs the current password, and a password change or signing out elsewhere cancels a change in flight', async () => {
    const id = await person(t.partnerA, 'guarded@a.example')
    const cookie = await sessionFor(id)
    expect((await gql('mutation { changeEmail(email: "thief@evil.example", password: "a guess") }', cookie)).code).toBe('INVALID_CREDENTIALS')
    await gql(`mutation { changeEmail(email: "thief@evil.example", password: "${password}") }`, cookie)
    const [change] = await db.sql<{ id: string }[]>`select id from user_email_change where user_id = ${id}`
    const token = (await withSystemScope(db.sql, (tx) => mintEmailChangeToken(tx, change?.id ?? '', now))) ?? ''
    await gql(`mutation { changePassword(current: "${password}", next: "a fresh passphrase here") }`, cookie)
    expect(await confirm(token)).toEqual({ ok: false, code: 'EMAIL_CHANGE_INVALID' })
    await gql('mutation { changeEmail(email: "again@evil.example", password: "a fresh passphrase here") }', cookie)
    const [second] = await db.sql<{ id: string }[]>`select id from user_email_change where user_id = ${id} and used_at is null`
    const again = (await withSystemScope(db.sql, (tx) => mintEmailChangeToken(tx, second?.id ?? '', now))) ?? ''
    await gql('mutation { signOutOtherSessions }', cookie)
    expect(await confirm(again)).toEqual({ ok: false, code: 'EMAIL_CHANGE_INVALID' })
  })

  it('lets only the newest link work, and asks at most three times a day', async () => {
    const id = await person(t.partnerA, 'indecisive@a.example')
    const cookie = await sessionFor(id)
    await gql(`mutation { changeEmail(email: "first@a.example", password: "${password}") }`, cookie)
    const [first] = await db.sql<{ id: string }[]>`select id from user_email_change where user_id = ${id} order by created_at limit 1`
    const firstToken = (await withSystemScope(db.sql, (tx) => mintEmailChangeToken(tx, first?.id ?? '', now))) ?? ''
    await gql(`mutation { changeEmail(email: "second@a.example", password: "${password}") }`, cookie)
    expect(await confirm(firstToken)).toEqual({ ok: false, code: 'EMAIL_CHANGE_INVALID' })
    await gql(`mutation { changeEmail(email: "third@a.example", password: "${password}") }`, cookie)
    expect((await gql(`mutation { changeEmail(email: "fourth@a.example", password: "${password}") }`, cookie)).code).toBe('RATE_LIMITED')
  })
})

describe('changing my password', () => {
  it('needs the current one, signs out every other device, and keeps this one', async () => {
    const id = await person(t.partnerA, 'rotator@a.example')
    const cookie = await sessionFor(id)
    const elsewhere = await sessionFor(id)
    expect((await gql('mutation { changePassword(current: "wrong", next: "a whole new passphrase") }', cookie)).code).toBe('INVALID_CREDENTIALS')
    expect((await gql(`mutation { changePassword(current: "${password}", next: "short") }`, cookie)).code).toBe('WEAK_PASSWORD')
    expect((await gql(`mutation { changePassword(current: "${password}", next: "a whole new passphrase") }`, cookie)).data?.['changePassword']).toBe(true)
    const sessions = await db.sql<{ id_hash: string }[]>`select id_hash from user_session where user_id = ${id}`
    expect(sessions.map((s) => s.id_hash)).toEqual([await hashSessionId(cookie)])
    expect(sessions.map((s) => s.id_hash)).not.toContain(await hashSessionId(elsewhere))
    const [u] = await db.sql<{ password_hash: string; password_changed_at: Date | null }[]>`select password_hash, password_changed_at from "user" where id = ${id}`
    expect(await verifyPassword('a whole new passphrase', u?.password_hash ?? null)).toBe(true)
    expect(u?.password_changed_at?.toISOString()).toBe(now.toISOString())
  })

  it('counts wrong current passwords like sign-in, refusing even the right one once paused', async () => {
    const id = await person(t.partnerA, 'guesser@a.example')
    const cookie = await sessionFor(id)
    for (let i = 0; i < 5; i += 1) await gql('mutation { changePassword(current: "a wrong guess", next: "a whole new passphrase") }', cookie)
    expect((await gql(`mutation { changePassword(current: "${password}", next: "a whole new passphrase") }`, cookie)).code).toBe('LOCKED')
    const [u] = await db.sql<{ password_hash: string }[]>`select password_hash from "user" where id = ${id}`
    expect(await verifyPassword(password, u?.password_hash ?? null)).toBe(true)
  })

  it('signs out everywhere else on request', async () => {
    const id = await person(t.partnerA, 'tidy@a.example')
    const cookie = await sessionFor(id)
    await sessionFor(id)
    await sessionFor(id)
    expect((await gql('mutation { signOutOtherSessions }', cookie)).data?.['signOutOtherSessions']).toBe(2)
    expect(await actions(id)).toContain('sessions.others_ended')
  })
})

describe('two-step sign-in', () => {
  it('turns on an authenticator, refusing a wrong code, and shows ten backup codes once', async () => {
    const id = await person(t.partnerA, 'app.user@a.example')
    const cookie = await sessionFor(id)
    expect((await gql('mutation { setSecondFactor(method: "app") { secret uri } }', cookie)).code).toBe('INVALID_CREDENTIALS')
    const start = await gql(`mutation { setSecondFactor(method: "app", password: "${password}") { secret uri } }`, cookie)
    const { secret, uri } = start.data?.['setSecondFactor'] as { secret: string; uri: string }
    expect(uri).toContain('issuer=Partner%20A')
    expect((await gql('mutation { setSecondFactor(method: "app", code: "000000") { done } }', cookie)).code).toBe('WRONG_CODE')
    const [counted] = await db.sql<{ failed_code_count: number }[]>`select failed_code_count from "user" where id = ${id}`
    // The start without a password and the wrong code are one count, as sign-in's.
    expect(counted?.failed_code_count).toBe(2)
    const done = await gql(`mutation { setSecondFactor(method: "app", code: "${await codeAt(secret, stepAt(now))}") { done backupCodes } }`, cookie)
    expect((done.data?.['setSecondFactor'] as { backupCodes: string[] }).backupCodes).toHaveLength(10)
    expect(((await gql('{ profile { twoFactor { method backupCodesLeft } } }', cookie)).data?.['profile'])).toEqual({ twoFactor: { method: 'app', backupCodesLeft: 10 } })
    const fresh = (await gql('mutation { regenerateBackupCodes }', cookie)).data?.['regenerateBackupCodes'] as string[]
    expect(fresh).toHaveLength(10)
    expect(await actions(id)).toEqual(expect.arrayContaining(['two_factor.enabled', 'backup_codes.generated']))
  })

  it('switches to text messages by texting my number a code, keeping my backup codes, and counts wrong codes', async () => {
    const id = await person(t.partnerA, 'switcher@a.example')
    await db.sql`update "user" set two_factor_method = 'app', two_factor_enrolled_at = now(), two_factor_secret_enc = ${await secrets.seal('JBSWY3DPEHPK3PXP')} where id = ${id}`
    const cookie = await sessionFor(id)
    await gql('mutation { regenerateBackupCodes }', cookie)
    expect((await gql(`mutation { setSecondFactor(method: "sms", password: "${password}") { hint } }`, cookie)).code).toBe('PHONE_REQUIRED')
    await gql('mutation { updateProfile(name: "S", phone: "+16145550130") { name } }', cookie)
    expect((await gql('mutation { setSecondFactor(method: "sms") { hint } }', cookie)).code).toBe('INVALID_CREDENTIALS')
    expect((await gql(`mutation { setSecondFactor(method: "sms", password: "${password}") { hint } }`, cookie)).data?.['setSecondFactor']).toEqual({ hint: '•••• 0130' })
    expect((await gql('mutation { setSecondFactor(method: "sms", code: "000000") { done } }', cookie)).code).toBe('WRONG_CODE')
    const [attempts] = await db.sql<{ attempts: number }[]>`select attempts from verification_code where subject_id = ${id} order by created_at desc limit 1`
    expect(attempts?.attempts).toBe(1)
    const [sent] = await db.sql<{ payload: { vars: { code: string } } }[]>`select payload from outbox where kind = 'sms' and payload->>'to' = '+16145550130' order by created_at desc limit 1`
    const done = await gql(`mutation { setSecondFactor(method: "sms", code: "${sent?.payload.vars.code ?? ''}") { done backupCodes } }`, cookie)
    expect(done.data?.['setSecondFactor']).toEqual({ done: true, backupCodes: null })
    expect(((await gql('{ profile { twoFactor { method backupCodesLeft } } }', cookie)).data?.['profile'])).toEqual({ twoFactor: { method: 'sms', backupCodesLeft: 10 } })
    expect(await actions(id)).toContain('two_factor.method_changed')
  })

  it('lets anyone but an Owner turn it off, taking the backup codes with it', async () => {
    const staff = await person(t.partnerA, 'optional@a.example')
    await db.sql`update "user" set two_factor_method = 'app', two_factor_enrolled_at = now(), two_factor_secret_enc = 'x' where id = ${staff}`
    const cookie = await sessionFor(staff)
    await gql('mutation { regenerateBackupCodes }', cookie)
    expect((await gql('mutation { setSecondFactor(method: "off", password: "not it") { done } }', cookie)).code).toBe('INVALID_CREDENTIALS')
    expect((await gql('mutation { setSecondFactor(method: "off", code: "123456") { done } }', cookie)).code).toBe('INVALID_CREDENTIALS')
    expect((await gql(`mutation { setSecondFactor(method: "off", password: "${password}") { done } }`, cookie)).data?.['setSecondFactor']).toEqual({ done: true })
    expect(((await gql('{ profile { twoFactor { method backupCodesLeft } } }', cookie)).data?.['profile'])).toEqual({ twoFactor: { method: null, backupCodesLeft: 0 } })
    expect((await gql('mutation { regenerateBackupCodes }', cookie)).code).toBe('SECOND_FACTOR_REQUIRED')
    const owner = await person(t.partnerA, 'keeps.it@a.example', 'owner', t.storeA2)
    await db.sql`update "user" set two_factor_method = 'app', two_factor_enrolled_at = now(), two_factor_secret_enc = 'x' where id = ${owner}`
    const ownerCookie = await sessionFor(owner)
    expect((await gql(`mutation { setSecondFactor(method: "off", password: "${password}") { done } }`, ownerCookie)).code).toBe('SECOND_FACTOR_REQUIRED')
    expect(((await gql('{ profile { twoFactor { required } } }', ownerCookie)).data?.['profile'])).toEqual({ twoFactor: { required: true } })
  })
})
