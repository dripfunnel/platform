import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleStoreAuth, type StoreAuthDeps } from '#apis/store/auth'
import { verifySignupPhone } from '#apis/store/signup'
import { hashPassword } from '#auth/password'
import { mintSignupEmailCode } from '#auth/signupCodes'
import { withSystemScope } from '#db/scoped/index'
import { deleteExpiredSignups } from '#db/scoped/signup'
import type { ProvisioningStep } from '#db/schema/saas'
import { activityLog } from '#saas/activity/index'
import { prepareEmail } from '#saas/email/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #290 (SAPI 2, part 4): a merchant signs up on the partner's portal host and the store is
// made (SAAS.md §4.1, §5 steps 1–3), or nothing is.

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-05T09:00:00Z')
const host = 'store.partner-a.example'
const hostB = 'store.partner-b.example'
const password = 'correct horse battery'

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'portal', ${host}, 'live', 'CNAME', 'x'), (${t.partnerB}, 'portal', ${hostB}, 'live', 'CNAME', 'x')`
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  await db.sql`update partner set state = 'awaiting' where id = ${t.partnerB}`
  // Partner A sells in India and the US: a cheap and a dearer plan, the cheap one with no trial of its own.
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

const cookies = (response: Response) => Object.fromEntries(response.headers.getSetCookie().map((c) => c.split(';')[0]?.split('=') ?? []).filter((kv) => kv.length === 2))

const post = async (path: string, body: unknown, signup = '', d = deps()) => {
  const response = await handleStoreAuth(
    new Request(`https://${d.host}${path}`, { method: 'POST', headers: { origin: `https://${d.host}`, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...(signup ? { cookie: `__Host-portal_signup=${signup}` } : {}) }, body: JSON.stringify(body) }),
    d,
  )
  return { status: response.status, body: (await response.json()) as Record<string, unknown>, cookies: cookies(response) }
}

/** The email's code, made as the deliverer makes it when sending. */
const emailCode = async (email: string) => {
  const [row] = await db.sql<{ id: string }[]>`select id from signup where email = ${email} order by created_at desc limit 1`
  return (await withSystemScope(db.sql, (tx) => mintSignupEmailCode(tx, row?.id ?? '', now))) ?? ''
}

const textedCode = async (phone: string) => {
  const [row] = await db.sql<{ payload: { vars: { code: string } } }[]>`select payload from outbox where kind = 'sms' and payload->>'to' = ${phone} order by created_at desc limit 1`
  return row?.payload.vars.code ?? ''
}

/** Steps 1–3 of the form, leaving the sign-up waiting for its texted code. */
const throughStore = async (email: string, subdomain: string, country = 'IN') => {
  const start = await post('/api/auth/sign-up', { name: 'Farhan Ali', email, password })
  const signup = start.cookies['__Host-portal_signup'] ?? ''
  await post('/api/auth/sign-up/verify-email', { code: await emailCode(email) }, signup)
  await post('/api/auth/sign-up/store', { storeName: 'Juniper & Co.', subdomain, country }, signup)
  return signup
}

describe('signing up', () => {
  it('answers the same for an address with an account, and emails that one how to sign in instead', async () => {
    await db.sql`insert into "user" (partner_id, email, name, status, password_hash) values (${t.partnerA}, 'taken@a.example', 'Taken', 'active', ${await hashPassword(password)})`
    const known = await post('/api/auth/sign-up', { name: 'Someone', email: 'taken@a.example', password })
    const fresh = await post('/api/auth/sign-up', { name: 'Someone', email: 'fresh@a.example', password })
    expect(known.body).toEqual({ ok: true, step: 'verify-email' })
    expect(fresh.body).toEqual(known.body)
    const prepared = await withSystemScope(db.sql, async (tx) => {
      const rows = await tx<{ payload: unknown }[]>`select payload from outbox where kind = 'email' and payload->>'template' = 'signup-code' order by created_at`
      return Promise.all(rows.map((r) => prepareEmail(tx, { payload: r.payload, partnerId: t.partnerA }, { adminHost: 'a', platformHost: 'p' }, now)))
    })
    const [toKnown, toFresh] = prepared
    expect(toKnown?.send && toKnown.content.subject).toContain('already have')
    expect(toKnown?.send && JSON.stringify(toKnown.content)).not.toMatch(/\d{6}/)
    expect(toFresh?.send && toFresh.content.paragraphs[0]).toMatch(/Your code is \d{6}/)
    // Once both emails are out, the next step answers the two alike.
    const knownTry = await post('/api/auth/sign-up/verify-email', { code: '000000' }, known.cookies['__Host-portal_signup'])
    const freshTry = await post('/api/auth/sign-up/verify-email', { code: '000000' }, fresh.cookies['__Host-portal_signup'])
    expect(knownTry.body).toEqual({ ok: false, code: 'WRONG_CODE', triesLeft: 4 })
    expect(freshTry.body).toEqual(knownTry.body)
  })

  it('caps how many sign-ups a partner takes in an hour', async () => {
    await db.sql`insert into signup (partner_id, token_hash, stage, name, email, password_hash, expires_at, created_at) select ${t.partnerA}, 'flood-' || n, 'email', 'F', 'f' || n || '@a.example', 'h', ${new Date(now.getTime() + 86_400_000)}, ${now} from generate_series(1, 500) n`
    expect((await post('/api/auth/sign-up', { name: 'One more', email: 'one.more@a.example', password })).body).toEqual({ ok: false, code: 'RATE_LIMITED' })
    await db.sql`delete from signup where token_hash like 'flood-%'`
  })

  it('refuses a short password, a bad address, and any sign-up while the partner isn’t Live', async () => {
    expect((await post('/api/auth/sign-up', { name: 'X', email: 'x@a.example', password: 'short' })).body).toEqual({ ok: false, code: 'WEAK_PASSWORD' })
    expect((await post('/api/auth/sign-up', { name: 'X', email: 'nope', password })).body).toEqual({ ok: false, code: 'INVALID_EMAIL' })
    expect((await post('/api/auth/sign-up', { name: 'X', email: 'x@b.example', password }, '', deps({ partnerId: t.partnerB, host: hostB }))).body).toEqual({ ok: false, code: 'SIGNUP_CLOSED' })
  })

  it('counts wrong email codes, offers the partner’s countries, and keeps a web address unique', async () => {
    const start = await post('/api/auth/sign-up', { name: 'Farhan', email: 'farhan@a.example', password })
    const signup = start.cookies['__Host-portal_signup'] ?? ''
    const code = await emailCode('farhan@a.example')
    expect((await post('/api/auth/sign-up/verify-email', { code: '000000' }, signup)).body).toEqual({ ok: false, code: 'WRONG_CODE', triesLeft: 4 })
    const verified = await post('/api/auth/sign-up/verify-email', { code }, signup)
    expect(verified.body['step']).toBe('store')
    expect((verified.body['countries'] as { code: string }[]).map((c) => c.code)).toEqual(expect.arrayContaining(['IN', 'US']))
    await db.sql`insert into store (partner_id, name, code) values (${t.partnerA}, 'Existing', 'juniper')`
    expect((await post('/api/auth/sign-up/store', { storeName: 'Juniper', subdomain: 'juniper', country: 'IN' }, signup)).body).toEqual({ ok: false, code: 'SUBDOMAIN_TAKEN', suggestions: ['juniper-co', 'juniper-shop'] })
    expect((await post('/api/auth/sign-up/store', { storeName: 'Juniper', subdomain: 'admin', country: 'IN' }, signup)).body['code']).toBe('SUBDOMAIN_TAKEN')
    expect((await post('/api/auth/sign-up/store', { storeName: 'Juniper', subdomain: 'Not ok!', country: 'IN' }, signup)).body).toEqual({ ok: false, code: 'INVALID_SUBDOMAIN' })
    expect((await post('/api/auth/sign-up/store', { storeName: 'Juniper', subdomain: 'juniper-co', country: 'DE' }, signup)).body).toEqual({ ok: false, code: 'COUNTRY_UNAVAILABLE' })
    expect((await post('/api/auth/sign-up/store', { storeName: 'Juniper', subdomain: 'juniper-co', country: 'IN' }, signup)).body).toEqual({ ok: true, step: 'phone' })
  })

  it('makes the account, the store, its Trial and the Owner, then holds the Owner at 2-factor set-up', async () => {
    const signup = await throughStore('owner.new@a.example', 'kesari')
    expect((await post('/api/auth/sign-up/send-phone', { phone: '98450 22113' }, signup)).body).toEqual({ ok: false, code: 'INVALID_PHONE' })
    expect((await post('/api/auth/sign-up/send-phone', { phone: '+919845022113' }, signup)).body).toEqual({ ok: true, hint: '•••• 2113' })
    expect((await post('/api/auth/sign-up/verify-phone', { code: '000000' }, signup)).body).toEqual({ ok: false, code: 'WRONG_CODE', triesLeft: 4 })
    const done = await post('/api/auth/sign-up/verify-phone', { code: await textedCode('+919845022113') }, signup)
    expect(done.body['step']).toBe('enrol')
    expect(done.cookies['__Host-portal_signup']).toBe('')
    expect(done.cookies['__Host-portal_session']).not.toBe('')
    const [store] = await db.sql<{ id: string; code: string; country: string; status: string; trial_days: number }[]>`
      select id, code, country, status, round(extract(epoch from trial_ends_at - ${now}::timestamptz) / 86400)::int as trial_days from store where code = 'kesari'`
    expect(store).toMatchObject({ code: 'kesari', country: 'IN', status: 'trial', trial_days: 14 })
    const [sub] = await db.sql<{ currency: string; amount: number; status: string }[]>`select currency, amount, status from store_subscription where store_id = ${store?.id ?? ''}`
    expect(sub).toEqual({ currency: 'INR', amount: 99900, status: 'trial' })
    const [owner] = await db.sql<{ role_key: string; status: string; email_verified: boolean; phone: string }[]>`
      select m.role_key, m.status, u.email_verified_at is not null as email_verified, u.phone from membership m join "user" u on u.id = m.user_id where m.store_id = ${store?.id ?? ''}`
    expect(owner).toEqual({ role_key: 'owner', status: 'active', email_verified: true, phone: '+919845022113' })
    const [job] = await db.sql<{ state: string; steps: string[] }[]>`select state, array_to_json(steps) as steps from job where store_id = ${store?.id ?? ''}`
    expect(job).toEqual({ state: 'done', steps: ['accountAndStore', 'defaults', 'hostnames'] })
    expect(await db.sql`select 1 from signup where email = 'owner.new@a.example'`).toHaveLength(0)
    const [entry] = await db.sql<{ visibility: string }[]>`select visibility from activity_log where action = 'store.created' and store_id = ${store?.id ?? ''}`
    expect(entry?.visibility).toBe('store')
  })

  it('leaves nothing behind when any step fails, and the same code then works', async () => {
    for (const step of ['accountAndStore', 'defaults', 'hostnames'] as const satisfies readonly ProvisioningStep[]) {
      const email = `fails.${step}@a.example`
      const signup = await throughStore(email, `fails-${step.toLowerCase()}`)
      await post('/api/auth/sign-up/send-phone', { phone: '+16145550100' }, signup)
      const code = await textedCode('+16145550100')
      const request = new Request(`https://${host}/api/auth/sign-up/verify-phone`, { method: 'POST', headers: { origin: `https://${host}`, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' }, body: JSON.stringify({ code }) })
      await expect(verifySignupPhone(request, deps(), { requestId: 'r', ip: null, userAgent: null }, signup, (at) => {
        if (at === step) throw new Error(`injected at ${step}`)
      })).rejects.toThrow(`injected at ${step}`)
      expect(await db.sql`select 1 from store where code = ${`fails-${step.toLowerCase()}`}`).toHaveLength(0)
      expect(await db.sql`select 1 from "user" where email = ${email}`).toHaveLength(0)
      expect((await post('/api/auth/sign-up/verify-phone', { code }, signup)).body['step']).toBe('enrol')
    }
  })

  it('never carries a sign-up to another partner’s host', async () => {
    const signup = await throughStore('wanderer@a.example', 'wanderer')
    await db.sql`update partner set state = 'live' where id = ${t.partnerB}`
    try {
      expect((await post('/api/auth/sign-up/send-phone', { phone: '+16145550101' }, signup, deps({ partnerId: t.partnerB, host: hostB }))).body).toEqual({ ok: false, code: 'SIGNUP_EXPIRED' })
    } finally {
      await db.sql`update partner set state = 'awaiting' where id = ${t.partnerB}`
    }
  })

  it('clears a sign-up nobody finished once its day is over', async () => {
    await post('/api/auth/sign-up', { name: 'Gone', email: 'abandoned@a.example', password })
    expect(await withSystemScope(db.sql, (tx) => deleteExpiredSignups(tx, now, 500))).toBe(0)
    expect(await withSystemScope(db.sql, (tx) => deleteExpiredSignups(tx, new Date(now.getTime() + 25 * 3_600_000), 500))).toBeGreaterThanOrEqual(1)
    expect(await db.sql`select 1 from signup where email = 'abandoned@a.example'`).toHaveLength(0)
  })

  it('texts one number at most three times a day, across every sign-up, and caps the partner’s hour', async () => {
    const answers = []
    for (let i = 0; i < 4; i += 1) {
      const signup = await throughStore(`pump${i}@a.example`, `pump-${i}`, 'US')
      answers.push((await post('/api/auth/sign-up/send-phone', { phone: '+16145550199' }, signup)).body['code'])
    }
    expect(answers).toEqual([undefined, undefined, undefined, 'RATE_LIMITED'])
    await db.sql`insert into signup_text (partner_id, phone, sent_at) select ${t.partnerA}, '+1614555' || lpad(n::text, 4, '0'), ${now} from generate_series(1, 200) n`
    const signup = await throughStore('late@a.example', 'late-comer', 'US')
    expect((await post('/api/auth/sign-up/send-phone', { phone: '+16145559876' }, signup)).body).toEqual({ ok: false, code: 'RATE_LIMITED' })
    await db.sql`delete from signup_text where phone like '+1614555%' and signup_id is null`
  })

  it('texts at most three codes in ten minutes', async () => {
    const signup = await throughStore('chatty@a.example', 'chatty', 'US')
    const answers = []
    for (let i = 0; i < 4; i += 1) answers.push((await post('/api/auth/sign-up/send-phone', { phone: '+16145550102' }, signup)).body['code'])
    expect(answers).toEqual([undefined, undefined, undefined, 'RATE_LIMITED'])
  })
})
