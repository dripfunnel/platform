import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveShopper } from '#auth/shopCaller'
import { hashSessionId } from '#auth/session'
import { resolveStoreStanding, storeHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { purgeShopperIdentity } from '#db/scoped/shopper'
import { activityLog } from '#saas/activity/index'
import { prepareEmail } from '#saas/email/compose'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #308 (SAPI 9), part 2: shopper accounts (ACCESS §2.1): codes by text or email, email and password, sessions, the
// account and its addresses, a guest cart claimed at sign-in, and Settings › Customer accounts.

let db: TestDatabase
let t: Tenants
const stores = { india: '', other: '' }
const hostOf = { india: 'jaipur.shop.example', other: 'surat.shop.example' }
let kurta = ''
let ownerCookie = ''
let managerCookie = ''
const now = () => new Date()

const store = async (name: string, code: string) =>
  (await db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status) values (${t.partnerA}, ${name}, ${code}, 'IN', 'INR', 'active') returning id`)[0]?.id ?? ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  stores.india = await store('Jaipur', 'jaipur')
  stores.other = await store('Surat', 'surat')
  const [p] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${stores.india}, 'Kurta', 'kurta', 'visible') returning id`
  kurta = (await db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position) values (${stores.india}, ${p?.id ?? ''}, 'K1', 0) returning id`)[0]?.id ?? ''
  await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${kurta}, ${stores.india}, 'INR', 99900)`
  const person = async (email: string, role: string) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, 'P', 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${u?.id ?? ''}, ${stores.india}, ${role}, 'active')`
    return withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
  }
  ownerCookie = await person('owner@jaipur.example', 'owner')
  managerCookie = await person('manager@jaipur.example', 'manager')
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const gql = async (source: string, who: { host?: string; session?: string; cart?: string; codeCheck?: '0' } = {}) => {
  const host = who.host ?? hostOf.india
  const headers: Record<string, string> = { ...(who.session ? { 'x-shop-session': who.session } : {}), ...(who.cart ? { 'x-shop-cart': who.cart } : {}) }
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers }), host, 'shop.example')
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.7', userAgent: null }, allowAttempt: async (key) => (limiterKeys.push(key), allow), sessionToken: who.session ?? null, allowNewCart: async () => true, codeCheck: who.codeCheck, now }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const merchant = async (source: string, cookie: string) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers = { cookie: `${storeCookieName}=${cookie}`, [storeHeader]: stores.india }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

/** The code the outbox holds for a text, or the one an email mints as it is composed. */
const textedCode = async (to: string) => {
  const [row] = await db.sql<{ payload: { to: string; vars: { code: string } } }[]>`select payload from outbox where kind = 'sms' and payload->>'to' = ${to} order by created_at desc limit 1`
  return row?.payload.vars.code ?? ''
}
const emailedCode = async () => {
  const [row] = await db.sql<{ payload: unknown; partner_id: string }[]>`select payload, partner_id from outbox where kind = 'email' and payload->>'template' = 'shopper-code' order by created_at desc limit 1`
  const prepared = await withSystemScope(db.sql, (tx) => prepareEmail(tx, { payload: row?.payload, partnerId: row?.partner_id ?? null }, { adminHost: 'a', platformHost: 'p', shopDomain: 'shop.example' }, new Date()))
  if (!prepared.send) throw new Error(`no email: ${prepared.reason}`)
  return /\b(\d{6})\b/.exec(prepared.content.paragraphs.join(' '))?.[1] ?? ''
}
const verify = (channel: 'EMAIL' | 'PHONE', to: string, code: string, extra = '', who = {}) =>
  gql(`mutation { verifySignInCode(channel: ${channel}, to: "${to}", code: "${code}"${extra}) { sessionToken created } }`, who)

let phoneSession = ''
// Every key the sign-in limiter was asked about: none may hold an address.
const limiterKeys: string[] = []
// What the sign-in limiter answers; a test turns it off.
let allow = true

describe('signing in by a texted code', () => {
  it('offers both ways in an Indian store, and answers a code request the same for a new number', async () => {
    expect((await gql('{ signInOptions { email phone } }')).data?.['signInOptions']).toEqual({ email: true, phone: true })
    expect((await gql('mutation { requestSignInCode(channel: PHONE, to: "+91 98450 22113") }')).data?.['requestSignInCode']).toBe(true)
  })

  it('makes the account on the first right code and signs it in after; a wrong one is one refusal', async () => {
    expect((await verify('PHONE', '+919845022113', '000000')).code).toBe('CODE_REFUSED')
    const made = await verify('PHONE', '+919845022113', await textedCode('+919845022113'), ', name: "Asha"')
    const session = made.data?.['verifySignInCode'] as { sessionToken: string; created: boolean }
    expect(session.created).toBe(true)
    phoneSession = session.sessionToken
    expect((await verify('PHONE', '+919845022113', await textedCode('+919845022113'))).code).toBe('CODE_REFUSED')
    await gql('mutation { requestSignInCode(channel: PHONE, to: "+919845022113") }')
    expect(((await verify('PHONE', '+919845022113', await textedCode('+919845022113'))).data?.['verifySignInCode'] as { created: boolean }).created).toBe(false)
  })

  it('accepts any code for a live request when CODE_CHECK is 0', async () => {
    await gql('mutation { requestSignInCode(channel: PHONE, to: "+919855555555") }')
    try {
      expect((await verify('PHONE', '+919855555555', '000000', '', { codeCheck: '0' })).data?.['verifySignInCode']).toMatchObject({ created: true })
    } finally {
      await db.sql`delete from customer_session where customer_id in (select id from customer where phone = '+919855555555')`
      await db.sql`delete from customer where phone = '+919855555555'`
    }
  })
  it('still checks an EMAIL code when CODE_CHECK is 0, which skips text codes only (#1002)', async () => {
    await gql('mutation { requestSignInCode(channel: EMAIL, to: "mina@example.com") }')
    const code = await emailedCode()
    expect((await verify('EMAIL', 'mina@example.com', code === '000000' ? '111111' : '000000', '', { codeCheck: '0' })).code).toBe('CODE_REFUSED')
    try {
      expect(((await verify('EMAIL', 'mina@example.com', code, '', { codeCheck: '0' })).data?.['verifySignInCode'] as { created: boolean }).created).toBe(true)
    } finally {
      await db.sql`delete from customer_session where customer_id in (select id from customer where email = 'mina@example.com')`
      await db.sql`delete from customer where email = 'mina@example.com'`
    }
  })

  it('still refuses an expired code and one out of tries when CODE_CHECK is 0', async () => {
    const spoiled = [
      (target: string) => db.sql`update customer_code set expires_at = '2000-01-01' where target = ${target} and used_at is null`,
      (target: string) => db.sql`update customer_code set attempts = 5 where target = ${target} and used_at is null`,
    ]
    for (const spoil of spoiled) {
      await gql('mutation { requestSignInCode(channel: PHONE, to: "+919866666666") }')
      await spoil('+919866666666')
      expect((await verify('PHONE', '+919866666666', '000000', '', { codeCheck: '0' })).code).toBe('CODE_REFUSED')
    }
  })
  it('spends a code after five wrong tries, and limits a number to three codes in ten minutes', async () => {
    await gql('mutation { requestSignInCode(channel: PHONE, to: "+919800000001") }')
    const code = await textedCode('+919800000001')
    for (let i = 0; i < 5; i += 1) await verify('PHONE', '+919800000001', code === '111111' ? '222222' : '111111')
    expect((await verify('PHONE', '+919800000001', code)).code).toBe('CODE_REFUSED')
    await gql('mutation { requestSignInCode(channel: PHONE, to: "+919800000001") }')
    await gql('mutation { requestSignInCode(channel: PHONE, to: "+919800000001") }')
    expect((await gql('mutation { requestSignInCode(channel: PHONE, to: "+919800000001") }')).code).toBe('RATE_LIMITED')
  })
})

describe('signing in by email', () => {
  it('sets a password with an emailed code, then signs in with it; one refusal for a wrong password or an unknown email', async () => {
    await gql('mutation { requestSignInCode(channel: EMAIL, to: "Ravi@Example.com") }')
    expect((await verify('EMAIL', 'ravi@example.com', await emailedCode(), ', password: "short"')).code).toBe('WEAK_PASSWORD')
    await gql('mutation { requestSignInCode(channel: EMAIL, to: "ravi@example.com") }')
    expect(((await verify('EMAIL', 'ravi@example.com', await emailedCode(), ', password: "a-long-passphrase"')).data?.['verifySignInCode'] as { created: boolean }).created).toBe(true)
    expect((await gql('mutation { signIn(email: "RAVI@example.com", password: "a-long-passphrase") { created } }')).data?.['signIn']).toEqual({ created: false })
    expect((await gql('mutation { signIn(email: "ravi@example.com", password: "wrong-passphrase") { created } }')).code).toBe('SIGN_IN_REFUSED')
    expect((await gql('mutation { signIn(email: "nobody@example.com", password: "wrong-passphrase") { created } }')).code).toBe('SIGN_IN_REFUSED')
  })

  it('refuses a way the store has switched off, which the Owner sets in Settings and a Manager can’t', async () => {
    expect((await merchant('{ customerAccounts { mode customers withEmail withPhone phoneOnly } }', ownerCookie)).data?.['customerAccounts']).toEqual({ mode: 'both', customers: 2, withEmail: 1, withPhone: 1, phoneOnly: 1 })
    expect((await merchant('mutation { saveCustomerAccounts(mode: "mobile") { mode } }', managerCookie)).code).toBe('FORBIDDEN')
    expect((await merchant('mutation { saveCustomerAccounts(mode: "sometimes") { mode } }', ownerCookie)).code).toBe('INVALID_INPUT')
    expect((await merchant('mutation { saveCustomerAccounts(mode: "mobile") { mode } }', ownerCookie)).data?.['saveCustomerAccounts']).toEqual({ mode: 'mobile' })
    expect((await gql('mutation { signIn(email: "ravi@example.com", password: "a-long-passphrase") { created } }')).code).toBe('METHOD_OFF')
    expect((await gql('mutation { requestSignInCode(channel: EMAIL, to: "ravi@example.com") }')).code).toBe('METHOD_OFF')
    await merchant('mutation { saveCustomerAccounts(mode: "both") { mode } }', ownerCookie)
  })

  describe('guest orders at sign-in', () => {
    /** A guest's placed order; with a cart token, the one it was placed with. */
    const guest = async (storeId: string, number: string, contact: { email?: string; phone?: string }, cart?: string, shipTo?: string) =>
      (
        await db.sql<{ id: string }[]>`insert into "order" (store_id, state, currency, number, placed_at, subtotal_amount, shipping_amount, tax_amount, total_amount, tax_inclusive, email, phone, access_token_hash, shipping_address)
          values (${storeId}, 'placed', 'INR', ${number}, now(), 99900, 0, 0, 99900, true, ${contact.email ?? null}, ${contact.phone ?? null}, ${cart ? await hashSessionId(cart) : null},
            ${shipTo ? db.sql.json({ name: 'Ravi', line1: shipTo, line2: null, city: 'Jaipur', region: null, postalCode: '302001', country: 'IN', phone: null }) : null}) returning id`
      )[0]?.id ?? ''
    const opened = async (id: string, who: { session?: string; cart?: string }) =>
      (await gql(`{ order(id: "${id}") { number } }`, who)).data?.['order'] ?? null
    const ravisPhone = (phone: string | null, verified: boolean) =>
      db.sql`update customer set phone = ${phone}, phone_verified_at = ${verified ? new Date() : null} where store_id = ${stores.india} and email = 'ravi@example.com'`
    const history = async (session: string) =>
      ((await gql('{ orderHistory { nodes { number } } }', { session })).data?.['orderHistory'] as { nodes: { number: string }[] }).nodes.map((o) => o.number).sort()

    // Even after a failed assertion, so no later test sees these orders, Ravi's number or Kiran's account.
    afterEach(async () => {
      await db.sql`delete from payment where order_id in (select id from "order" where number like 'JP-9%')`
      await db.sql`delete from "order" where number like 'JP-9%' or number like 'SU-9%' or (state = 'cart' and email = 'ravi@example.com')`
      await ravisPhone(null, false)
      await db.sql`delete from customer_address where line1 like '% Guest Lane'`
      await db.sql`delete from customer_session where customer_id in (select id from customer where email = 'kiran@example.com')`
      await db.sql`delete from customer where email = 'kiran@example.com'`
    })

    it('links the store’s placed guest orders with the account’s verified email or number at a password sign-in, and no other store’s or cart', async () => {
      await ravisPhone('+919845099001', true)
      // Whoever typed Ravi's email at checkout: the decision on #1186 links it all the same (ACCESS §2.1).
      const typed = await guest(stores.india, 'JP-9001', { email: 'ravi@example.com' }, 'c'.repeat(64))
      await guest(stores.india, 'JP-9003', { phone: '+919845099001' })
      await guest(stores.india, 'JP-9002', { email: 'someone@example.com' })
      await guest(stores.other, 'SU-9001', { email: 'ravi@example.com' })
      await db.sql`insert into "order" (store_id, currency, email, access_token_hash, cart_expires_at) values (${stores.india}, 'INR', 'ravi@example.com', ${'b'.repeat(64)}, now() + interval '1 day')`
      expect(await opened(typed, { cart: 'c'.repeat(64) })).toEqual({ number: 'JP-9001' })
      const session = ((await gql('mutation { signIn(email: "ravi@example.com", password: "a-long-passphrase") { sessionToken } }')).data?.['signIn'] as { sessionToken: string }).sessionToken
      expect(await history(session)).toEqual(['JP-9001', 'JP-9003'])
      expect(await db.sql`select customer_id from "order" where state = 'cart' and email = 'ravi@example.com'`).toEqual([{ customer_id: null }])
      // The account's now: its session opens it, the guest's cart token no longer does.
      expect(await opened(typed, { session })).toEqual({ number: 'JP-9001' })
      expect(await opened(typed, { cart: 'c'.repeat(64) })).toBeNull()
      const [logged] = await db.sql<{ changes: unknown }[]>`select changes from activity_log where action = 'customer.orders_linked'`
      expect(logged?.changes).toEqual([{ field: 'orders', before: null, after: '2', redacted: false }])
    })

    it('saves the address of a linked order with both the verified email and number, once, and none from the email alone', async () => {
      await ravisPhone('+919845099001', true)
      const both = { email: 'ravi@example.com', phone: '+919845099001' }
      await guest(stores.india, 'JP-9007', both, undefined, '7 Guest Lane')
      await guest(stores.india, 'JP-9008', both, undefined, '7 Guest Lane')
      await guest(stores.india, 'JP-9009', { email: 'ravi@example.com' }, undefined, '9 Guest Lane')
      await gql('mutation { signIn(email: "ravi@example.com", password: "a-long-passphrase") { sessionToken } }')
      expect(await db.sql`select line1, is_default_shipping from customer_address where line1 like '% Guest Lane'`).toEqual([{ line1: '7 Guest Lane', is_default_shipping: true }])
      const [logged] = await db.sql<{ count: number }[]>`select count(*)::int from activity_log where action = 'customer.address_saved' and target_type = 'customer_address' and target_id in (select id::text from customer_address where line1 like '% Guest Lane')`
      expect(logged?.count).toBe(1)
    })

    const ravisId = async () => (await db.sql<{ id: string }[]>`select id from customer where store_id = ${stores.india} and email = 'ravi@example.com'`)[0]?.id ?? ''
    const keep = async (lines: string[], isDefault = false) => {
      const id = await ravisId()
      for (const line1 of lines)
        await db.sql`insert into customer_address (customer_id, store_id, name, line1, city, postal_code, country, is_default_shipping) values (${id}, ${stores.india}, 'Ravi', ${line1}, 'Jaipur', '302001', 'IN', ${isDefault})`
    }
    const signIn = () => gql('mutation { signIn(email: "ravi@example.com", password: "a-long-passphrase") { sessionToken } }')

    it('adds no place the account holds, keeps its default, and takes nothing from a number alone or someone else’s number', async () => {
      await ravisPhone('+919845099001', true)
      await keep(['1 Guest Lane'], true)
      const both = { email: 'ravi@example.com', phone: '+919845099001' }
      await guest(stores.india, 'JP-9010', both, undefined, '1 guest lane')
      await guest(stores.india, 'JP-9011', both, undefined, '2 Guest Lane')
      await guest(stores.india, 'JP-9012', { phone: '+919845099001' }, undefined, '3 Guest Lane')
      await guest(stores.india, 'JP-9013', { email: 'ravi@example.com', phone: '+919845099999' }, undefined, '4 Guest Lane')
      await signIn()
      expect(await db.sql`select line1, is_default_shipping from customer_address where line1 like '% Guest Lane' and deleted_at is null order by line1`).toEqual([
        { line1: '1 Guest Lane', is_default_shipping: true },
        { line1: '2 Guest Lane', is_default_shipping: false },
      ])
    })

    it('stops at the account’s 20 addresses', async () => {
      await ravisPhone('+919845099001', true)
      const [held] = await db.sql<{ n: number }[]>`select count(*)::int as n from customer_address where customer_id = ${await ravisId()} and deleted_at is null`
      await keep(Array.from({ length: 19 - (held?.n ?? 0) }, (_, i) => `${100 + i} Guest Lane`))
      const both = { email: 'ravi@example.com', phone: '+919845099001' }
      await guest(stores.india, 'JP-9014', both, undefined, '7 Guest Lane')
      await guest(stores.india, 'JP-9015', both, undefined, '8 Guest Lane')
      await signIn()
      const [after] = await db.sql<{ total: number; added: number }[]>`
        select count(*)::int as total, count(*) filter (where line1 in ('7 Guest Lane', '8 Guest Lane'))::int as added
        from customer_address where customer_id = ${await ravisId()} and deleted_at is null`
      expect(after).toEqual({ total: 20, added: 1 })
    })

    it('links them at a sign-in by code too, the one that makes the account', async () => {
      await guest(stores.india, 'JP-9005', { email: 'kiran@example.com' })
      await gql('mutation { requestSignInCode(channel: EMAIL, to: "kiran@example.com") }')
      const session = ((await verify('EMAIL', 'kiran@example.com', await emailedCode())).data?.['verifySignInCode'] as { sessionToken: string }).sessionToken
      expect(await history(session)).toEqual(['JP-9005'])
    })

    it('links nothing by a number the account hasn’t verified', async () => {
      await ravisPhone('+919845099002', false)
      await guest(stores.india, 'JP-9004', { phone: '+919845099002' })
      await gql('mutation { signIn(email: "ravi@example.com", password: "a-long-passphrase") { sessionToken } }')
      expect(await db.sql`select customer_id from "order" where number = 'JP-9004'`).toEqual([{ customer_id: null }])
    })

    it('links no preview’s test order, which isn’t a sale', async () => {
      const test = await guest(stores.india, 'JP-9006', { email: 'ravi@example.com' })
      await db.sql`insert into payment (order_id, store_id, provider, kind, state, amount, currency, mode) values (${test}, ${stores.india}, 'cod', 'cod', 'pending', 99900, 'INR', 'test')`
      await gql('mutation { signIn(email: "ravi@example.com", password: "a-long-passphrase") { sessionToken } }')
      expect(await db.sql`select customer_id from "order" where number = 'JP-9006'`).toEqual([{ customer_id: null }])
    })
  })
})

describe('a signed-in shopper', () => {
  it('reads and changes its own account and addresses', async () => {
    const who = { session: phoneSession }
    expect((await gql('{ account { name phone phoneVerified emailVerified addresses { id } } }', who)).data?.['account']).toEqual({ name: 'Asha', phone: '+919845022113', phoneVerified: true, emailVerified: false, addresses: [] })
    await gql('mutation { updateAccount(name: "Asha Rao") }', who)
    const saved = await gql('mutation { saveAddress(address: { name: "Asha Rao", line1: "12 MG Road", city: "Pune", country: "IN", postalCode: "411001" }, isDefault: true) }', who)
    const id = saved.data?.['saveAddress'] as string
    expect((await gql('{ account { name addresses { id city isDefault } } }', who)).data?.['account']).toEqual({ name: 'Asha Rao', addresses: [{ id, city: 'Pune', isDefault: true }] })
    expect((await gql('mutation { saveAddress(address: { name: "x", line1: "y", city: "z", country: "XX" }) }', who)).code).toBe('INVALID_INPUT')
    // Saving an address that isn't there is refused and leaves the default as it was.
    expect((await gql(`mutation { saveAddress(id: "${crypto.randomUUID()}", address: { name: "x", line1: "y", city: "z", country: "IN" }, isDefault: true) }`, who)).code).toBe('NOT_FOUND')
    expect((await gql('{ account { addresses { id isDefault } } }', who)).data?.['account']).toEqual({ addresses: [{ id, isDefault: true }] })
    // Editing the default without saying isDefault keeps it the default.
    expect((await gql(`mutation { saveAddress(id: "${id}", address: { name: "Asha Rao", line1: "14 MG Road", city: "Pune", country: "IN" }) }`, who)).data?.['saveAddress']).toBe(id)
    expect((await gql('{ account { addresses { id isDefault } } }', who)).data?.['account']).toEqual({ addresses: [{ id, isDefault: true }] })
    expect((await gql(`mutation { deleteAddress(id: "${id}") }`, who)).data?.['deleteAddress']).toBe(true)
    expect((await gql('{ account { addresses { id } } }', who)).data?.['account']).toEqual({ addresses: [] })
  })

  it('never changes or deletes another shopper’s address in the same store', async () => {
    const who = { session: phoneSession }
    const theirs = (await gql('mutation { saveAddress(address: { name: "Asha", line1: "12 MG Road", city: "Pune", country: "IN" }, isDefault: true) }', who)).data?.['saveAddress'] as string
    await gql('mutation { requestSignInCode(channel: PHONE, to: "+919845033224") }')
    const other = { session: ((await verify('PHONE', '+919845033224', await textedCode('+919845033224'))).data?.['verifySignInCode'] as { sessionToken: string }).sessionToken }
    expect((await gql(`mutation { saveAddress(id: "${theirs}", address: { name: "x", line1: "y", city: "z", country: "IN" }, isDefault: false) }`, other)).code).toBe('NOT_FOUND')
    expect((await gql(`mutation { deleteAddress(id: "${theirs}") }`, other)).code).toBe('NOT_FOUND')
    expect((await gql('{ account { addresses { id city isDefault } } }', who)).data?.['account']).toEqual({ addresses: [{ id: theirs, city: 'Pune', isDefault: true }] })
    await gql(`mutation { deleteAddress(id: "${theirs}") }`, who)
  })

  it('keeps a map pin whole and in range, shows it to nobody else, and erases it with the address', async () => {
    const who = { session: phoneSession }
    const pinned = 'name: "Asha", line1: "12 MG Road", city: "Pune", country: "IN"'
    const id = (await gql(`mutation { saveAddress(address: { ${pinned}, latitude: 18.5204, longitude: 73.8567 }) }`, who)).data?.['saveAddress'] as string
    expect((await gql('{ account { addresses { id latitude longitude } } }', who)).data?.['account']).toEqual({ addresses: [{ id, latitude: 18.5204, longitude: 73.8567 }] })
    for (const pin of ['latitude: 18.5', 'longitude: 73.8', 'latitude: 18.5, longitude: null', 'latitude: 90.5, longitude: 0', 'latitude: 0, longitude: -180.5']) {
      expect((await gql(`mutation { saveAddress(address: { ${pinned}, ${pin} }) }`, who)).code).toBe('INVALID_INPUT')
    }
    await gql('mutation { requestSignInCode(channel: PHONE, to: "+919845044335") }')
    const other = { session: ((await verify('PHONE', '+919845044335', await textedCode('+919845044335'))).data?.['verifySignInCode'] as { sessionToken: string }).sessionToken }
    expect((await gql('{ account { addresses { latitude } } }', other)).data?.['account']).toEqual({ addresses: [] })
    expect(await withScope(db.sql, { caller: { kind: 'shopper', customerId: null }, partnerId: t.partnerA, storeId: stores.other, sellerScope: { kind: 'all' }, subscription: 'active' }, (tx) => tx`select latitude from customer_address`)).toHaveLength(0)
    await gql(`mutation { deleteAddress(id: "${id}") }`, who)
    expect(await db.sql`select latitude, longitude from customer_address where id = ${id}`).toEqual([{ latitude: null, longitude: null }])
  })

  it('keeps at most 20 addresses, and still edits one at the cap', async () => {
    const who = { session: phoneSession }
    const ids: string[] = []
    for (let i = 0; i < 20; i++) ids.push((await gql(`mutation { saveAddress(address: { name: "A", line1: "${i} MG Road", city: "Pune", country: "IN" }) }`, who)).data?.['saveAddress'] as string)
    expect((await gql('mutation { saveAddress(address: { name: "A", line1: "21 MG Road", city: "Pune", country: "IN" }) }', who)).code).toBe('TOO_MANY')
    expect((await gql(`mutation { saveAddress(id: "${ids[0] ?? ''}", address: { name: "A", line1: "0 FC Road", city: "Pune", country: "IN" }) }`, who)).data?.['saveAddress']).toBe(ids[0])
    for (const id of ids) await gql(`mutation { deleteAddress(id: "${id}") }`, who)
  })

  it('takes over the guest cart it held when it signs in', async () => {
    const added = await gql(`mutation { addToCart(versionId: "${kurta}", quantity: 1) { cartToken } }`)
    const cart = (added.data?.['addToCart'] as { cartToken: string }).cartToken
    await gql('mutation { requestSignInCode(channel: PHONE, to: "+919845022113") }')
    const session = ((await verify('PHONE', '+919845022113', await textedCode('+919845022113'), '', { cart })).data?.['verifySignInCode'] as { sessionToken: string }).sessionToken
    expect((await gql('{ cart { lines { quantity } } }', { session })).data?.['cart']).toEqual({ lines: [{ quantity: 1 }] })
    const owner = await db.sql<{ customer_id: string | null }[]>`select customer_id from "order" where store_id = ${stores.india} and state = 'cart'`
    expect(owner.every((o) => o.customer_id !== null)).toBe(true)
  })

  it('is signed out by signOut, and is nobody in another store', async () => {
    expect((await gql('{ account { name } }', { session: phoneSession, host: hostOf.other })).data?.['account']).toBeNull()
    expect((await gql('mutation { signOut }', { session: phoneSession })).data?.['signOut']).toBe(true)
    expect((await gql('{ account { name } }', { session: phoneSession })).data?.['account']).toBeNull()
    expect((await gql('mutation { updateAccount(name: "x") }', { session: phoneSession })).code).toBe('SIGNED_OUT')
  })
})

describe('isolation', () => {
  const shopper = async (storeId: string): Promise<TenantContext> => {
    const [c] = await db.sql<{ id: string }[]>`select id from customer where store_id = ${stores.india} and phone = '+919845022113'`
    return { caller: { kind: 'shopper', customerId: c?.id ?? null }, partnerId: t.partnerA, storeId, sellerScope: { kind: 'all' }, subscription: 'active' }
  }

  it('never shows a shopper a code, a session or another shopper’s addresses', async () => {
    for (const table of ['customer_code', 'customer_session']) {
      await expect(withScope(db.sql, await shopper(stores.india), (tx) => tx.unsafe(`select 1 from ${table}`))).rejects.toThrow(/permission denied/)
    }
    await db.sql`insert into customer_address (customer_id, store_id, name, line1, city, country) select id, store_id, 'R', 'L', 'Delhi', 'IN' from customer where store_id = ${stores.india} and email = 'ravi@example.com'`
    expect(await withScope(db.sql, await shopper(stores.india), (tx) => tx`select id from customer_address where deleted_at is null`)).toHaveLength(0)
    expect(await withScope(db.sql, await shopper(stores.other), (tx) => tx`select id from customer`)).toHaveLength(0)
    await expect(withScope(db.sql, await shopper(stores.india), (tx) => tx`update customer set email = 'x@example.com'`)).rejects.toThrow(/permission denied/)
  })

  it('records sign-ins and account changes for the merchant, never the code or the number', async () => {
    const rows = await db.sql<{ action: string; reason: string | null; target_label: string | null }[]>`select action, reason, target_label from activity_log where store_id = ${stores.india} and action like 'customer.%'`
    expect(new Set(rows.map((r) => r.action))).toEqual(new Set(['customer.code_requested', 'customer.signed_up', 'customer.signed_in', 'customer.sign_in_failed', 'customer.updated', 'customer.address_saved', 'customer.address_removed', 'customer.signed_out', 'customer.orders_linked']))
    expect(JSON.stringify(rows)).not.toMatch(/9845022113|ravi@example\.com/)
  })
})

describe('limits, safeguards and the code email', () => {
  it('refuses a code request or a code once the limiter says no', async () => {
    allow = false
    expect((await gql('mutation { requestSignInCode(channel: PHONE, to: "+919811111111") }')).code).toBe('RATE_LIMITED')
    expect((await verify('PHONE', '+919811111111', '123456')).code).toBe('RATE_LIMITED')
    allow = true
  })

  it('stops texting codes once the store has sent 50 in 10 minutes, whatever numbers are asked for', async () => {
    await db.sql`insert into customer_code (store_id, channel, target, expires_at) select ${stores.india}, 'phone', '+9198000' || lpad(n::text, 5, '0'), now() + interval '10 minutes' from generate_series(1, 50) n`
    try {
      expect((await gql('mutation { requestSignInCode(channel: PHONE, to: "+919877777777") }')).code).toBe('RATE_LIMITED')
      // An email code is unaffected: texts are what cost.
      expect((await gql('mutation { requestSignInCode(channel: EMAIL, to: "cap@example.com") }')).code).toBeUndefined()
    } finally {
      await db.sql`delete from customer_code where store_id = ${stores.india} and target like '+9198000%'`
    }
  })

  it('ends every other session when a code sets a new password', async () => {
    const before = ((await gql('mutation { signIn(email: "ravi@example.com", password: "a-long-passphrase") { sessionToken } }')).data?.['signIn'] as { sessionToken: string }).sessionToken
    expect((await gql('{ account { email } }', { session: before })).data?.['account']).toEqual({ email: 'ravi@example.com' })
    await gql('mutation { requestSignInCode(channel: EMAIL, to: "ravi@example.com") }')
    const after = ((await verify('EMAIL', 'ravi@example.com', await emailedCode(), ', password: "another-long-one"')).data?.['verifySignInCode'] as { sessionToken: string }).sessionToken
    expect((await gql('{ account { email } }', { session: before })).data?.['account']).toBeNull()
    expect((await gql('{ account { email } }', { session: after })).data?.['account']).toEqual({ email: 'ravi@example.com' })
  })

  it('signs nobody in where the store has no sign-in setting at all', async () => {
    await db.sql`delete from store_customer_auth where store_id = ${stores.other}`
    expect((await gql('{ signInOptions { email phone } }', { host: hostOf.other })).data?.['signInOptions']).toEqual({ email: false, phone: false })
    expect((await gql('mutation { requestSignInCode(channel: EMAIL, to: "x@example.com") }', { host: hostOf.other })).code).toBe('METHOD_OFF')
  })

  it('lets a shopper log only entries about itself, as itself', async () => {
    const [me] = await db.sql<{ id: string }[]>`select id from customer where store_id = ${stores.india} and phone = '+919845022113'`
    const [other] = await db.sql<{ id: string }[]>`select id from customer where store_id = ${stores.india} and email = 'ravi@example.com'`
    const context: TenantContext = { caller: { kind: 'shopper', customerId: me?.id ?? null }, partnerId: t.partnerA, storeId: stores.india, sellerScope: { kind: 'all' }, subscription: 'active' }
    const forge = (customerId: string, actorId: string) =>
      withScope(db.sql, context, (tx) => tx`insert into activity_log (category, action, result, actor_kind, actor_id, visibility, store_id, partner_id, customer_id)
        values ('write', 'customer.updated', 'success', 'customer', ${actorId}, 'store', ${stores.india}, ${t.partnerA}, ${customerId})`)
    await expect(forge(other?.id ?? '', other?.id ?? '')).rejects.toThrow(/row-level security/)
    await expect(forge(other?.id ?? '', me?.id ?? '')).rejects.toThrow(/row-level security/)
    await expect(forge(me?.id ?? '', me?.id ?? '')).resolves.toBeDefined()
  })

  it('keeps the setting and addresses to their store, the support session read-only and a supplier out', async () => {
    const merchant = (storeId: string, extra: Partial<TenantContext> = {}): TenantContext => ({ caller: { kind: 'person', userId: 'u', sessionId: 's' }, partnerId: t.partnerA, storeId, sellerScope: { kind: 'all' }, subscription: 'active', ...extra })
    const count = (context: TenantContext, table: string) => withScope(db.sql, context, async (tx) => Number((await tx.unsafe<{ n: string }[]>(`select count(*)::text as n from ${table}`))[0]?.n))
    expect(await count(merchant(stores.india), 'customer_address')).toBeGreaterThan(0)
    expect(await count(merchant(stores.other), 'customer_address')).toBe(0)
    expect(await count(merchant(stores.india), 'store_customer_auth')).toBe(1)
    await expect(count(merchant(stores.india), 'customer_code')).rejects.toThrow(/permission denied/)
    await expect(count(merchant(stores.india, { sellerScope: { kind: 'seller', sellerId: t.sellerA1First } }), 'store_customer_auth')).rejects.toThrow(/permission denied/)
    await expect(count(merchant(stores.india, { sellerScope: { kind: 'seller', sellerId: t.sellerA1First } }), 'customer_address')).rejects.toThrow(/permission denied/)
    const support: TenantContext = { caller: { kind: 'support', supportSessionId: 'ss', partnerUserId: 'pu', access: 'read' }, partnerId: t.partnerA, storeId: stores.india, sellerScope: { kind: 'all' }, subscription: 'active' }
    await expect(withScope(db.sql, support, (tx) => tx`update store_customer_auth set phone_enabled = false`)).rejects.toThrow(/row-level security/)
  })

  it('purges codes a day past their expiry and sessions ended a month ago', async () => {
    const codes = Number((await db.sql<{ n: string }[]>`select count(*)::text as n from customer_code`)[0]?.n)
    expect(codes).toBeGreaterThan(0)
    const removed = await withSystemScope(db.sql, (tx) => purgeShopperIdentity(tx, new Date(Date.now() + 60 * 86_400_000), 500))
    expect(removed).toBeGreaterThanOrEqual(codes)
    expect(Number((await db.sql<{ n: string }[]>`select count(*)::text as n from customer_code`)[0]?.n)).toBe(0)
  })
})

describe('refused codes and the code email', () => {
  it('refuses an expired code, a deleted account and another store’s code alike, and logs the failure without the address', async () => {
    await gql('mutation { requestSignInCode(channel: PHONE, to: "+919822222222") }')
    const code = await textedCode('+919822222222')
    await db.sql`insert into store_customer_auth (store_id, email_enabled, phone_enabled) values (${stores.other}, true, true) on conflict (store_id) do update set phone_enabled = true`
    expect((await verify('PHONE', '+919822222222', code, '', { host: hostOf.other })).code).toBe('CODE_REFUSED')
    await db.sql`update customer_code set expires_at = now() - interval '1 minute' where target = '+919822222222'`
    expect((await verify('PHONE', '+919822222222', code)).code).toBe('CODE_REFUSED')
    await db.sql`insert into customer (store_id, phone, status) values (${stores.india}, '+919833333333', 'deleted')`
    await gql('mutation { requestSignInCode(channel: PHONE, to: "+919833333333") }')
    expect((await verify('PHONE', '+919833333333', await textedCode('+919833333333'))).code).toBe('CODE_REFUSED')
    const failed = await db.sql<{ reason: string | null; target_label: string | null }[]>`select reason, target_label from activity_log where action = 'customer.sign_in_failed' and store_id = ${stores.india}`
    expect(failed.length).toBeGreaterThan(0)
    expect(JSON.stringify(failed)).not.toMatch(/98222|98333/)
  })

  it('emails a code minted as it is sent: never in the outbox, never for a used code or another partner', async () => {
    await gql('mutation { requestSignInCode(channel: EMAIL, to: "neha@example.com") }')
    const [row] = await db.sql<{ payload: Record<string, unknown>; partner_id: string }[]>`select payload, partner_id from outbox where kind = 'email' and payload->>'template' = 'shopper-code' order by created_at desc limit 1`
    expect(Object.keys(row?.payload ?? {}).sort()).toEqual(['customerCodeId', 'template'])
    const prepare = (partnerId: string | null) => withSystemScope(db.sql, (tx) => prepareEmail(tx, { payload: row?.payload, partnerId }, { adminHost: 'a', platformHost: 'p', shopDomain: 'shop.example' }, new Date()))
    expect(await prepare(t.partnerB)).toEqual({ send: false, reason: 'tenant_mismatch' })
    const sent = await prepare(row?.partner_id ?? null)
    expect(sent.send && sent.to).toEqual(['neha@example.com'])
    await db.sql`update customer_code set used_at = now() where id = ${String(row?.payload['customerCodeId'])}`
    expect(await prepare(row?.partner_id ?? null)).toEqual({ send: false, reason: 'link_closed' })
  })
})

describe('what sign-in leaves behind', () => {
  it('never puts an email or number in a limiter key', () => {
    expect(limiterKeys.length).toBeGreaterThan(0)
    expect(limiterKeys.filter((k) => /@|\+91|98450/.test(k))).toEqual([])
  })

  it('moves a session on at most hourly, however many requests carry it', async () => {
    const seen = async () => (await db.sql<{ last_seen_at: Date }[]>`select last_seen_at from customer_session where ended_at is null order by created_at desc limit 1`)[0]?.last_seen_at.getTime()
    await gql('mutation { requestSignInCode(channel: PHONE, to: "+919811111111") }')
    const session = ((await verify('PHONE', '+919811111111', await textedCode('+919811111111'))).data?.['verifySignInCode'] as { sessionToken: string }).sessionToken
    await db.sql`update customer_session set last_seen_at = now() - interval '10 minutes'`
    const fresh = await seen()
    await gql('{ account { phone } }', { session })
    expect(await seen()).toBe(fresh)
    await db.sql`update customer_session set last_seen_at = now() - interval '2 hours'`
    await gql('{ account { phone } }', { session })
    expect((await seen()) ?? 0).toBeGreaterThan(Date.now() - 60_000)
  })

  it('leaves a phone-only shopper unable to sign in once the store takes email only (the add-an-email step is open, ACCESS §2.1)', async () => {
    await db.sql`update store_customer_auth set phone_enabled = false, email_enabled = true where store_id = ${stores.india}`
    try {
      expect((await gql('mutation { requestSignInCode(channel: PHONE, to: "+919845022113") }')).code).toBe('METHOD_OFF')
    } finally {
      await db.sql`update store_customer_auth set phone_enabled = true where store_id = ${stores.india}`
    }
  })
})
