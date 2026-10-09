import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { hashPassword } from '#auth/password'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { hashSessionId } from '#auth/session'
import { hashBackupCode } from '#auth/storeCodes'
import { storeHeader } from '#auth/storeCaller'
import { storeCookieName } from '#auth/storeSession'
import { mintStoreInvitationToken, mintUserResetToken } from '#auth/storeTokens'
import { codeAt, stepAt } from '#auth/totp'
import { withSystemScope } from '#db/scoped/index'
import { replaceBackupCodes } from '#db/scoped/userSignIn'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #494 (MA 1): the portal's session as a bearer token for the merchant mobile app
// (ACCESS.md §4, "The merchant mobile app"), through the Worker itself.

let db: TestDatabase
let t: Tenants
let secrets: SecretBox
let allowAttempts = true
const kek = btoa('k'.repeat(32))
const host = 'store.partner-a.example'
const hostB = 'store.partner-b.example'
const password = 'correct horse battery'
const people = { staff: '', owner: '' }
let ownerSecret = ''
const day = 86_400_000

const env = () => ({
  ADMIN_HOST: 'admin.dripfunnel.com',
  PLATFORM_HOST: 'platform.dripfunnel.com',
  HOOKS_HOST: 'hooks.dripfunnel.com',
  HYPERDRIVE: { connectionString: db.url },
  CREDENTIALS_KEK: kek,
  HEALTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  SIGN_IN_RATE_LIMITER: { limit: async () => ({ success: allowAttempts }) },
  CF_VERSION_METADATA: { id: 'test', tag: '' },
})
const ctx = { waitUntil: (promise: Promise<unknown>) => promise, passThroughOnException: () => undefined } as unknown as ExecutionContext
const call = (href: string, init: RequestInit = {}) =>
  worker.fetch(new Request(href, { ...init, headers: { 'cf-connecting-ip': '203.0.113.7', ...init.headers } }) as Parameters<typeof worker.fetch>[0], env() as never, ctx)

/** A browser sends Origin and the cookie; the app sends neither, and its session as a bearer token. */
type Way = 'browser' | 'app'

const auth = async (path: string, body: unknown, way: Way, session = '', h = host) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (way === 'browser') {
    headers['origin'] = `https://${h}`
    if (session) headers['cookie'] = `${storeCookieName}=${session}`
  } else if (session) headers['authorization'] = `Bearer ${session}`
  const response = await call(`https://${h}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const json = response.headers.get('content-type')?.includes('json') ? ((await response.json()) as Record<string, unknown>) : null
  const setCookie = response.headers.get('set-cookie') ?? ''
  return { status: response.status, body: json, setCookie, cookie: /__Host-portal_session=([^;]*)/.exec(setCookie)?.[1] ?? '' }
}

const gql = async (source: string, headers: Record<string, string>, h = host) => {
  const response = await call(`https://${h}/api/`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ query: source }) })
  if (response.status !== 200) return { status: response.status, data: null, code: undefined }
  const result = (await response.json()) as { data?: Record<string, unknown> | null; errors?: { extensions?: { code?: string } }[] }
  return { status: 200, data: result.data ?? null, code: result.errors?.[0]?.extensions?.code }
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
const cookie = (id: string) => ({ cookie: `${storeCookieName}=${id}` })
const meName = async (headers: Record<string, string>, h = host) => ((await gql('{ me { name } }', headers, h)).data?.['me'] as { name: string } | null | undefined) ?? null

const user = async (email: string, name: string) => {
  const [row] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status, password_hash) values (${t.partnerA}, ${email}, ${name}, 'active', ${await hashPassword(password)}) returning id`
  return row?.id ?? ''
}

const invite = async (email: string) => {
  const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, 'Someone', 'invited') returning id`
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${u?.id ?? ''}, ${t.storeA1}, 'staff', 'invited')`
  const [row] = await db.sql<{ id: string }[]>`
    insert into invitation (store_id, email, role_key, expires_at, invited_by_label)
    values (${t.storeA1}, ${email}, 'staff', ${new Date(Date.now() + 7 * day)}, 'Priya Shah') returning id
  `
  return (await withSystemScope(db.sql, (tx) => mintStoreInvitationToken(tx, row?.id ?? '', new Date()))) ?? ''
}

const resetLink = async (userId: string) => {
  const [row] = await db.sql<{ id: string }[]>`insert into user_password_reset (request_id, partner_id, user_id) values (${crypto.randomUUID()}, ${t.partnerA}, ${userId}) returning id`
  return (await withSystemScope(db.sql, (tx) => mintUserResetToken(tx, row?.id ?? '', new Date()))) ?? ''
}

const backupCodes = async (userId: string, codes: string[]) =>
  withSystemScope(db.sql, async (tx) => replaceBackupCodes(tx, { id: userId, partnerId: t.partnerA }, await Promise.all(codes.map((code) => hashBackupCode(userId, code)))))

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  secrets = await secretBox(kek)
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'portal', ${host}, 'live', 'CNAME', 'x'), (${t.partnerB}, 'portal', ${hostB}, 'live', 'CNAME', 'x')`
  people.staff = await user('staff@a.example', 'Sam Staff')
  people.owner = await user('owner@a.example', 'Olivia Owner')
  ownerSecret = 'JBSWY3DPEHPK3PXP'
  await db.sql`update "user" set two_factor_method = 'app', two_factor_enrolled_at = now(), two_factor_secret_enc = ${await secrets.seal(ownerSecret)} where id = ${people.owner}`
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.staff}, ${t.storeA1}, 'staff', 'active'), (${people.owner}, ${t.storeA1}, 'owner', 'active')`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('sign-in', () => {
  it('gives a browser only the cookie, and the app only the session in the body', async () => {
    const browser = await auth('/api/auth/sign-in', { email: 'staff@a.example', password }, 'browser')
    expect(browser.body).toEqual({ ok: true, step: 'done' })
    expect(browser.cookie).not.toBe('')
    const app = await auth('/api/auth/sign-in', { email: 'staff@a.example', password }, 'app')
    expect(app.body).toEqual({ ok: true, step: 'done', token: expect.any(String) })
    expect(app.setCookie).toBe('')
    expect(await meName(bearer(app.body?.['token'] as string))).toEqual({ name: 'Sam Staff' })
  })

  it('gives no body token to a request with a cookie and no Origin', async () => {
    const { cookie: held } = await auth('/api/auth/sign-in', { email: 'staff@a.example', password }, 'browser')
    const response = await call(`https://${host}/api/auth/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json', ...cookie(held) }, body: JSON.stringify({ email: 'staff@a.example', password }) })
    expect(response.status).toBe(403)
    expect(await response.text()).toBe('Bad origin')
  })
})

describe('the second factor and backup codes', () => {
  const code = () => codeAt(ownerSecret, stepAt(new Date()))

  it('gives the app the session in the body at each step, and never a cookie', async () => {
    const started = await auth('/api/auth/sign-in', { email: 'owner@a.example', password }, 'app')
    expect(started.body).toEqual({ ok: true, step: 'second-factor', method: 'app', token: expect.any(String) })
    expect(started.setCookie).toBe('')
    const token = started.body?.['token'] as string
    expect(await meName(bearer(token))).toBeNull()
    const done = await auth('/api/auth/second-factor', { code: await code() }, 'app', token)
    expect(done.body).toEqual({ ok: true, token })
    expect(done.setCookie).toBe('')
    expect(await meName(bearer(token))).toEqual({ name: 'Olivia Owner' })
  })

  it('keeps the browser on the cookie with no token, and refuses a cookie without Origin', async () => {
    await db.sql`update "user" set last_code_step = null where id = ${people.owner}`
    const started = await auth('/api/auth/sign-in', { email: 'owner@a.example', password }, 'browser')
    expect(started.body).toEqual({ ok: true, step: 'second-factor', method: 'app' })
    const noOrigin = await call(`https://${host}/api/auth/second-factor`, { method: 'POST', headers: { 'content-type': 'application/json', ...cookie(started.cookie) }, body: JSON.stringify({ code: await code() }) })
    expect(noOrigin.status).toBe(403)
    const done = await auth('/api/auth/second-factor', { code: await code() }, 'browser', started.cookie)
    expect(done.body).toEqual({ ok: true })
    expect(done.cookie).toBe(started.cookie)
  })

  it('takes a backup code the same way on each path', async () => {
    await backupCodes(people.owner, ['aaaa-bbbb', 'cccc-dddd'])
    const app = await auth('/api/auth/sign-in', { email: 'owner@a.example', password }, 'app')
    const token = app.body?.['token'] as string
    const appDone = await auth('/api/auth/backup-code', { code: 'aaaa-bbbb' }, 'app', token)
    expect(appDone.body).toEqual({ ok: true, left: 1, token })
    expect(appDone.setCookie).toBe('')
    const browser = await auth('/api/auth/sign-in', { email: 'owner@a.example', password }, 'browser')
    const browserDone = await auth('/api/auth/backup-code', { code: 'cccc-dddd' }, 'browser', browser.cookie)
    expect(browserDone.body).toEqual({ ok: true, left: 0 })
    expect(browserDone.cookie).toBe(browser.cookie)
  })
})

describe('invitations and password reset', () => {
  it('opens an accepted invitation’s session in the body for the app, as the cookie for a browser', async () => {
    const app = await auth('/api/auth/accept-invitation', { token: await invite('app-invite@a.example'), name: 'Ana App', password }, 'app')
    expect(app.body).toEqual({ ok: true, step: 'done', token: expect.any(String) })
    expect(app.setCookie).toBe('')
    expect(await meName(bearer(app.body?.['token'] as string))).toEqual({ name: 'Ana App' })
    const browser = await auth('/api/auth/accept-invitation', { token: await invite('web-invite@a.example'), name: 'Wes Web', password }, 'browser')
    expect(browser.body).toEqual({ ok: true, step: 'done' })
    expect(browser.cookie).not.toBe('')
  })

  it('signs in after a reset in the body for the app, as the cookie for a browser', async () => {
    const id = await user('forgetful@a.example', 'Fran Forgetful')
    const app = await auth('/api/auth/reset-password', { token: await resetLink(id), password: 'a brand new passphrase' }, 'app')
    expect(app.body).toEqual({ ok: true, step: 'done', token: expect.any(String) })
    expect(app.setCookie).toBe('')
    const browser = await auth('/api/auth/reset-password', { token: await resetLink(id), password: 'another new passphrase' }, 'browser')
    expect(browser.body).toEqual({ ok: true, step: 'done' })
    expect(browser.cookie).not.toBe('')
  })
})

describe('a bearer token on the Store API', () => {
  const appSignIn = async () => (await auth('/api/auth/sign-in', { email: 'staff@a.example', password }, 'app')).body?.['token'] as string
  const setTheme = 'mutation { setTheme(theme: "dark") { __typename } }'

  it('refuses a request carrying a cookie and a bearer token together, and their sign-out ends nothing', async () => {
    const token = await appSignIn()
    const { cookie: held } = await auth('/api/auth/sign-in', { email: 'staff@a.example', password }, 'browser')
    expect(await meName({ ...bearer(token), ...cookie(held), origin: `https://${host}` })).toBeNull()
    expect((await gql(setTheme, { ...bearer(token), ...cookie(held), origin: `https://${host}` })).code).toBe('UNAUTHENTICATED')
    await call(`https://${host}/api/auth/sign-out`, { method: 'POST', headers: { ...bearer(token), ...cookie(held), origin: `https://${host}` } })
    expect(await meName(bearer(token))).toEqual({ name: 'Sam Staff' })
    expect(await meName({ ...cookie(held), origin: `https://${host}` })).toEqual({ name: 'Sam Staff' })
  })

  it('takes a bearer mutation without Origin, and still refuses a cookie mutation without it', async () => {
    const token = await appSignIn()
    expect(await gql(setTheme, bearer(token))).toMatchObject({ status: 200, code: undefined, data: { setTheme: { __typename: 'Profile' } } })
    const { cookie: held } = await auth('/api/auth/sign-in', { email: 'staff@a.example', password }, 'browser')
    expect((await gql(setTheme, cookie(held))).status).toBe(403)
    expect((await gql(setTheme, { ...cookie(held), origin: 'https://evil.example' })).status).toBe(403)
    expect((await gql(setTheme, { ...cookie(held), origin: `https://${host}` })).code).toBeUndefined()
  })

  it('refuses a token on another partner’s host, after sign-out and after its idle bound', async () => {
    const token = await appSignIn()
    expect(await meName(bearer(token), hostB)).toBeNull()
    const signedOut = await auth('/api/auth/sign-out', {}, 'app', token)
    expect(signedOut.status).toBe(302)
    expect(await db.sql`select 1 from user_session where id_hash = ${await hashSessionId(token)}`).toHaveLength(0)
    expect(await meName(bearer(token))).toBeNull()
    const idle = await appSignIn()
    await db.sql`update user_session set last_seen_at = now() - interval '3 hours' where id_hash = ${await hashSessionId(idle)}`
    expect(await meName(bearer(idle))).toBeNull()
  })

  it('refuses X-Store for a store the person isn’t in', async () => {
    const token = await appSignIn()
    expect((await gql('{ storeState { status } }', { ...bearer(token), [storeHeader]: t.storeA1 })).code).toBeUndefined()
    expect((await gql('{ storeState { status } }', { ...bearer(token), [storeHeader]: t.storeA2 })).code).toBe('FORBIDDEN')
  })

  it('never writes the token into the activity log', async () => {
    const token = await appSignIn()
    const [row] = await db.sql<{ n: number }[]>`select count(*)::int as n from activity_log where activity_log::text like ${`%${token}%`}`
    expect(row?.n).toBe(0)
  })
})

describe('limits on the body-token path', () => {
  it('keeps the rate limit', async () => {
    allowAttempts = false
    try {
      expect((await auth('/api/auth/sign-in', { email: 'staff@a.example', password }, 'app')).body).toEqual({ ok: false, code: 'RATE_LIMITED' })
    } finally {
      allowAttempts = true
    }
  })

  it('locks after five wrong passwords, refusing the right one meanwhile', async () => {
    await user('locky@a.example', 'Lee Locky')
    for (let i = 0; i < 5; i++) expect((await auth('/api/auth/sign-in', { email: 'locky@a.example', password: 'wrong-wrong-wrong' }, 'app')).body).toEqual({ ok: false, code: 'INVALID_CREDENTIALS' })
    expect((await auth('/api/auth/sign-in', { email: 'locky@a.example', password }, 'app')).body).toMatchObject({ ok: false, code: 'LOCKED' })
  })
})
