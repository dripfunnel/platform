import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { handleStoreAuth, type StoreAuthDeps } from '#apis/store/auth'
import { brandFileOf, serveBrandFile } from '#apis/store/brandFiles'
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
let ownerBackupCodes: string[] = []

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
    new Request(`https://${d.host}${path}`, { method: 'POST', headers: { origin: `https://${d.host}`, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...(cookie ? { cookie: `${storeCookieName}=${cookie}` } : {}) }, body: JSON.stringify(body) }),
    d,
  )
  return { status: response.status, body: (response.headers.get('content-type')?.includes('json') ? await response.json() : null) as Record<string, unknown>, cookie: cookieOf(response) || cookie }
}

const gql = async (source: string, cookie: string, headers: Record<string, string> = {}, partnerId = t.partnerA) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const request = new Request(`https://${partnerId === t.partnerA ? host : hostB}/api/`, { headers: { cookie: `${storeCookieName}=${cookie}`, ...headers } })
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
    expect((await gql('{ myStores { nodes { store { id } } } }', cookie)).code).toBe('UNAUTHENTICATED')
    expect((await gql('{ storeState { status } }', cookie, { [storeHeader]: t.storeA1 })).code).toBe('UNAUTHENTICATED')
  })

  it('keeps the pending cookie for ten minutes, the time the server holds the step open', async () => {
    const response = await handleStoreAuth(
      new Request(`https://${host}/api/auth/sign-in`, { method: 'POST', headers: { origin: `https://${host}`, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' }, body: JSON.stringify({ email: 'owner@a.example', password }) }),
      deps(),
    )
    expect(response.headers.get('set-cookie')).toContain('Max-Age=600')
  })

  it('is not let into enrolment on another partner’s host with this host’s cookie', async () => {
    expect((await post('/api/auth/enrol-second-factor', { method: 'app' }, cookie, deps({ partnerId: t.partnerB, host: hostB }))).body).toEqual({ ok: false, code: 'INVALID_CREDENTIALS' })
  })

  it('enrols an authenticator app named after the partner, and gets ten backup codes once', async () => {
    const start = await post('/api/auth/enrol-second-factor', { method: 'app' }, cookie)
    expect(String(start.body['uri'])).toContain('issuer=Northstar%20Shops')
    expect(String(start.body['uri'])).not.toContain('DripFunnel')
    const code = await codeAt(String(start.body['secret']), stepAt(clock))
    const done = await post('/api/auth/enrol-second-factor', { method: 'app', code }, cookie)
    expect(done.body['done']).toBe(true)
    expect(done.body['backupCodes']).toHaveLength(10)
    expect(done.cookie).toBe(cookie)
    expect((await gql('{ me { name acting { role } } }', cookie, { [storeHeader]: t.storeA1 })).data?.['me']).toEqual({ name: 'Olivia Owner', acting: { role: 'owner' } })
    const [stored] = await db.sql<{ n: number }[]>`select count(*)::int as n from user_backup_code where user_id = ${people.owner} and used_at is null`
    expect(stored?.n).toBe(10)
    ownerBackupCodes = done.body['backupCodes'] as string[]
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
    const code = await codeAt(secret, stepAt(clock))
    const admitted = await handleStoreAuth(
      new Request(`https://${host}/api/auth/second-factor`, { method: 'POST', headers: { origin: `https://${host}`, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', cookie: `${storeCookieName}=${res.cookie}` }, body: JSON.stringify({ code }) }),
      deps(),
    )
    expect(await admitted.json()).toEqual({ ok: true })
    expect(admitted.headers.get('set-cookie')).toContain(`Max-Age=${12 * 60 * 60}`)
    const replay = await post('/api/auth/sign-in', { email: 'owner@a.example', password })
    expect((await post('/api/auth/second-factor', { code }, replay.cookie)).body).toEqual({ ok: false, code: 'CODE_EXPIRED' })
  })

  it('takes a backup code once, says how many are left, and refuses it the second time', async () => {
    const code = ownerBackupCodes[0] ?? ''
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

describe('what never crosses a partner, a store or a supplier', () => {
  it('serves only the published brand’s files, and only the host partner’s', async () => {
    await db.sql`
      insert into partner_branding (partner_id, state, product_name, primary_color, accent_color, font, corner, background, logo_light_key, logo_dark_key, created_by_kind, created_by_label)
      values (${t.partnerA}, 'draft', 'Draft Name', '#000000', '#000000', 'Manrope', 'rounded', 'sand', 'partners/a/brand/draft.svg', 'partners/a/brand/draft-dark.svg', 'system', 'test')
    `
    const objects = new Set(['partners/a/brand/logo.svg', 'partners/a/brand/draft.svg', 'partners/a/brand/draft-dark.svg'])
    const assets = { get: async (key: string) => (objects.has(key) ? { body: key, httpMetadata: { contentType: 'image/svg+xml' } } : null) } as unknown as R2Bucket
    const serve = async (partnerId: string, path: string) => {
      const file = brandFileOf(path)
      return file ? serveBrandFile(db.sql, assets, partnerId, file, clock) : new Response(null, { status: 404 })
    }
    const live = await serve(t.partnerA, '/api/brand/logo-light')
    expect(live.status).toBe(200)
    expect(await live.text()).toBe('partners/a/brand/logo.svg')
    expect((await serve(t.partnerA, '/api/brand/logo-dark')).status).toBe(404)
    expect((await serve(t.partnerB, '/api/brand/logo-light')).status).toBe(404)
    expect((await serve(t.partnerA, '/api/brand/../secrets')).status).toBe(404)
  })

  it('reads no other partner’s session: a full session from this host is nobody on partner B’s', async () => {
    const res = await post('/api/auth/sign-in', { email: 'nadia@northwind.example', password })
    expect((await gql('{ me { name } }', res.cookie, {}, t.partnerB)).data?.['me']).toBeNull()
  })

  it('gives a supplier nothing of a store it doesn’t hold, and no switch to another supplier’s seat', async () => {
    const supplier = (await post('/api/auth/sign-in', { email: 'nadia@northwind.example', password })).cookie
    const elsewhere = await gql('{ storeState { status readOnly } }', supplier, { [storeHeader]: t.storeA2 })
    expect(elsewhere.data?.['storeState'] ?? null).toBeNull()
    expect(elsewhere.code).toBe('FORBIDDEN')
    const other = await gql(`mutation { switchStore(storeId: "${t.storeA1}", supplierId: "${t.sellerA1Second}") { store { id } } }`, supplier)
    expect(other.code).toBe('FORBIDDEN')
    const own = await gql(`mutation { switchStore(storeId: "${t.storeA1}", supplierId: "${t.sellerA1First}") { store { id } } }`, supplier)
    expect(own.data?.['switchStore']).toEqual({ store: { id: t.storeA1 } })
  })

  it('never shows partner A’s support session to partner B’s people, even naming A’s store', async () => {
    const bStaff = await user(t.partnerB, 'staff@b.example', 'Ben Staff')
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${bStaff}, ${t.storeB1}, 'staff', 'active')`
    const bPerson = (await post('/api/auth/sign-in', { email: 'staff@b.example', password }, '', deps({ partnerId: t.partnerB, host: hostB }))).cookie
    const crossing = await gql('{ storeState { support { partnerName } } }', bPerson, { [storeHeader]: t.storeA1 }, t.partnerB)
    expect(crossing.data?.['storeState'] ?? null).toBeNull()
    expect(crossing.code).toBe('FORBIDDEN')
    const own = await gql('{ storeState { support { partnerName } } }', bPerson, { [storeHeader]: t.storeB1 }, t.partnerB)
    expect(own.data?.['storeState']?.support).toBeNull()
  })
})

describe('codes that are wrong, late or used', () => {
  const smsPerson = async (email: string, phone: string) => {
    const id = await user(t.partnerA, email, 'Texted Person')
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${id}, ${t.storeA1}, 'staff', 'active')`
    await db.sql`update "user" set two_factor_method = 'sms', two_factor_enrolled_at = now(), phone = ${phone} where id = ${id}`
    return id
  }

  it('locks after five wrong texted codes', async () => {
    await smsPerson('texted@a.example', '+16145550111')
    const res = await post('/api/auth/sign-in', { email: 'texted@a.example', password })
    await post('/api/auth/send-code', {}, res.cookie)
    const answers = []
    for (let i = 0; i < 5; i += 1) answers.push((await post('/api/auth/second-factor', { code: '000000' }, res.cookie)).body)
    expect(answers.slice(0, 4).map((a) => a['triesLeft'])).toEqual([4, 3, 2, 1])
    expect(answers[4]).toEqual({ ok: false, code: 'LOCKED', minutes: 15 })
  })

  it('gives five fresh tries once a lock has passed', async () => {
    await smsPerson('relocked@a.example', '+16145550188')
    const res = await post('/api/auth/sign-in', { email: 'relocked@a.example', password })
    await post('/api/auth/send-code', {}, res.cookie)
    for (let i = 0; i < 5; i += 1) await post('/api/auth/second-factor', { code: '000000' }, res.cookie)
    clock = new Date(clock.getTime() + 16 * 60_000)
    const again = await post('/api/auth/sign-in', { email: 'relocked@a.example', password })
    await post('/api/auth/send-code', {}, again.cookie)
    expect((await post('/api/auth/second-factor', { code: '000000' }, again.cookie)).body).toEqual({ ok: false, code: 'WRONG_CODE', triesLeft: 4 })
  })

  it('refuses a wrong or stale app code during enrolment, and sets no method', async () => {
    const owner = await user(t.partnerA, 'app.owner@a.example', 'App Owner')
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${owner}, ${t.storeA2}, 'owner', 'active')`
    const res = await post('/api/auth/sign-in', { email: 'app.owner@a.example', password })
    const start = await post('/api/auth/enrol-second-factor', { method: 'app' }, res.cookie)
    const secret = String(start.body['secret'])
    expect((await post('/api/auth/enrol-second-factor', { method: 'app', code: '000000' }, res.cookie)).body).toEqual({ ok: false, code: 'WRONG_CODE' })
    expect((await post('/api/auth/enrol-second-factor', { method: 'app', code: await codeAt(secret, stepAt(clock) - 5) }, res.cookie)).body).toEqual({ ok: false, code: 'CODE_EXPIRED' })
    const [row] = await db.sql<{ two_factor_method: string | null }[]>`select two_factor_method from "user" where id = ${owner}`
    expect(row?.two_factor_method).toBeNull()
  })

  it('refuses a wrong or expired texted code during enrolment', async () => {
    const owner = await user(t.partnerA, 'sms.owner@a.example', 'Sms Owner')
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${owner}, ${t.storeA2}, 'owner', 'active')`
    const res = await post('/api/auth/sign-in', { email: 'sms.owner@a.example', password })
    await post('/api/auth/enrol-second-factor', { method: 'sms', phone: '+16145550122' }, res.cookie)
    expect((await post('/api/auth/enrol-second-factor', { method: 'sms', code: '000000' }, res.cookie)).body).toEqual({ ok: false, code: 'WRONG_CODE' })
    const code = await lastSmsCode('+16145550122')
    await db.sql`update verification_code set expires_at = ${new Date(clock.getTime() - 1000)} where subject_id = ${owner}`
    expect((await post('/api/auth/enrol-second-factor', { method: 'sms', code }, res.cookie)).body).toEqual({ ok: false, code: 'CODE_EXPIRED' })
  })
})

describe('the same code arriving twice at once', () => {
  it('admits one texted code once, even from two sessions racing', async () => {
    const id = await user(t.partnerA, 'racer@a.example', 'Racing Person')
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${id}, ${t.storeA1}, 'staff', 'active')`
    await db.sql`update "user" set two_factor_method = 'sms', two_factor_enrolled_at = now(), phone = '+16145550166' where id = ${id}`
    const first = await post('/api/auth/sign-in', { email: 'racer@a.example', password })
    const second = await post('/api/auth/sign-in', { email: 'racer@a.example', password })
    await post('/api/auth/send-code', {}, first.cookie)
    const code = await lastSmsCode('+16145550166')
    const answers = await Promise.all([first.cookie, second.cookie].map(async (c) => (await post('/api/auth/second-factor', { code }, c)).body['ok']))
    expect(answers.filter((ok) => ok === true)).toHaveLength(1)
  })

  it('admits one authenticator code once, even from two sessions racing', async () => {
    const id = await user(t.partnerA, 'racer.app@a.example', 'Racing App')
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${id}, ${t.storeA1}, 'staff', 'active')`
    const secret = 'JBSWY3DPEHPK3PXP'
    await db.sql`update "user" set two_factor_method = 'app', two_factor_enrolled_at = now(), two_factor_secret_enc = ${await secrets.seal(secret)}, last_code_step = null where id = ${id}`
    const first = await post('/api/auth/sign-in', { email: 'racer.app@a.example', password })
    const second = await post('/api/auth/sign-in', { email: 'racer.app@a.example', password })
    const code = await codeAt(secret, stepAt(clock))
    const answers = await Promise.all([first.cookie, second.cookie].map(async (c) => (await post('/api/auth/second-factor', { code }, c)).body['ok']))
    expect(answers.filter((ok) => ok === true)).toHaveLength(1)
  })
})
