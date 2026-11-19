import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveShopper } from '#auth/shopCaller'
import { hashSessionId, newSessionId } from '#auth/session'
import { withSystemScope } from '#db/scoped/index'
import { insertShopperSession } from '#db/scoped/shopper'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #1404: a signed-in shopper adds or changes their mobile number, proved by a text code at the new number (ACCESS §2.1).

let db: TestDatabase
let t: Tenants
const stores = { india: '', other: '', emailOnly: '' }
const hostOf = { india: 'jaipur.shop.example', other: 'pune.shop.example', emailOnly: 'surat.shop.example' }
const people = { noPhone: '', holder: '', other: '', otherStore: '', emailOnly: '' }
const sessions = { noPhone: '', holder: '', other: '', otherStore: '', emailOnly: '' }
const holderPhone = '+919811100001'
const now = () => new Date()
// Every key the sign-in limiter was asked about: none may hold a number.
const limiterKeys: string[] = []
let allow = true

const store = async (name: string, code: string) =>
  (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status) values (${t.partnerA}, ${name}, ${code}, 'IN', 'INR', 'active') returning id`)[0]?.id ?? ''

const shopper = async (storeId: string, name: string, contact: { email?: string; phone?: string }) => {
  const [row] = await db.sql<{ id: string }[]>`
    insert into customer (store_id, name, email, email_verified_at, phone, phone_verified_at, status)
    values (${storeId}, ${name}, ${contact.email ?? null}, ${contact.email ? now() : null}, ${contact.phone ?? null}, ${contact.phone ? now() : null}, 'active') returning id`
  const id = row?.id ?? ''
  const token = newSessionId()
  await withSystemScope(db.sql, async (tx) => insertShopperSession(tx, { idHash: await hashSessionId(token), storeId, customerId: id, expiresAt: new Date(Date.now() + 86_400_000), now: now() }))
  return { id, token }
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  stores.india = await store('Jaipur', 'jaipur')
  stores.other = await store('Pune', 'pune')
  stores.emailOnly = await store('Surat', 'surat')
  await db.sql`insert into store_customer_auth (store_id, email_enabled, phone_enabled) values (${stores.india}, true, true), (${stores.other}, true, true), (${stores.emailOnly}, true, false) on conflict (store_id) do update set email_enabled = excluded.email_enabled, phone_enabled = excluded.phone_enabled`
  for (const [key, made] of Object.entries({
    noPhone: await shopper(stores.india, 'Asha', { email: 'asha@example.com' }),
    holder: await shopper(stores.india, 'Ravi', { email: 'ravi@example.com', phone: holderPhone }),
    other: await shopper(stores.india, 'Meera', { email: 'meera@example.com' }),
    otherStore: await shopper(stores.other, 'Dev', { email: 'dev@example.com', phone: '+919822200002' }),
    emailOnly: await shopper(stores.emailOnly, 'Zoya', { email: 'zoya@example.com' }),
  })) {
    people[key as keyof typeof people] = made.id
    sessions[key as keyof typeof sessions] = made.token
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const gql = async (source: string, who: { host?: string; session?: string } = {}) => {
  const host = who.host ?? hostOf.india
  const headers: Record<string, string> = who.session ? { 'x-shop-session': who.session } : {}
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers }), host, 'shop.example')
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.7', userAgent: null }, allowAttempt: async (key) => (limiterKeys.push(key), allow), sessionToken: who.session ?? null, allowNewCart: async () => true, now }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

const request = (to: string, session: string, host?: string) => gql(`mutation { requestPhoneCode(to: "${to}") }`, { session, ...(host ? { host } : {}) })
const confirm = (to: string, code: string, session: string, host?: string) => gql(`mutation { confirmPhone(to: "${to}", code: "${code}") }`, { session, ...(host ? { host } : {}) })
const account = async (session: string) => (await gql('{ account { phone phoneVerified } }', { session })).data?.['account'] as { phone: string | null; phoneVerified: boolean } | null
const texts = async (to: string) => (await db.sql<{ n: number }[]>`select count(*)::int as n from outbox where kind = 'sms' and payload->>'to' = ${to}`)[0]?.n ?? 0
const textedCode = async (to: string) => {
  const [row] = await db.sql<{ payload: { vars: { code: string } } }[]>`select payload from outbox where kind = 'sms' and payload->>'to' = ${to} order by created_at desc limit 1`
  return row?.payload.vars.code ?? ''
}
const wrong = (code: string) => (code === '000000' ? '111111' : '000000')

describe('adding a number', () => {
  it('texts the code to the new number only, keeps the account without a number until it is proved, then saves it as verified E.164', async () => {
    const number = '+919833300003'
    expect((await request('+91 98333 00003', sessions.noPhone)).data?.['requestPhoneCode']).toBe(true)
    expect(await texts(number)).toBe(1)
    expect(await account(sessions.noPhone)).toEqual({ phone: null, phoneVerified: false })
    expect((await confirm(number, await textedCode(number), sessions.noPhone)).data?.['confirmPhone']).toBe(true)
    expect(await account(sessions.noPhone)).toEqual({ phone: number, phoneVerified: true })
  })

  it('links the store’s placed guest orders with that number, and logs how many, never the number', async () => {
    const number = '+919844400004'
    const order = async (storeId: string, no: string) =>
      (await db.sql<{ id: string }[]>`insert into "order" (store_id, state, currency, number, placed_at, subtotal_amount, shipping_amount, tax_amount, total_amount, tax_inclusive, email, phone)
        values (${storeId}, 'placed', 'INR', ${no}, now(), 99900, 0, 0, 99900, true, 'guest@example.com', ${number}) returning id`)[0]?.id ?? ''
    const mine = await order(stores.india, 'JP-1404')
    const elsewhere = await order(stores.emailOnly, 'SU-1404')
    await request(number, sessions.other)
    await confirm(number, await textedCode(number), sessions.other)
    expect(await db.sql`select id, customer_id from "order" where id in (${mine}, ${elsewhere}) order by number`).toEqual([
      { id: mine, customer_id: people.other },
      { id: elsewhere, customer_id: null },
    ])
    const [logged] = await db.sql<{ changes: unknown; customer_id: string }[]>`select changes, customer_id from activity_log where action = 'customer.orders_linked' and customer_id = ${people.other}`
    expect(logged?.changes).toMatchObject([{ field: 'orders', before: null, after: '1' }])
  })
})

describe('changing a number', () => {
  it('keeps the old number until the new one is proved', async () => {
    const next = '+919855500005'
    await request(next, sessions.holder)
    expect(await account(sessions.holder)).toEqual({ phone: holderPhone, phoneVerified: true })
    await confirm(next, await textedCode(next), sessions.holder)
    expect(await account(sessions.holder)).toEqual({ phone: next, phoneVerified: true })
    expect(await db.sql`select phone from customer where phone = ${holderPhone}`).toEqual([])
    await db.sql`update customer set phone = ${holderPhone} where id = ${people.holder}`
  })

  it('refuses a wrong code and changes nothing, and a right code once five tries are spent', async () => {
    const next = '+919866600006'
    await request(next, sessions.holder)
    const right = await textedCode(next)
    for (let i = 0; i < 5; i++) expect((await confirm(next, wrong(right), sessions.holder)).code).toBe('CODE_REFUSED')
    expect((await confirm(next, right, sessions.holder)).code).toBe('CODE_REFUSED')
    expect((await account(sessions.holder))?.phone).toBe(holderPhone)
  })

  it('refuses an expired code', async () => {
    const next = '+919877700007'
    await request(next, sessions.holder)
    const right = await textedCode(next)
    await db.sql`update customer_code set expires_at = '2000-01-01' where target = ${next} and used_at is null`
    expect((await confirm(next, right, sessions.holder)).code).toBe('CODE_REFUSED')
    expect((await account(sessions.holder))?.phone).toBe(holderPhone)
  })

  it('spends a code once', async () => {
    const next = '+919888800008'
    await request(next, sessions.holder)
    const right = await textedCode(next)
    expect((await confirm(next, right, sessions.holder)).data?.['confirmPhone']).toBe(true)
    expect((await confirm(next, right, sessions.holder)).code).toBe('CODE_REFUSED')
    await db.sql`update customer set phone = ${holderPhone} where id = ${people.holder}`
  })
})

describe('a number another account holds', () => {
  it('answers the request as any other, texts nothing, and refuses the confirm as a wrong code', async () => {
    const before = await texts(holderPhone)
    expect((await request(holderPhone, sessions.noPhone)).data?.['requestPhoneCode']).toBe(true)
    expect(await texts(holderPhone)).toBe(before)
    expect((await confirm(holderPhone, '000000', sessions.noPhone)).code).toBe('CODE_REFUSED')
    expect((await account(sessions.holder))?.phone).toBe(holderPhone)
    expect((await account(sessions.noPhone))?.phone).not.toBe(holderPhone)
  })

  it('counts those requests against the same limits, so the limit says nothing of the account either', async () => {
    const held = '+919899900009'
    const free = '+919899900010'
    await db.sql`insert into customer (store_id, name, phone, phone_verified_at, status) values (${stores.india}, 'Held', ${held}, now(), 'active')`
    const results = async (to: string) => {
      const out: (string | undefined)[] = []
      for (let i = 0; i < 4; i++) out.push((await request(to, sessions.noPhone)).code)
      return out
    }
    const asked = await results(held)
    expect(asked).toEqual([undefined, undefined, undefined, 'RATE_LIMITED'])
    expect(await results(free)).toEqual(asked)
  })

  it('lets another store’s shopper take the same number: a number is per store', async () => {
    await request(holderPhone, sessions.otherStore, hostOf.other)
    expect((await confirm(holderPhone, await textedCode(holderPhone), sessions.otherStore, hostOf.other)).data?.['confirmPhone']).toBe(true)
    expect(await account(sessions.holder)).toEqual({ phone: holderPhone, phoneVerified: true })
    expect((await gql('{ account { phone } }', { session: sessions.otherStore, host: hostOf.other })).data?.['account']).toEqual({ phone: holderPhone })
  })
})

describe('who may change a number', () => {
  it('needs a signed-in shopper of this store: another store’s session, or none, is signed out', async () => {
    expect((await request('+919800000010', '')).code).toBe('SIGNED_OUT')
    expect((await confirm('+919800000010', '123456', sessions.otherStore)).code).toBe('SIGNED_OUT')
    expect(await account(sessions.otherStore)).toBeNull()
  })

  it('has no way to name another account: it always acts on the session’s own', async () => {
    const next = '+919800000011'
    await request(next, sessions.noPhone)
    await confirm(next, await textedCode(next), sessions.noPhone)
    expect((await account(sessions.noPhone))?.phone).toBe(next)
    expect((await account(sessions.holder))?.phone).toBe(holderPhone)
    expect((await account(sessions.other))?.phone).toBe('+919844400004')
    expect(await db.sql`select count(*)::int as n from customer where store_id = ${stores.india} and phone = ${next}`).toEqual([{ n: 1 }])
  })

  it('is refused by a store that takes no mobile sign-in', async () => {
    expect((await request('+919800000012', sessions.emailOnly, hostOf.emailOnly)).code).toBe('METHOD_OFF')
    expect((await confirm('+919800000012', '123456', sessions.emailOnly, hostOf.emailOnly)).code).toBe('METHOD_OFF')
  })

  it('refuses a number that can’t be one, and a code that isn’t six digits', async () => {
    expect((await request('not a number', sessions.noPhone)).code).toBe('INVALID_INPUT')
    expect((await confirm('+919800000013', '12', sessions.noPhone)).code).toBe('INVALID_INPUT')
  })

  it('is limited, and the limiter is never given a number', async () => {
    allow = false
    try {
      expect((await request('+919800000014', sessions.noPhone)).code).toBe('RATE_LIMITED')
      expect((await confirm('+919800000014', '123456', sessions.noPhone)).code).toBe('RATE_LIMITED')
    } finally {
      allow = true
    }
    expect(limiterKeys.length).toBeGreaterThan(0)
    expect(limiterKeys.filter((k) => k.includes('919800000014'))).toEqual([])
  })
})

describe('the activity log', () => {
  it('records the request and the change about the shopper alone, never a number or a code', async () => {
    const rows = await db.sql<{ action: string; result: string; reason: string | null; customer_id: string | null }[]>`
      select action, result, reason, customer_id from activity_log where customer_id = ${people.noPhone} order by occurred_at`
    expect(new Set(rows.map((r) => `${r.action}:${r.result}`))).toEqual(new Set(['customer.code_requested:success', 'customer.updated:success', 'customer.updated:failed']))
    expect(rows.find((r) => r.action === 'customer.updated')?.reason).toBe('phone')
    const all = JSON.stringify(await db.sql`select * from activity_log where store_id = ${stores.india}`)
    expect(/\+91\d{10}/.test(all)).toBe(false)
  })
})
