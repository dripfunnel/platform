import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleStoreAuth, type StoreAuthDeps } from '#apis/store/auth'
import { createUserSession } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #1136: a signed-in person opens another store under the partner as its Owner, on sign-up's
// store step, with no new account and no texted code (SAAS.md §4.1, §5; FIRST-RELEASE §4).

let db: TestDatabase
let t: Tenants
const now = new Date('2026-11-01T09:00:00Z')
const host = 'store.partner-a.example'
const hostB = 'store.partner-b.example'

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  await db.sql`update partner set state = 'awaiting' where id = ${t.partnerB}`
  for (const [name, inr, usd, trial] of [['Basic', 99900, 1900, 0], ['Grow', 249900, 4900, 30]] as const) {
    const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${t.partnerA}, ${name}, 'live') returning id`
    const id = plan?.id ?? ''
    await db.sql`update plan_version set trial_days = ${trial} where plan_id = ${id}`
    await db.sql`insert into plan_price (plan_id, partner_id, version, currency, monthly_amount) values (${id}, ${t.partnerA}, 1, 'INR', ${inr}), (${id}, ${t.partnerA}, 1, 'USD', ${usd})`
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const deps = (overrides: Partial<StoreAuthDeps> = {}): StoreAuthDeps => ({ sql: db.sql, activity: activityLog, partnerId: t.partnerA, host, secrets: null, now: () => now, allowAttempt: async () => true, ...overrides })

/** A person of the partner with one membership, signed in on its portal; `twoFactor` as an Owner must have it. */
const person = async (email: string, membership: { storeId: string; role: string; sellerId?: string }, twoFactor = false, partnerId = t.partnerA) => {
  const [user] = await db.sql<{ id: string }[]>`
    insert into "user" (partner_id, email, name, status, two_factor_method, two_factor_enrolled_at, phone)
    values (${partnerId}, ${email}, 'Farhan Ali', 'active', ${twoFactor ? 'sms' : null}, ${twoFactor ? now : null}, ${twoFactor ? '+919876543210' : null}) returning id`
  const id = user?.id ?? ''
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${id}, ${membership.storeId}, ${membership.sellerId ?? null}, ${membership.role}, 'active')`
  const session = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id, partnerId }, now))
  return { id, session }
}

const post = async (path: string, body: unknown, session: string | null, d = deps(), extraCookie = '') => {
  const cookie = [session ? `__Host-portal_session=${session}` : '', extraCookie].filter(Boolean).join('; ')
  const response = await handleStoreAuth(
    new Request(`https://${d.host}${path}`, { method: 'POST', headers: { origin: `https://${d.host}`, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }),
    d,
  )
  return { status: response.status, body: (await response.json()) as Record<string, unknown>, setCookie: response.headers.get('set-cookie') }
}

const create = (session: string | null, subdomain: string, d = deps(), extraCookie = '') => post('/api/auth/new-store', { storeName: 'Kesari Home', subdomain, country: 'IN' }, session, d, extraCookie)

const membershipsOf = (userId: string) => db.sql<{ store_id: string; role_key: string; seller_id: string | null }[]>`select store_id, role_key, seller_id from membership where user_id = ${userId} and status = 'active' order by created_at`

describe('creating another store', () => {
  it('offers the partner’s countries to a signed-in person, and nothing to anyone else', async () => {
    const { session } = await person('options@a.example', { storeId: t.storeA1, role: 'staff' })
    const options = await post('/api/auth/new-store/options', {}, session)
    expect(options.body['ok']).toBe(true)
    expect((options.body['countries'] as { code: string }[]).map((c) => c.code)).toEqual(expect.arrayContaining(['IN', 'US']))
    expect((await post('/api/auth/new-store/options', {}, null)).body).toEqual({ ok: false, code: 'INVALID_CREDENTIALS' })
  })

  it('makes an Owner with 2-factor the Owner of a new trial store, and logs it as theirs', async () => {
    const { id, session } = await person('owner@a.example', { storeId: t.storeA1, role: 'owner' }, true)
    const made = await create(session, 'kesari-owner')
    expect(made.body).toMatchObject({ ok: true, step: 'done' })
    const storeId = made.body['storeId'] as string
    const [store] = await db.sql<{ partner_id: string; status: string; trial_days: number }[]>`
      select partner_id, status, round(extract(epoch from trial_ends_at - ${now}::timestamptz) / 86400)::int as trial_days from store where id = ${storeId}`
    expect(store).toEqual({ partner_id: t.partnerA, status: 'trial', trial_days: 14 })
    const [sub] = await db.sql<{ currency: string; amount: number }[]>`select currency, amount from store_subscription where store_id = ${storeId}`
    expect(sub).toEqual({ currency: 'INR', amount: 99900 })
    expect(await membershipsOf(id)).toEqual([
      { store_id: t.storeA1, role_key: 'owner', seller_id: null },
      { store_id: storeId, role_key: 'owner', seller_id: null },
    ])
    const [entry] = await db.sql<{ actor_id: string; reason: string; visibility: string }[]>`select actor_id, reason, visibility from activity_log where action = 'store.created' and store_id = ${storeId}`
    expect(entry).toEqual({ actor_id: id, reason: 'another_store', visibility: 'store' })
    expect(await db.sql`select 1 from "user" where email = 'owner@a.example'`).toHaveLength(1)
  })

  it('lets a Manager, Staff member and supplier each open one, holding the new Owner at 2-factor set-up', async () => {
    const manager = await person('manager@a.example', { storeId: t.storeA1, role: 'manager' })
    const staff = await person('staff@a.example', { storeId: t.storeA2, role: 'staff' })
    const supplier = await person('supplier@a.example', { storeId: t.storeA1, role: 'supplier-admin', sellerId: t.sellerA1First })
    for (const [who, slug] of [[manager, 'kesari-manager'], [staff, 'kesari-staff'], [supplier, 'kesari-supplier']] as const) {
      const before = await membershipsOf(who.id)
      const made = await create(who.session, slug)
      expect(made.body).toMatchObject({ ok: true, step: 'enrol' })
      expect(made.setCookie).toContain('__Host-portal_session=')
      expect(await membershipsOf(who.id)).toEqual([...before, { store_id: made.body['storeId'], role_key: 'owner', seller_id: null }])
      const [session] = await db.sql<{ stage: string }[]>`select stage from user_session where user_id = ${who.id}`
      expect(session?.stage).toBe('enrol')
    }
  })

  it('answers a retry with the store it already made, never a second one', async () => {
    const { id, session } = await person('retry@a.example', { storeId: t.storeA1, role: 'owner' }, true)
    const first = await create(session, 'kesari-retry')
    const again = await create(session, 'kesari-retry')
    expect(again.body).toEqual({ ok: true, step: 'done', storeId: first.body['storeId'] })
    expect(await db.sql`select 1 from store where slug = 'kesari-retry'`).toHaveLength(1)
    expect(await membershipsOf(id)).toHaveLength(2)
  })

  /** `count` more open stores the person owns, made elsewhere (sign-up or the partner console). */
  const ownMore = async (userId: string, count: number, prefix: string) => {
    for (let n = 1; n <= count; n++) {
      const [store] = await db.sql<{ id: string }[]>`insert into store (partner_id, name, code) values (${t.partnerA}, ${`${prefix} ${n}`}, ${`${prefix}-${n}`}) returning id`
      await db.sql`insert into membership (user_id, store_id, role_key, status) values (${userId}, ${store?.id ?? ''}, 'owner', 'active')`
    }
  }

  it('lets a person own five stores, then asks them to contact support, on the form and on create', async () => {
    const { id, session } = await person('five@a.example', { storeId: t.storeA1, role: 'owner' }, true)
    await ownMore(id, 3, 'five-own')
    expect((await create(session, 'kesari-fifth')).body).toMatchObject({ ok: true, step: 'done' })
    const options = await post('/api/auth/new-store/options', {}, session)
    expect([options.status, options.body]).toEqual([403, { ok: false, code: 'STORE_LIMIT' }])
    expect((await create(session, 'kesari-sixth')).body).toEqual({ ok: false, code: 'STORE_LIMIT' })
    expect(await db.sql`select 1 from store where slug = 'kesari-sixth'`).toHaveLength(0)
  })

  it('makes one store between parallel requests from a person at their fourth', async () => {
    const { id, session } = await person('parallel@a.example', { storeId: t.storeA1, role: 'owner' }, true)
    await ownMore(id, 3, 'parallel-own')
    const answers = await Promise.all(['kesari-par-1', 'kesari-par-2', 'kesari-par-3'].map((slug) => create(session, slug)))
    expect(answers.filter((a) => a.body['ok'] === true)).toHaveLength(1)
    expect(answers.filter((a) => a.body['code'] === 'STORE_LIMIT')).toHaveLength(2)
    expect(await membershipsOf(id)).toHaveLength(5)
  })

  it('counts only the open stores the person owns, never ones they work in or another person’s', async () => {
    const owner = await person('full@a.example', { storeId: t.storeA2, role: 'owner' }, true)
    await ownMore(owner.id, 4, 'full-own')
    expect((await create(owner.session, 'kesari-over')).body).toEqual({ ok: false, code: 'STORE_LIMIT' })
    const colleague = await person('colleague@a.example', { storeId: t.storeA2, role: 'manager' })
    await db.sql`insert into membership (user_id, store_id, role_key, status) select ${colleague.id}, m.store_id, 'staff', 'active' from membership m join store s on s.id = m.store_id where m.user_id = ${owner.id} and s.code like 'full-own-%'`
    expect((await create(colleague.session, 'kesari-colleague')).body).toMatchObject({ ok: true, step: 'enrol' })
    await db.sql`update store set status = 'closed' where code = 'full-own-1'`
    expect((await create(owner.session, 'kesari-after-close')).body).toMatchObject({ ok: true, step: 'done' })
  })

  it('refuses a taken, reserved or malformed address and a country the partner doesn’t sell in', async () => {
    const { session } = await person('checks@a.example', { storeId: t.storeA1, role: 'owner' }, true)
    await db.sql`insert into store (partner_id, name, code, slug) values (${t.partnerB}, 'Theirs', 'theirs-b', 'held-elsewhere')`
    const taken = await create(session, 'held-elsewhere')
    expect(taken.body['code']).toBe('SUBDOMAIN_TAKEN')
    expect(JSON.stringify(taken.body)).not.toMatch(/partner|theirs/i)
    expect((await create(session, 'admin')).body['code']).toBe('SUBDOMAIN_TAKEN')
    expect((await create(session, 'shop-preview')).body['code']).toBe('SUBDOMAIN_TAKEN')
    expect((await create(session, 'Not ok!')).body).toEqual({ ok: false, code: 'INVALID_SUBDOMAIN' })
    expect((await post('/api/auth/new-store', { storeName: 'Kesari', subdomain: 'kesari-de', country: 'DE' }, session)).body).toEqual({ ok: false, code: 'COUNTRY_UNAVAILABLE' })
    expect((await post('/api/auth/new-store', { storeName: ' ', subdomain: 'kesari-blank', country: 'IN' }, session)).body).toEqual({ ok: false, code: 'NAME_REQUIRED' })
  })

  it('refuses without a session, in a support session, and under a partner that isn’t Live', async () => {
    expect((await create(null, 'kesari-nobody')).body).toEqual({ ok: false, code: 'INVALID_CREDENTIALS' })
    const { session } = await person('support@a.example', { storeId: t.storeA1, role: 'owner' }, true)
    const inSupport = await create(session, 'kesari-support', deps(), '__Host-portal_staff=anything')
    expect([inSupport.status, inSupport.body]).toEqual([403, { ok: false, code: 'FORBIDDEN' }])
    const b = await person('closed@b.example', { storeId: t.storeB1, role: 'owner' }, true, t.partnerB)
    expect((await create(b.session, 'kesari-closed', deps({ partnerId: t.partnerB, host: hostB }))).body).toEqual({ ok: false, code: 'SIGNUP_CLOSED' })
    expect(await db.sql`select 1 from store where slug in ('kesari-nobody', 'kesari-support', 'kesari-closed')`).toHaveLength(0)
  })

  it('never lets a session from one partner’s portal open a store under another', async () => {
    const b = await person('traveller@b.example', { storeId: t.storeB1, role: 'owner' }, true, t.partnerB)
    expect((await create(b.session, 'kesari-crossing')).body).toEqual({ ok: false, code: 'INVALID_CREDENTIALS' })
    expect(await db.sql`select 1 from store where slug = 'kesari-crossing'`).toHaveLength(0)
  })

  it('caps the person’s attempts and the partner’s hour', async () => {
    const { session } = await person('busy@a.example', { storeId: t.storeA1, role: 'owner' }, true)
    expect((await create(session, 'kesari-limited', deps({ allowAttempt: async () => false }))).body).toEqual({ ok: false, code: 'RATE_LIMITED' })
    await db.sql`insert into store (partner_id, name, code, created_at) select ${t.partnerA}, 'Flood', 'flood-' || n, ${now} from generate_series(1, 500) n`
    expect((await create(session, 'kesari-flood')).body).toEqual({ ok: false, code: 'RATE_LIMITED' })
    await db.sql`update store set created_at = ${new Date(now.getTime() - 2 * 60 * 60_000)} where code like 'flood-%'`
    expect((await create(session, 'kesari-flood')).body).toMatchObject({ ok: true, step: 'done' })
  })
})
