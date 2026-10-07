import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveShopper } from '#auth/shopCaller'
import { resolveStoreStanding, storeHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { prepareEmail } from '#saas/email/compose'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #308 (SAPI 9), part 2: shopper accounts (ACCESS §2.1): codes by text or email, email and password, sessions, the
// account and its addresses, a guest cart claimed at sign-in, and Settings › Customer accounts.

let db: TestDatabase
let t: Tenants
const stores = { india: '', other: '' }
const hostOf = { india: 'jaipur.shops.acme.example', other: 'surat.shops.acme.example' }
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
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x')`
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

const gql = async (source: string, who: { host?: string; session?: string; cart?: string } = {}) => {
  const host = who.host ?? hostOf.india
  const headers: Record<string, string> = { ...(who.session ? { 'x-shop-session': who.session } : {}), ...(who.cart ? { 'x-shop-cart': who.cart } : {}) }
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers }), host)
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.7', userAgent: null }, allowAttempt: async () => true, sessionToken: who.session ?? null, now }
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
  const prepared = await withSystemScope(db.sql, (tx) => prepareEmail(tx, { payload: row?.payload, partnerId: row?.partner_id ?? null }, { adminHost: 'a', platformHost: 'p' }, new Date()))
  if (!prepared.send) throw new Error(`no email: ${prepared.reason}`)
  return /\b(\d{6})\b/.exec(prepared.content.paragraphs.join(' '))?.[1] ?? ''
}
const verify = (channel: 'EMAIL' | 'PHONE', to: string, code: string, extra = '', who = {}) =>
  gql(`mutation { verifySignInCode(channel: ${channel}, to: "${to}", code: "${code}"${extra}) { sessionToken created } }`, who)

let phoneSession = ''

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
    expect((await gql(`mutation { deleteAddress(id: "${id}") }`, who)).data?.['deleteAddress']).toBe(true)
    expect((await gql('{ account { addresses { id } } }', who)).data?.['account']).toEqual({ addresses: [] })
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
    expect(new Set(rows.map((r) => r.action))).toEqual(new Set(['customer.code_requested', 'customer.signed_up', 'customer.signed_in', 'customer.sign_in_failed', 'customer.updated', 'customer.address_saved', 'customer.address_removed', 'customer.signed_out']))
    expect(JSON.stringify(rows)).not.toMatch(/9845022113|ravi@example\.com/)
  })
})
