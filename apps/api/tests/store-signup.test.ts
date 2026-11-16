import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { handleStoreAuth, type StoreAuthDeps } from '#apis/store/auth'
import { verifySignupPhone } from '#apis/store/signup'
import { hashPassword } from '#auth/password'
import { mintSignupEmailCode } from '#auth/signupCodes'
import { withSystemScope } from '#db/scoped/index'
import { deleteExpiredSignups } from '#db/scoped/signup'
import type { ProvisioningStep } from '#db/schema/saas'
import { activityLog } from '#saas/activity/index'
import { prepareEmail } from '#saas/email/index'
import { testCodeChannels } from './support/codeChannels'
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
  // The number's step is there while the partner's WhatsApp is on (#1506); a test below turns it off.
  await db.sql`update partner set state = 'live', whatsapp_enabled = true where id = ${t.partnerA}`
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

const deps = (overrides: Partial<StoreAuthDeps> = {}): StoreAuthDeps => ({ sql: db.sql, activity: activityLog, partnerId: t.partnerA, host, secrets: null, now: () => now, allowAttempt: async () => true, codeChannels: testCodeChannels, ...overrides })

const cookies = (response: Response) => Object.fromEntries(response.headers.getSetCookie().map((c) => c.split(';')[0]?.split('=') ?? []).filter((kv) => kv.length === 2))

const off = () => deps({ codeCheck: '0' })
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

/** The newest code queued for a number, by WhatsApp or SMS. */
const sentCode = async (phone: string) => {
  const [row] = await db.sql<{ kind: string; partner_id: string; payload: { message: string; code?: string; vars?: { code: string } } }[]>`
    select kind, partner_id, payload from outbox where kind in ('sms', 'whatsapp') and payload->>'to' = ${phone} order by created_at desc limit 1`
  return { kind: row?.kind, partnerId: row?.partner_id, message: row?.payload.message, code: row?.payload.code ?? row?.payload.vars?.code ?? '' }
}

const textedCode = async (phone: string) => (await sentCode(phone)).code

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
      return Promise.all(rows.map((r) => prepareEmail(tx, { payload: r.payload, partnerId: t.partnerA }, { adminHost: 'a', platformHost: 'p', shopDomain: 'shop.example' }, now)))
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
    expect((await post('/api/auth/sign-up/store', { storeName: 'Juniper', subdomain: 'juniper-co', country: 'IN' }, signup)).body).toEqual({ ok: true, step: 'phone', codeChannels: { whatsapp: true, sms: true } })
  })

  it('refuses a web address another partner’s store or sign-up holds, with the same answer whichever it is, and every reserved or -preview name', async () => {
    const taken = async (subdomain: string) => {
      const start = await post('/api/auth/sign-up', { name: 'Slug', email: `slug.${subdomain}@a.example`, password })
      const signup = start.cookies['__Host-portal_signup'] ?? ''
      await post('/api/auth/sign-up/verify-email', { code: await emailCode(`slug.${subdomain}@a.example`) }, signup)
      return (await post('/api/auth/sign-up/store', { storeName: 'Slug', subdomain, country: 'IN' }, signup)).body
    }
    // Held by partner B's store, and by a sign-up of partner B's in progress: nothing says which partner, or whether a store or a sign-up.
    await db.sql`insert into store (partner_id, name, code, slug) values (${t.partnerB}, 'Theirs', 'theirs', 'borrowed')`
    await db.sql`insert into signup (partner_id, token_hash, name, email, password_hash, stage, subdomain, expires_at) values (${t.partnerB}, 'slug-held', 'N', 'n@b.example', 'x', 'phone', 'inflight', now() + interval '1 day')`
    const byStore = await taken('borrowed')
    const bySignup = await taken('inflight')
    expect([byStore['code'], bySignup['code']]).toEqual(['SUBDOMAIN_TAKEN', 'SUBDOMAIN_TAKEN'])
    expect(Object.keys(byStore).sort()).toEqual(Object.keys(bySignup).sort())
    expect(JSON.stringify([byStore, bySignup])).not.toMatch(/partner|theirs/i)
    for (const name of ['acme-preview', 'shop', 'www', 'x-preview']) expect((await taken(name))['code'], name).toBe('SUBDOMAIN_TAKEN')
    expect((await taken('fresh-slug'))['ok']).toBe(true)
  })

  it('still checks the sign-up email code when CODE_CHECK is 0, which skips text codes only (#1002)', async () => {
    const start = await post('/api/auth/sign-up', { name: 'Zed', email: 'zed@a.example', password })
    const code = await emailCode('zed@a.example')
    const cookie = start.cookies['__Host-portal_signup'] ?? ''
    const wrong = await post('/api/auth/sign-up/verify-email', { code: code === '000000' ? '111111' : '000000' }, cookie, off())
    expect(wrong.body).toMatchObject({ ok: false, code: 'WRONG_CODE', triesLeft: 4 })
    const verified = await post('/api/auth/sign-up/verify-email', { code }, cookie, off())
    expect(verified.body['step']).toBe('store')
  })
  it('makes the account, the store, its Trial and the Owner, then opens a full session with no 2-factor set-up (#1008)', async () => {
    const signup = await throughStore('owner.new@a.example', 'kesari')
    expect((await post('/api/auth/sign-up/send-phone', { phone: '98450 22113' }, signup)).body).toEqual({ ok: false, code: 'INVALID_PHONE' })
    expect((await post('/api/auth/sign-up/send-phone', { phone: '+919845022113' }, signup)).body).toEqual({ ok: true, hint: '•••• 2113', channel: 'whatsapp', codeChannels: { whatsapp: true, sms: true } })
    expect((await post('/api/auth/sign-up/verify-phone', { code: '000000' }, signup)).body).toEqual({ ok: false, code: 'WRONG_CODE', triesLeft: 4 })
    const done = await post('/api/auth/sign-up/verify-phone', { code: await textedCode('+919845022113') }, signup)
    expect(done.body['step']).toBe('done')
    expect(done.cookies['__Host-portal_signup']).toBe('')
    expect(done.cookies['__Host-portal_session']).not.toBe('')
    expect((await db.sql<{ stage: string }[]>`select stage from user_session s join "user" u on u.id = s.user_id where u.email = 'owner.new@a.example'`)[0]?.stage).toBe('full')
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
    // The slug is the address (#744, #745): no hostname is registered, so nothing is queued for one.
    expect(await db.sql`select 1 from outbox where kind like 'store_host%' and store_id = ${store?.id ?? ''}`).toEqual([])
    expect((await db.sql<{ slug: string }[]>`select slug from store where id = ${store?.id ?? ''}`)[0]?.slug).toBe('kesari')
    expect(await db.sql`select 1 from signup where email = 'owner.new@a.example'`).toHaveLength(0)
    const [entry] = await db.sql<{ visibility: string }[]>`select visibility from activity_log where action = 'store.created' and store_id = ${store?.id ?? ''}`
    expect(entry?.visibility).toBe('store')
  })

  it('still refuses an expired sign-up code and one out of tries when CODE_CHECK is 0', async () => {
    const emailSpoils = [
      (email: string) => db.sql`update signup set email_code_expires_at = '2000-01-01' where email = ${email}`,
      (email: string) => db.sql`update signup set email_code_attempts = 5 where email = ${email}`,
    ]
    for (const [n, spoil] of emailSpoils.entries()) {
      const email = `spoil-email-${n}@a.example`
      const start = await post('/api/auth/sign-up', { name: 'Zed', email, password })
      await emailCode(email)
      await spoil(email)
      expect((await post('/api/auth/sign-up/verify-email', { code: '000000' }, start.cookies['__Host-portal_signup'] ?? '', off())).body).toEqual({ ok: false, code: 'CODE_EXPIRED' })
    }
    const phoneSpoils = [
      (email: string) => db.sql`update signup set phone_code_expires_at = '2000-01-01' where email = ${email}`,
      (email: string) => db.sql`update signup set phone_code_attempts = 5 where email = ${email}`,
    ]
    for (const [n, spoil] of phoneSpoils.entries()) {
      const email = `spoil-phone-${n}@a.example`
      const signup = await throughStore(email, `spoil-phone-${n}`)
      await post('/api/auth/sign-up/send-phone', { phone: '+16145550102' }, signup)
      await spoil(email)
      expect((await post('/api/auth/sign-up/verify-phone', { code: '000000' }, signup, off())).body).toEqual({ ok: false, code: 'CODE_EXPIRED' })
    }
  })

  it('accepts any sign-up phone code when CODE_CHECK is 0', async () => {
    const signup = await throughStore('zed.phone@a.example', 'zed-phone')
    await post('/api/auth/sign-up/send-phone', { phone: '+16145550101' }, signup)
    expect((await post('/api/auth/sign-up/verify-phone', { code: '000000' }, signup, off())).body['step']).toBe('done')
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
      expect(await db.sql`select 1 from outbox o where kind like 'store_host%'`).toHaveLength(0)
      expect((await post('/api/auth/sign-up/verify-phone', { code }, signup)).body['step']).toBe('done')
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

describe('the number step by WhatsApp first, only while the partner’s WhatsApp is on (#1506)', () => {
  const both = { whatsapp: true, sms: true }
  const at = (seconds: number) => deps({ now: () => new Date(now.getTime() + seconds * 1000) })
  afterEach(async () => {
    await db.sql`update partner set whatsapp_enabled = (id = ${t.partnerA}), sms_enabled = true where id in (${t.partnerA}, ${t.partnerB})`
  })

  it('with WhatsApp off, makes the store at the store step with no number, and refuses the number’s routes', async () => {
    const waiting = await throughStore('waiting@a.example', 'waiting-number')
    await db.sql`update partner set whatsapp_enabled = false where id = ${t.partnerA}`
    expect((await post('/api/auth/sign-up/send-phone', { phone: '+16145550401' }, waiting)).body).toEqual({ ok: false, code: 'STEP_SKIPPED' })
    expect((await post('/api/auth/sign-up/verify-phone', { code: '000000' }, waiting)).body).toEqual({ ok: false, code: 'STEP_SKIPPED' })
    // A sign-up held at the number when WhatsApp went off carries on from the store step.
    expect((await post('/api/auth/sign-up/store', { storeName: 'Waiting', subdomain: 'waiting-number', country: 'IN' }, waiting)).body['step']).toBe('done')

    const start = await post('/api/auth/sign-up', { name: 'No Number', email: 'no.number@a.example', password })
    const signup = start.cookies['__Host-portal_signup'] ?? ''
    await post('/api/auth/sign-up/verify-email', { code: await emailCode('no.number@a.example') }, signup)
    const made = await post('/api/auth/sign-up/store', { storeName: 'No Number', subdomain: 'no-number', country: 'IN' }, signup)
    expect(made.body).toMatchObject({ ok: true, step: 'done' })
    expect(made.cookies['__Host-portal_signup']).toBe('')
    expect(made.cookies['__Host-portal_session']).not.toBe('')
    const [owner] = await db.sql<{ phone: string | null; status: string }[]>`select u.phone, s.status from "user" u join membership m on m.user_id = u.id join store s on s.id = m.store_id where u.email = 'no.number@a.example'`
    expect(owner).toEqual({ phone: null, status: 'trial' })
    expect(await db.sql`select 1 from signup where email = 'no.number@a.example'`).toHaveLength(0)
  })

  it('sends the code by WhatsApp first, by SMS only 20 seconds later and while SMS is on, and accepts only the newest', async () => {
    const signup = await throughStore('wa.signup@a.example', 'wa-signup')
    const phone = '+919845000201'
    expect((await post('/api/auth/sign-up/send-phone', { phone }, signup)).body).toEqual({ ok: true, hint: '•••• 0201', channel: 'whatsapp', codeChannels: both })
    const byWhatsApp = await sentCode(phone)
    expect(byWhatsApp).toMatchObject({ kind: 'whatsapp', message: 'code.portal', partnerId: t.partnerA })
    expect((await post('/api/auth/sign-up/send-phone', { phone, channel: 'sms' }, signup, at(19))).body).toEqual({ ok: false, code: 'TOO_SOON', seconds: 1 })
    await db.sql`update partner set sms_enabled = false where id = ${t.partnerA}`
    expect((await post('/api/auth/sign-up/send-phone', { phone, channel: 'sms' }, signup, at(20))).body).toEqual({ ok: false, code: 'CHANNEL_OFF' })
    await db.sql`update partner set sms_enabled = true where id = ${t.partnerA}`
    expect((await post('/api/auth/sign-up/send-phone', { phone, channel: 'sms' }, signup, at(20))).body).toMatchObject({ ok: true, channel: 'sms' })
    const byText = await sentCode(phone)
    expect(byText).toMatchObject({ kind: 'sms', message: 'code.verify_phone' })
    if (byWhatsApp.code !== byText.code) expect((await post('/api/auth/sign-up/verify-phone', { code: byWhatsApp.code }, signup)).body).toMatchObject({ ok: false, code: 'WRONG_CODE' })
    expect((await post('/api/auth/sign-up/verify-phone', { code: byText.code }, signup)).body['step']).toBe('done')
  })

  it('signs up with a code sent by WhatsApp', async () => {
    const signup = await throughStore('wa.verified@a.example', 'wa-verified')
    await post('/api/auth/sign-up/send-phone', { phone: '+919845000202' }, signup)
    expect((await post('/api/auth/sign-up/verify-phone', { code: (await sentCode('+919845000202')).code }, signup)).body['step']).toBe('done')
    expect((await db.sql<{ phone: string }[]>`select phone from "user" where email = 'wa.verified@a.example'`)[0]?.phone).toBe('+919845000202')
  })

  it('counts WhatsApp and SMS sends together under the sign-up’s limits', async () => {
    const signup = await throughStore('mixed@a.example', 'mixed-limits', 'US')
    const phone = '+16145550402'
    const sent = async (body: Record<string, string>, d = deps()) => {
      const answer = (await post('/api/auth/sign-up/send-phone', { phone, ...body }, signup, d)).body
      return answer['channel'] ?? answer['code']
    }
    const answers = [await sent({}, at(0)), await sent({ channel: 'whatsapp' }, at(1)), await sent({ channel: 'sms' }, at(21)), await sent({ channel: 'sms' }, at(22))]
    expect(answers).toEqual(['whatsapp', 'whatsapp', 'sms', 'RATE_LIMITED'])
  })

  it('asks for the number by the host partner’s WhatsApp only, never another partner’s', async () => {
    await db.sql`update partner set state = 'live', whatsapp_enabled = true where id = ${t.partnerB}`
    await db.sql`update partner set whatsapp_enabled = false where id = ${t.partnerA}`
    try {
      const start = await post('/api/auth/sign-up', { name: 'On A', email: 'on.a@a.example', password })
      const signup = start.cookies['__Host-portal_signup'] ?? ''
      await post('/api/auth/sign-up/verify-email', { code: await emailCode('on.a@a.example') }, signup)
      expect((await post('/api/auth/sign-up/store', { storeName: 'On A', subdomain: 'on-a-only', country: 'IN' }, signup)).body['step']).toBe('done')
      // And the other way: A's WhatsApp on, B's off, a sign-up on B's host skips the number.
      await db.sql`update partner set whatsapp_enabled = true where id = ${t.partnerA}`
      await db.sql`update partner set whatsapp_enabled = false where id = ${t.partnerB}`
      await db.sql`insert into plan (partner_id, name, status) values (${t.partnerB}, 'B Basic', 'live')`
      const [plan] = await db.sql<{ id: string }[]>`select id from plan where partner_id = ${t.partnerB} and name = 'B Basic'`
      await db.sql`insert into plan_price (plan_id, partner_id, version, currency, monthly_amount) values (${plan?.id ?? ''}, ${t.partnerB}, 1, 'INR', 99900)`
      const onB = deps({ partnerId: t.partnerB, host: hostB })
      const startB = await post('/api/auth/sign-up', { name: 'On B', email: 'on.b@b.example', password }, '', onB)
      const signupB = startB.cookies['__Host-portal_signup'] ?? ''
      const [row] = await db.sql<{ id: string }[]>`select id from signup where email = 'on.b@b.example'`
      const codeB = (await withSystemScope(db.sql, (tx) => mintSignupEmailCode(tx, row?.id ?? '', now))) ?? ''
      await post('/api/auth/sign-up/verify-email', { code: codeB }, signupB, onB)
      expect((await post('/api/auth/sign-up/store', { storeName: 'On B', subdomain: 'on-b-only', country: 'IN' }, signupB, onB)).body['step']).toBe('done')
    } finally {
      await db.sql`update partner set state = 'awaiting' where id = ${t.partnerB}`
    }
  })
})
