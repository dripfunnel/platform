import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { StoreContext } from '#apis/store/access'
import { handleStoreAuth } from '#apis/store/auth'
import { handleStoreGoogle, type StoreGoogleDeps } from '#apis/store/google'
import { storeSchema } from '#apis/store/schema'
import { SignInFailed } from '#auth/oidc'
import type { PartnerCaller } from '#auth/partnerCaller'
import { hashPassword } from '#auth/password'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { resolveStoreStanding } from '#auth/storeCaller'
import type { GoogleClaims, GoogleSignIn } from '#integrations/google/provider'
import { activityLog } from '#saas/activity/index'
import { createGoogleSignInService } from '#saas/googleSignIn/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #1046: each partner's own Google client, set on Integrations, and "Continue with Google" on its portal host.

let db: TestDatabase
let t: Tenants
let secrets: SecretBox
const now = new Date('2026-10-30T09:00:00Z')
const host = 'store.partner-a.example'
const hostB = 'store.partner-b.example'
// Built, not written out: GitHub's push protection reads a literal in Google's shape as a leaked credential.
const googleClient = (prefix: string) => [prefix, 'apps', 'googleusercontent', 'com'].join('.')
const clientA = googleClient('111-a')
const clientB = googleClient('222-b')
const secretA = ['GOCSPX', 'a'.repeat(28)].join('-')
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }

/** Google, as far as the routes can tell: codes and ID tokens stand for claims, each for one client. */
const codes = new Map<string, { claims: GoogleClaims; clientId: string }>()
const exchanged: { clientSecret: string; codeVerifier: string; redirectUri: string }[] = []
const google: GoogleSignIn = {
  authorizeUrl: ({ clientId, redirectUri, state, nonce, codeChallenge }) => `https://accounts.example/auth?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, nonce, code_challenge: codeChallenge })}`,
  exchange: async ({ client, code, codeVerifier, redirectUri }) => {
    exchanged.push({ clientSecret: client.clientSecret, codeVerifier, redirectUri })
    const found = codes.get(code)
    if (!found || found.clientId !== client.clientId) throw new SignInFailed('bad_claims')
    return found.claims
  },
  verify: async (idToken, clientId) => {
    const found = codes.get(idToken)
    if (!found || found.clientId !== clientId) throw new SignInFailed('bad_claims')
    return found.claims
  },
}

const callerOf = (partnerId: string): PartnerCaller => ({
  role: 'partner-owner',
  user: { id: crypto.randomUUID(), name: 'Maya Chen', email: 'maya@northstar.example' },
  staff: null,
  partner: { id: partnerId, name: 'Northstar Commerce', product: 'Northstar Shops', host: null, state: 'live' },
})

const platform = async <T,>(source: string, partnerId: string, variables: Record<string, unknown> = {}) => {
  const caller = callerOf(partnerId)
  const googleSignIn = createGoogleSignInService({ sql: db.sql, caller, facts, activity: activityLog, secrets, now: () => now })
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue: { caller, googleSignIn } })
  if (result.errors?.[0] && result.errors[0].extensions['code'] === undefined) throw result.errors[0]
  return result.data as T
}

const save = `mutation($clientId: String!, $clientSecret: String!) { savePartnerGoogleSignIn(clientId: $clientId, clientSecret: $clientSecret) { ok reason } }`
const status = `{ partnerGoogleSignIn { enabled clientId secretHint redirectUri } }`

const user = async (partnerId: string, email: string, name: string, extra: { status?: string; twoFactor?: 'sms' } = {}) => {
  const [row] = await db.sql<{ id: string }[]>`
    insert into "user" (partner_id, email, name, status, password_hash, two_factor_method, two_factor_enrolled_at, phone)
    values (${partnerId}, ${email}, ${name}, ${extra.status ?? 'active'}, ${extra.status === 'invited' ? null : await hashPassword('correct horse battery')}, ${extra.twoFactor ?? null}, ${extra.twoFactor ? now : null}, ${extra.twoFactor ? '+919800000001' : null})
    returning id`
  return row?.id ?? ''
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  secrets = await secretBox(Buffer.alloc(32, 7).toString('base64'))
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'portal', ${host}, 'live', 'CNAME', 'x'), (${t.partnerB}, 'portal', ${hostB}, 'live', 'CNAME', 'x')`
  await db.sql`update partner set state = 'live' where id in (${t.partnerA}, ${t.partnerB})`
  const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${t.partnerA}, 'Basic', 'live') returning id`
  await db.sql`insert into plan_price (plan_id, partner_id, version, currency, monthly_amount) values (${plan?.id ?? ''}, ${t.partnerA}, 1, 'INR', 99900)`
  const owner = await user(t.partnerA, 'owner@a.example', 'Olivia Owner')
  const staff = await user(t.partnerA, 'staff@a.example', 'Sam Staff')
  const twoStep = await user(t.partnerA, 'two@a.example', 'Tara Two', { twoFactor: 'sms' })
  await user(t.partnerA, 'invited@a.example', 'Ivy Invited', { status: 'invited' })
  await user(t.partnerB, 'owner@b.example', 'Bea Owner')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${owner}, ${t.storeA1}, 'owner', 'active'), (${staff}, ${t.storeA1}, 'staff', 'active'), (${twoStep}, ${t.storeA1}, 'staff', 'active')`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const deps = (overrides: Partial<StoreGoogleDeps> = {}): StoreGoogleDeps => ({ sql: db.sql, activity: activityLog, partnerId: t.partnerA, host, secrets, now: () => now, allowAttempt: async () => true, codeCheck: '0', google, local: false, ...overrides })

const cookieValues = (response: Response) => Object.fromEntries(response.headers.getSetCookie().map((c) => c.split(';')[0]?.split('=') ?? []).filter((kv) => kv.length === 2))

const get = async (path: string, cookie = '', d = deps()) => {
  const response = await handleStoreGoogle(new Request(`https://${d.host}${path}`, { headers: { 'cf-connecting-ip': '203.0.113.7', ...(cookie ? { cookie } : {}) } }), d)
  return { status: response.status, location: response.headers.get('location') ?? '', cookies: cookieValues(response) }
}

/** Start, then come back from "Google" as `email` with the state Google was given. */
const through = async (intent: 'sign-in' | 'sign-up', claims: GoogleClaims, d = deps(), clientId = clientA) => {
  const started = await get(`/api/auth/google/start?intent=${intent}`, '', d)
  const state = new URL(started.location).searchParams.get('state') ?? ''
  const code = crypto.randomUUID()
  codes.set(code, { claims, clientId })
  return get(`/api/auth/google/callback?state=${state}&code=${code}`, `__Host-df_google=${started.cookies['__Host-df_google'] ?? ''}`, d)
}

const lastRefusal = async () => (await db.sql<{ reason: string }[]>`select reason from activity_log where action = 'person.sign_in_refused' order by occurred_at desc, id desc limit 1`)[0]?.reason

describe('the partner’s Google client on Integrations', () => {
  it('offers no Google until the partner saves its client, and shows the address to register', async () => {
    const before = await platform<{ partnerGoogleSignIn: Record<string, unknown> }>(status, t.partnerA)
    expect(before.partnerGoogleSignIn).toEqual({ enabled: false, clientId: null, secretHint: null, redirectUri: `https://${host}/api/auth/google/callback` })
    expect((await get('/api/auth/google/start?intent=sign-in')).location).toBe('/sign-in?outcome=unavailable')
  })

  it('refuses a client id or secret that isn’t Google’s shape', async () => {
    const bad = await platform<{ savePartnerGoogleSignIn: unknown }>(save, t.partnerA, { clientId: 'not-a-client', clientSecret: secretA })
    expect(bad.savePartnerGoogleSignIn).toEqual({ ok: false, reason: 'INVALID_INPUT' })
  })

  it('saves the client sealed, shows the secret only by its ends, and logs it', async () => {
    expect((await platform<{ savePartnerGoogleSignIn: unknown }>(save, t.partnerA, { clientId: clientA, clientSecret: secretA })).savePartnerGoogleSignIn).toEqual({ ok: true, reason: null })
    const after = await platform<{ partnerGoogleSignIn: Record<string, unknown> }>(status, t.partnerA)
    expect(after.partnerGoogleSignIn).toMatchObject({ enabled: true, clientId: clientA, secretHint: 'GOCSPX-…aaaa' })
    const [row] = await db.sql<{ secret_enc: string }[]>`select secret_enc from partner_google_sign_in where partner_id = ${t.partnerA}`
    expect(row?.secret_enc).not.toContain(secretA)
    expect((await db.sql`select 1 from activity_log where action = 'partner.google_sign_in_saved' and partner_id = ${t.partnerA}`).length).toBe(1)
  })

  it('tells the portal whether Google is on, per partner', async () => {
    await platform(save, t.partnerB, { clientId: clientB, clientSecret: secretA })
    await platform(`mutation { turnOffPartnerGoogleSignIn { ok } }`, t.partnerB)
    const brand = async (partnerId: string) => {
      const request = new Request(`https://${partnerId === t.partnerA ? host : hostB}/api/`)
      const standing = await resolveStoreStanding(db.sql, request, partnerId, now, activityLog, facts)
      const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: activityLog, facts, now: () => now }
      return ((await graphql({ schema: storeSchema as GraphQLSchema, source: '{ brand { googleSignIn } }', contextValue })).data as { brand: { googleSignIn: boolean } }).brand.googleSignIn
    }
    expect(await brand(t.partnerA)).toBe(true)
    expect(await brand(t.partnerB)).toBe(false)
    expect((await get('/api/auth/google/start?intent=sign-in', '', deps({ partnerId: t.partnerB, host: hostB }))).location).toBe('/sign-in?outcome=unavailable')
  })
})

describe('signing in with Google', () => {
  it('sends the browser to the partner’s client with PKCE, and exchanges with its secret and the verifier', async () => {
    const started = await get('/api/auth/google/start?intent=sign-in')
    const sent = new URL(started.location).searchParams
    expect(sent.get('client_id')).toBe(clientA)
    expect(sent.get('redirect_uri')).toBe(`https://${host}/api/auth/google/callback`)
    expect(sent.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    await through('sign-in', { email: 'staff@a.example', name: 'Sam' })
    const last = exchanged.at(-1)
    expect(last?.clientSecret).toBe(secretA)
    expect(last?.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('signs in an account with no second step, and logs it as Google’s', async () => {
    const back = await through('sign-in', { email: 'STAFF@a.example', name: 'Sam' })
    expect(back.location).toBe('/')
    expect(back.cookies['__Host-portal_session']).toMatch(/.+/)
    const [entry] = await db.sql<{ reason: string }[]>`select reason from activity_log where action = 'person.signed_in' order by occurred_at desc, id desc limit 1`
    expect(entry?.reason).toBe('google')
  })

  it('still asks for the second factor, and sends an Owner without one to set it up', async () => {
    expect((await through('sign-in', { email: 'two@a.example', name: 'Tara' })).location).toBe('/sign-in?step=second-factor&method=sms')
    expect((await through('sign-in', { email: 'owner@a.example', name: 'Olivia' })).location).toBe('/sign-in?step=enrol')
  })

  it('refuses an address with no account here, an invitation not yet accepted, and another partner’s account', async () => {
    for (const email of ['nobody@a.example', 'invited@a.example', 'owner@b.example']) {
      const back = await through('sign-in', { email, name: 'X' })
      expect(back).toMatchObject({ location: '/sign-in?outcome=no-account', cookies: { '__Host-df_google': '' } })
      expect(back.cookies['__Host-portal_session']).toBeUndefined()
      expect(await lastRefusal()).toBe('google_no_account')
    }
  })

  it('refuses a callback whose state isn’t the one it sent, and says when the person cancelled', async () => {
    const started = await get('/api/auth/google/start?intent=sign-in')
    const handshake = `__Host-df_google=${started.cookies['__Host-df_google'] ?? ''}`
    expect((await get('/api/auth/google/callback?state=forged&code=x', handshake)).location).toBe('/sign-in?outcome=refused')
    const state = new URL(started.location).searchParams.get('state') ?? ''
    expect((await get(`/api/auth/google/callback?state=${state}&error=access_denied`, handshake)).location).toBe('/sign-in?outcome=cancelled')
    expect((await get('/api/auth/google/callback?state=x&code=x')).location).toBe('/sign-in?outcome=refused')
  })

  it('refuses what Google’s answer doesn’t prove, and logs it', async () => {
    const started = await get('/api/auth/google/start?intent=sign-in')
    const state = new URL(started.location).searchParams.get('state') ?? ''
    expect((await get(`/api/auth/google/callback?state=${state}&code=unknown`, `__Host-df_google=${started.cookies['__Host-df_google'] ?? ''}`)).location).toBe('/sign-in?outcome=refused')
    expect(await lastRefusal()).toBe('google_refused')
  })

  it('never takes another partner’s client’s answer on this host', async () => {
    expect((await through('sign-in', { email: 'staff@a.example', name: 'Sam' }, deps(), clientB)).location).toBe('/sign-in?outcome=refused')
  })
})

describe('signing up with Google', () => {
  it('starts at the store step with Google’s name and address and no password, then makes an account without one', async () => {
    const back = await through('sign-up', { email: 'farhan@gmail.example', name: 'Farhan Ali' })
    expect(back.location).toBe('/sign-up?step=store')
    const signup = back.cookies['__Host-portal_signup'] ?? ''
    const post = async (path: string, body: unknown) => {
      const response = await handleStoreAuth(new Request(`https://${host}${path}`, { method: 'POST', headers: { origin: `https://${host}`, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', cookie: `__Host-portal_signup=${signup}` }, body: JSON.stringify(body) }), deps())
      return (await response.json()) as Record<string, unknown>
    }
    const resumed = await handleStoreGoogle(new Request(`https://${host}/api/auth/sign-up/resume`, { method: 'POST', headers: { origin: `https://${host}`, 'cf-connecting-ip': '203.0.113.7', cookie: `__Host-portal_signup=${signup}` } }), deps())
    expect(await resumed.json()).toMatchObject({ ok: true, step: 'store', name: 'Farhan Ali', email: 'farhan@gmail.example', countries: [{ code: 'IN' }] })
    expect(await post('/api/auth/sign-up/store', { storeName: 'Juniper & Co.', subdomain: 'juniper-google', country: 'IN' })).toMatchObject({ ok: true })
    expect(await post('/api/auth/sign-up/send-phone', { phone: '+919800000099' })).toMatchObject({ ok: true })
    expect(await post('/api/auth/sign-up/verify-phone', { code: '000000' })).toMatchObject({ ok: true })
    const [made] = await db.sql<{ password_hash: string | null; password_changed_at: Date | null; email_verified_at: Date | null }[]>`select password_hash, password_changed_at, email_verified_at from "user" where email = 'farhan@gmail.example'`
    expect(made).toEqual({ password_hash: null, password_changed_at: null, email_verified_at: now })
  })

  it('signs an address that already has an account into it, rather than starting a second', async () => {
    expect((await through('sign-up', { email: 'staff@a.example', name: 'Sam' })).location).toBe('/')
  })

  it('is closed while the partner isn’t Live', async () => {
    await db.sql`update partner set state = 'awaiting' where id = ${t.partnerA}`
    try {
      expect((await through('sign-up', { email: 'late@gmail.example', name: 'Late' })).location).toBe('/sign-up?outcome=closed')
    } finally {
      await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
    }
  })
})

describe('the merchant app’s Google token', () => {
  const exchange = async (idToken: string, d = deps()) => {
    const response = await handleStoreGoogle(new Request(`https://${d.host}/api/auth/google/token`, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' }, body: JSON.stringify({ idToken }) }), d)
    return { status: response.status, body: (await response.json()) as Record<string, unknown> }
  }

  it('opens a session in the body for a token issued for the partner’s client', async () => {
    codes.set('token-staff', { claims: { email: 'staff@a.example', name: 'Sam' }, clientId: clientA })
    expect(await exchange('token-staff')).toMatchObject({ status: 200, body: { ok: true, step: 'done', token: expect.any(String) } })
  })

  it('refuses a token for another client, says when there is no account, and refuses a browser', async () => {
    codes.set('token-other', { claims: { email: 'staff@a.example', name: 'Sam' }, clientId: clientB })
    expect(await exchange('token-other')).toEqual({ status: 401, body: { ok: false, code: 'GOOGLE_REFUSED' } })
    codes.set('token-nobody', { claims: { email: 'nobody@a.example', name: 'N' }, clientId: clientA })
    expect(await exchange('token-nobody')).toEqual({ status: 401, body: { ok: false, code: 'NO_ACCOUNT' } })
    const browser = await handleStoreGoogle(new Request(`https://${host}/api/auth/google/token`, { method: 'POST', headers: { origin: `https://${host}`, 'cf-connecting-ip': '203.0.113.7' }, body: '{}' }), deps())
    expect(browser.status).toBe(403)
  })
})
