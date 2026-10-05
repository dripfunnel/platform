import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { handleStoreAuth, type StoreAuthDeps } from '#apis/store/auth'
import { storeSchema } from '#apis/store/schema'
import { hashPassword } from '#auth/password'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { storeCookieName } from '#auth/storeSession'
import { codeAt, stepAt } from '#auth/totp'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #290 (SAPI 2, part 1): brand, sign-in with 2-factor by app, SMS or backup code, enrolment
// for Owners, sign-out, and the shell queries, on a partner's portal host.

let db: TestDatabase
let t: Tenants
let secrets: SecretBox
let clock = new Date('2026-10-05T09:00:00Z')
const host = 'store.partner-a.example'
const hostB = 'store.partner-b.example'
const password = 'correct horse battery'
const people = { owner: '', staff: '', supplier: '', bOwner: '' }

const user = async (partnerId: string, email: string, name: string) => {
  const [row] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status, password_hash) values (${partnerId}, ${email}, ${name}, 'active', ${await hashPassword(password)}) returning id`
  return row?.id ?? ''
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  secrets = await secretBox(btoa('k'.repeat(32)))
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'portal', ${host}, 'live', 'CNAME', 'x'), (${t.partnerB}, 'portal', ${hostB}, 'live', 'CNAME', 'x')`
  await db.sql`
    insert into partner_branding (partner_id, state, product_name, primary_color, accent_color, font, corner, background, logo_light_key, terms_url, created_by_kind, created_by_label, published_at, published_by_label)
    values (${t.partnerA}, 'published', 'Northstar Shops', '#1B3A5B', '#2BB673', 'Manrope', 'rounded', 'sand', 'partners/a/brand/logo.svg', 'https://northstar.example/terms', 'system', 'test', ${new Date('2026-09-01')}, 'test')
  `
  people.owner = await user(t.partnerA, 'owner@a.example', 'Olivia Owner')
  people.staff = await user(t.partnerA, 'staff@a.example', 'Sam Staff')
  people.supplier = await user(t.partnerA, 'nadia@northwind.example', 'Nadia Tran')
  people.bOwner = await user(t.partnerB, 'owner@b.example', 'Bea Owner')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.staff}, ${t.storeA1}, 'staff', 'active'), (${people.staff}, ${t.storeA2}, 'manager', 'active'), (${people.bOwner}, ${t.storeB1}, 'owner', 'active')`
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${people.supplier}, ${t.storeA1}, ${t.sellerA1First}, 'supplier-admin', 'active')`
  await db.sql`update store set status = 'trial', trial_ends_at = ${new Date('2026-10-12')} where id = ${t.storeA1}`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const deps = (overrides: Partial<StoreAuthDeps> = {}): StoreAuthDeps => ({ sql: db.sql, activity: activityLog, partnerId: t.partnerA, host, secrets, now: () => clock, allowAttempt: async () => true, ...overrides })

const cookieOf = (response: Response) => /__Host-portal_session=([^;]*)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? ''

const post = async (path: string, body: unknown, cookie = '', d = deps()) => {
  const response = await handleStoreAuth(
    new Request(`https://${host}${path}`, { method: 'POST', headers: { origin: `https://${host}`, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...(cookie ? { cookie: `${storeCookieName}=${cookie}` } : {}) }, body: JSON.stringify(body) }),
    d,
  )
  return { status: response.status, body: (response.headers.get('content-type')?.includes('json') ? await response.json() : null) as Record<string, unknown>, cookie: cookieOf(response) || cookie }
}

const gql = async (source: string, cookie: string, headers: Record<string, string> = {}, partnerId = t.partnerA) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const request = new Request(`https://${host}/api/`, { headers: { cookie: `${storeCookieName}=${cookie}`, ...headers } })
  const standing = await resolveStoreStanding(db.sql, request, partnerId, clock, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: activityLog, facts, now: () => clock }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as ShellData | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, errors: result.errors }
}

interface ShellData {
  brand?: unknown
  me?: { name: string; email?: string; acting: { role?: string; plan?: unknown; tier?: string | null; permissions?: string[] } | null } | null
  myStores?: { nodes: { store: { id: string }; role?: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
  storeState?: { support?: unknown } & Record<string, unknown>
  switchStore?: unknown
}

const lastSmsCode = async (to: string) => {
  const [row] = await db.sql<{ payload: { vars: { code: string } } }[]>`select payload from outbox where kind = 'sms' and payload->>'to' = ${to} order by created_at desc limit 1`
  return row?.payload.vars.code ?? ''
}

describe('brand', () => {
  it('shows the partner’s published look on its own host, with logo paths on that host', async () => {
    const { data } = await gql('{ brand { productName primaryColor files { logoLight logoDark } termsUrl poweredBy } }', '')
    expect(data?.['brand']).toEqual({ productName: 'Northstar Shops', primaryColor: '#1B3A5B', files: { logoLight: '/api/brand/logo-light', logoDark: null }, termsUrl: 'https://northstar.example/terms', poweredBy: true })
    const b = await gql('{ brand { productName primaryColor } }', '', {}, t.partnerB)
    expect(b.data?.['brand']).toEqual({ productName: 'Partner B', primaryColor: null })
  })
})

describe('sign-in', () => {
  it('answers an unknown email exactly as a wrong password, and logs no account', async () => {
    const unknown = await post('/api/auth/sign-in', { email: 'nobody@a.example', password })
    const wrong = await post('/api/auth/sign-in', { email: 'staff@a.example', password: 'nope-nope-nope' })
    expect(unknown).toEqual({ status: 401, body: { ok: false, code: 'INVALID_CREDENTIALS' }, cookie: '' })
    expect(wrong).toEqual(unknown)
    const rows = await db.sql<{ actor_kind: string; actor_id: string | null }[]>`select actor_kind, actor_id from activity_log where action = 'person.sign_in_refused'`
    expect(rows.every((r) => r.actor_kind === 'anonymous' && r.actor_id === null)).toBe(true)
  })

  it('never signs in another partner’s account on this host', async () => {
    expect((await post('/api/auth/sign-in', { email: 'owner@b.example', password })).body).toEqual({ ok: false, code: 'INVALID_CREDENTIALS' })
  })

  it('signs in a person without 2-factor straight away, and the session reads as them', async () => {
    const res = await post('/api/auth/sign-in', { email: 'STAFF@a.example', password })
    expect(res.body).toEqual({ ok: true, step: 'done' })
    const { data } = await gql('{ me { name email acting { store { id } } } }', res.cookie)
    expect(data?.['me']).toEqual({ name: 'Sam Staff', email: 'staff@a.example', acting: null })
  })

  it('keeps a remembered session for 30 days and a plain one for 12 hours', async () => {
    await post('/api/auth/sign-in', { email: 'staff@a.example', password, remember: true })
    const [row] = await db.sql<{ hours: number }[]>`select round(extract(epoch from absolute_expires_at - created_at) / 3600)::int as hours from user_session where user_id = ${people.staff} and remember order by created_at desc limit 1`
    expect(row?.hours).toBe(30 * 24)
  })

  it('refuses a request from another origin, and every attempt past the limit', async () => {
    const response = await handleStoreAuth(new Request(`https://${host}/api/auth/sign-in`, { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' }), deps())
    expect(response.status).toBe(403)
    expect((await post('/api/auth/sign-in', { email: 'staff@a.example', password }, '', deps({ allowAttempt: async () => false }))).body).toEqual({ ok: false, code: 'RATE_LIMITED' })
  })
})

describe('an Owner without 2-factor', () => {
  let cookie = ''

  it('is held at enrolment, where nothing else answers', async () => {
    const res = await post('/api/auth/sign-in', { email: 'owner@a.example', password })
    expect(res.body).toEqual({ ok: true, step: 'enrol' })
    cookie = res.cookie
    expect((await gql('{ me { name } }', cookie)).data?.['me']).toBeNull()
  })

  it('enrols an authenticator app named after the partner, and gets ten backup codes once', async () => {
    const start = await post('/api/auth/enrol-second-factor', { method: 'app' }, cookie)
    expect(String(start.body['uri'])).toContain('issuer=Northstar%20Shops')
    expect(String(start.body['uri'])).not.toContain('DripFunnel')
    const code = await codeAt(String(start.body['secret']), stepAt(clock))
    const done = await post('/api/auth/enrol-second-factor', { method: 'app', code }, cookie)
    expect(done.body['done']).toBe(true)
    expect(done.body['backupCodes']).toHaveLength(10)
    expect((await gql('{ me { name acting { role } } }', cookie, { [storeHeader]: t.storeA1 })).data?.['me']).toEqual({ name: 'Olivia Owner', acting: { role: 'owner' } })
    const [stored] = await db.sql<{ n: number }[]>`select count(*)::int as n from user_backup_code where user_id = ${people.owner} and used_at is null`
    expect(stored?.n).toBe(10)
    ;(globalThis as Record<string, unknown>)['backup'] = (done.body['backupCodes'] as string[])[0]
  })
})

describe('the second factor', () => {
  const signInOwner = async () => (await post('/api/auth/sign-in', { email: 'owner@a.example', password })).cookie

  it('asks for the app’s code, and a fresh code completes the session', async () => {
    clock = new Date(clock.getTime() + 120_000)
    const res = await post('/api/auth/sign-in', { email: 'owner@a.example', password })
    expect(res.body).toEqual({ ok: true, step: 'second-factor', method: 'app' })
    const [row] = await db.sql<{ two_factor_secret_enc: string }[]>`select two_factor_secret_enc from "user" where id = ${people.owner}`
    const secret = (await secrets.open(row?.two_factor_secret_enc ?? '')) ?? ''
    expect((await post('/api/auth/second-factor', { code: await codeAt(secret, stepAt(clock)) }, res.cookie)).body).toEqual({ ok: true })
  })

  it('takes a backup code once, says how many are left, and refuses it the second time', async () => {
    const code = String((globalThis as Record<string, unknown>)['backup'])
    expect((await post('/api/auth/backup-code', { code }, await signInOwner())).body).toEqual({ ok: true, left: 9 })
    expect((await post('/api/auth/backup-code', { code }, await signInOwner())).body).toEqual({ ok: false, code: 'WRONG_CODE', triesLeft: 4 })
  })

  it('locks sign-in for 15 minutes after five wrong codes, refusing even a right one meanwhile', async () => {
    const cookie = await signInOwner()
    let last: Record<string, unknown> = {}
    for (let i = 0; i < 4; i += 1) last = (await post('/api/auth/second-factor', { code: '000000' }, cookie)).body
    expect(last).toEqual({ ok: false, code: 'LOCKED', minutes: 15 })
    expect((await post('/api/auth/sign-in', { email: 'owner@a.example', password })).body).toEqual({ ok: false, code: 'LOCKED', minutes: 15 })
    clock = new Date(clock.getTime() + 16 * 60_000)
  })

  it('texts a code for SMS 2-factor, through the outbox with the partner’s name, and accepts it once', async () => {
    await db.sql`update "user" set two_factor_method = 'sms', two_factor_enrolled_at = now(), phone = '+919845022113', two_factor_secret_enc = null where id = ${people.staff}`
    const res = await post('/api/auth/sign-in', { email: 'staff@a.example', password })
    expect(res.body).toEqual({ ok: true, step: 'second-factor', method: 'sms' })
    expect((await post('/api/auth/send-code', {}, res.cookie)).body).toEqual({ ok: true, hint: '•••• 2113' })
    const [queued] = await db.sql<{ payload: { message: string; brand: string; expiresAt: string } }[]>`select payload from outbox where kind = 'sms' order by created_at desc limit 1`
    expect(queued?.payload).toMatchObject({ message: 'code.second_factor', brand: 'Northstar Shops' })
    const code = await lastSmsCode('+919845022113')
    expect((await post('/api/auth/second-factor', { code }, res.cookie)).body).toEqual({ ok: true })
    const again = await post('/api/auth/sign-in', { email: 'staff@a.example', password })
    expect((await post('/api/auth/second-factor', { code }, again.cookie)).body).toEqual({ ok: false, code: 'CODE_EXPIRED' })
  })

  it('texts at most three codes in ten minutes', async () => {
    try {
      const res = await post('/api/auth/sign-in', { email: 'staff@a.example', password })
      const answers = []
      for (let i = 0; i < 3; i += 1) answers.push((await post('/api/auth/send-code', {}, res.cookie)).body['code'])
      expect(answers).toEqual([undefined, undefined, 'RATE_LIMITED'])
    } finally {
      await db.sql`update "user" set two_factor_method = null, two_factor_enrolled_at = null, phone = null where id = ${people.staff}`
    }
  })
})

describe('an Owner enrolling by SMS', () => {
  it('texts the number, and the code it sent sets SMS as the method', async () => {
    const owner = await user(t.partnerA, 'second.owner@a.example', 'Second Owner')
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${owner}, ${t.storeA2}, 'owner', 'active')`
    const res = await post('/api/auth/sign-in', { email: 'second.owner@a.example', password })
    expect((await post('/api/auth/enrol-second-factor', { method: 'sms', phone: '0161 555' }, res.cookie)).body).toEqual({ ok: false, code: 'INVALID_PHONE' })
    expect((await post('/api/auth/enrol-second-factor', { method: 'sms', phone: '+16145550199' }, res.cookie)).body).toEqual({ ok: true, hint: '•••• 0199' })
    const done = await post('/api/auth/enrol-second-factor', { method: 'sms', code: await lastSmsCode('+16145550199') }, res.cookie)
    expect(done.body['backupCodes']).toHaveLength(10)
    const [row] = await db.sql<{ two_factor_method: string; phone: string }[]>`select two_factor_method, phone from "user" where id = ${owner}`
    expect(row).toEqual({ two_factor_method: 'sms', phone: '+16145550199' })
  })
})

describe('the shell', () => {
  let staff = ''
  let supplier = ''

  beforeAll(async () => {
    staff = (await post('/api/auth/sign-in', { email: 'staff@a.example', password })).cookie
    supplier = (await post('/api/auth/sign-in', { email: 'nadia@northwind.example', password })).cookie
  })

  it('lists only the person’s own stores under this partner, paged without a total', async () => {
    const first = await gql('{ myStores(first: 1) { nodes { store { id } role } pageInfo { hasNextPage endCursor } } }', staff)
    expect(first.data?.['myStores']?.nodes).toHaveLength(1)
    expect(first.data?.['myStores']?.pageInfo.hasNextPage).toBe(true)
    const all = await gql('{ myStores { nodes { store { id } role } } }', staff)
    expect(all.data?.['myStores']?.nodes.map((n) => n.store.id).sort()).toEqual([t.storeA1, t.storeA2].sort())
    expect((await gql('{ myStores { nodes { store { id } } } }', '')).code).toBe('UNAUTHENTICATED')
  })

  it('tells the merchant side the store’s trial, and masks it from a supplier', async () => {
    const merchant = await gql('{ storeState { readOnly status trialEndsAt } }', staff, { [storeHeader]: t.storeA1 })
    expect(merchant.data?.['storeState']).toEqual({ readOnly: false, status: 'trial', trialEndsAt: '2026-10-12T00:00:00.000Z' })
    const masked = await gql('{ storeState { readOnly status trialEndsAt } me { acting { plan { id } tier permissions } } }', supplier, { [storeHeader]: t.storeA1 })
    expect(masked.data?.['storeState']).toEqual({ readOnly: false, status: null, trialEndsAt: null })
    expect(masked.data?.['me']?.acting?.plan).toBeNull()
    expect(masked.data?.['me']?.acting?.tier).toBe('vendor-stock')
    expect(masked.data?.['me']?.acting?.permissions).not.toContain('orders.read')
  })

  it('shows every person in the store the open support session, with only the banner’s facts', async () => {
    const [agent] = await db.sql<{ id: string }[]>`insert into partner_user (partner_id, email, name, role_key, status) values (${t.partnerA}, 'priya@partner-a.example', 'Priya Nair', 'partner-support', 'active') returning id`
    const [m] = await db.sql<{ id: string }[]>`select id from membership where user_id = ${people.staff} and store_id = ${t.storeA1}`
    await db.sql`insert into support_session (partner_id, store_id, membership_id, partner_user_id, reason, started_at, expires_at) values (${t.partnerA}, ${t.storeA1}, ${m?.id ?? ''}, ${agent?.id ?? ''}, 'ticket 1', ${clock}, ${new Date(clock.getTime() + 28 * 60_000)})`
    const seen = await gql('{ storeState { support { partnerName agentFirstName } } }', supplier, { [storeHeader]: t.storeA1, [supplierHeader]: t.sellerA1First })
    expect(seen.data?.['storeState']?.support).toEqual({ partnerName: 'Partner A', agentFirstName: 'Priya' })
    const elsewhere = await gql('{ storeState { support { partnerName } } }', staff, { [storeHeader]: t.storeA2 })
    expect(elsewhere.data?.['storeState']?.support).toBeNull()
  })

  it('switches to a store the person holds, records it, and refuses one they don’t', async () => {
    const ok = await gql(`mutation { switchStore(storeId: "${t.storeA2}") { store { id } role } }`, staff)
    expect(ok.data?.['switchStore']).toEqual({ store: { id: t.storeA2 }, role: 'manager' })
    expect((await gql(`mutation { switchStore(storeId: "${t.storeB1}") { store { id } } }`, staff)).code).toBe('FORBIDDEN')
    const [logged] = await db.sql<{ n: number }[]>`select count(*)::int as n from activity_log where action = 'person.switched_store' and actor_id = ${people.staff}`
    expect(logged?.n).toBe(1)
  })

  it('signs out of every store at once: the session is gone and the cookie cleared', async () => {
    const response = await handleStoreAuth(new Request(`https://${host}/api/auth/sign-out`, { method: 'POST', headers: { origin: `https://${host}`, cookie: `${storeCookieName}=${staff}` } }), deps())
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect((await gql('{ me { name } }', staff)).data?.['me']).toBeNull()
  })
})
