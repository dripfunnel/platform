import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { paymentModeOf } from '#apis/shop/access'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { hashSessionId, newSessionId } from '#auth/session'
import { resolveShopper, type ShopResolution } from '#auth/shopCaller'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #518: every store's preview is on {key}.<PREVIEW_DOMAIN> (storefront PREVIEW.md §2 step 5, §5, §6), and the
// partner "preview" address is retired (SAAS §3.5).

const previewDomain = 'preview.localhost'
let db: TestDatabase
let t: Tenants
const previewKeys: Record<'a1' | 'a2' | 'b1', string> = { a1: '', a2: '', b1: '' }
const publicKeys: Record<'a1' | 'a2' | 'b1', string> = { a1: '', a2: '', b1: '' }
let session = ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set pricing_currency = 'INR', country = 'IN', status = 'active' where id in (${t.storeA1}, ${t.storeA2}, ${t.storeB1})`
  await db.sql`update partner set state = 'live' where id in (${t.partnerA}, ${t.partnerB})`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x')`
  await db.sql`insert into custom_domain (store_id, host, status, expected_cname, ownership_token) values (${t.storeA2}, 'www.a2-shop.example', 'live', 'x', 'y')`
  for (const [k, id] of [['a1', t.storeA1], ['a2', t.storeA2], ['b1', t.storeB1]] as const) {
    const [row] = await db.sql<{ preview_key: string; public_store_key: string }[]>`select preview_key, public_store_key from storefront where store_id = ${id}`
    previewKeys[k] = row?.preview_key ?? ''
    publicKeys[k] = row?.public_store_key ?? ''
  }
  session = newSessionId()
  await db.sql`insert into customer_session (id_hash, store_id, customer_id, created_at, last_seen_at, expires_at)
    values (${await hashSessionId(session)}, ${t.storeA1}, ${t.customerA1}, now(), now(), now() + interval '1 day')`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const resolve = (host: string, headers: Record<string, string> = {}, domain: string | null = previewDomain) =>
  resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers }), host, domain)
const found = (r: ShopResolution) => {
  if (r.kind !== 'found') throw new Error(`no store: ${r.kind}`)
  return r.shopper
}
const previewHost = (k: keyof typeof previewKeys) => `${previewKeys[k]}.${previewDomain}`
const gql = async (host: string, source: string, headers: Record<string, string> = {}) => {
  const shopper = found(await resolve(host, headers))
  const contextValue: ShopContext = { sql: db.sql, shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.9', userAgent: null }, allowAttempt: async () => true, sessionToken: shopper.preview ? null : (headers['x-shop-session'] ?? null), allowNewCart: async () => true, now: () => new Date() }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

describe('preview keys', () => {
  it('gives every store, old and new, its own key of 10 lowercase base32 characters', async () => {
    const [made] = await db.sql<{ id: string }[]>`insert into store (partner_id, name, code) values (${t.partnerB}, 'Fresh', 'fresh') returning id`
    const rows = await db.sql<{ store_id: string; preview_key: string }[]>`select store_id, preview_key from storefront`
    expect(rows.map((r) => r.store_id)).toContain(made?.id)
    expect(rows.every((r) => /^[a-z2-7]{10}$/.test(r.preview_key))).toBe(true)
    expect(new Set(rows.map((r) => r.preview_key)).size).toBe(rows.length)
    expect((await db.sql<{ n: number }[]>`select count(*)::int as n from store s left join storefront f on f.store_id = s.id where f.preview_key is null`)[0]?.n).toBe(0)
  })

  it('refuses a second store with a key already taken', async () => {
    await expect(db.sql`update storefront set preview_key = ${previewKeys.a1} where store_id = ${t.storeA2}`).rejects.toThrow(/storefront_preview_key_key/)
  })
})

describe('finding the store on a preview host', () => {
  it('serves the store its key names, with checkout in test mode', async () => {
    const shopper = found(await resolve(previewHost('a1')))
    expect([shopper.context.storeId, shopper.preview, paymentModeOf(shopper)]).toEqual([t.storeA1, true, 'test'])
    expect(found(await resolve(previewHost('b1').toUpperCase())).context.storeId).toBe(t.storeB1)
  })

  it('knows no store for an unknown key, a malformed or nested label, or a closed partner’s store, whatever key comes with it', async () => {
    expect(await resolve(`aaaaaaaaaa.${previewDomain}`)).toEqual({ kind: 'unknown' })
    expect(await resolve(`aaaaaaaaaa.${previewDomain}`, { 'x-shop-key': publicKeys.a1 })).toEqual({ kind: 'unknown' })
    expect(await resolve(`store-a1.${previewDomain}`, { 'x-shop-key': publicKeys.a1 })).toEqual({ kind: 'unknown' })
    expect(await resolve(`x.${previewHost('a1')}`)).toEqual({ kind: 'unknown' })
    expect(await resolve(previewDomain, { 'x-shop-key': publicKeys.a1 })).toEqual({ kind: 'found', shopper: expect.objectContaining({ preview: false }) })
    await db.sql`update partner set state = 'closed' where id = ${t.partnerB}`
    expect(await resolve(previewHost('b1'))).toEqual({ kind: 'unknown' })
    await db.sql`update partner set state = 'live' where id = ${t.partnerB}`
    expect(found(await resolve(previewHost('b1'))).context.storeId).toBe(t.storeB1)
  })

  it('refuses store X’s key on store Y’s preview host, and takes Y’s own', async () => {
    expect(await resolve(previewHost('a2'), { 'x-shop-key': publicKeys.a1 })).toEqual({ kind: 'key-mismatch' })
    expect(await resolve(previewHost('a2'), { 'x-shop-key': 'pk_' + '0'.repeat(32) })).toEqual({ kind: 'key-mismatch' })
    expect(found(await resolve(previewHost('a2'), { 'x-shop-key': publicKeys.a2 })).context.storeId).toBe(t.storeA2)
  })

  it('no longer reaches a store at {code}.preview.<partner domain>, and keeps the shops address and a live domain in live mode', async () => {
    expect(await resolve('store-a1.preview.acme.example')).toEqual({ kind: 'unknown' })
    const shops = found(await resolve('store-a1.shops.acme.example'))
    const own = found(await resolve('www.a2-shop.example'))
    expect([shops.context.storeId, shops.preview, paymentModeOf(shops)]).toEqual([t.storeA1, false, 'live'])
    expect([own.context.storeId, own.preview, paymentModeOf(own)]).toEqual([t.storeA2, false, 'live'])
  })

  it('treats a key-shaped host as no store’s where no preview domain is set', async () => {
    expect(await resolve(previewHost('a1'), {}, null)).toEqual({ kind: 'unknown' })
  })
})

describe('a preview has guests only (PREVIEW.md §5 step 5)', () => {
  it('never takes a shopper session there, though the same session signs in on the shop', async () => {
    const headers = { 'x-shop-session': session, cookie: `__Host-df_preview=${session}` }
    expect(found(await resolve('store-a1.shops.acme.example', headers)).context.caller).toMatchObject({ kind: 'shopper', customerId: t.customerA1 })
    expect(found(await resolve(previewHost('a1'), headers)).context.caller).toMatchObject({ kind: 'shopper', customerId: null })
    expect((await gql(previewHost('a1'), '{ account { id } }', headers)).data?.['account']).toBeNull()
    expect((await gql('store-a1.shops.acme.example', '{ account { id } }', headers)).data?.['account']).toEqual({ id: t.customerA1 })
  })

  it('refuses every way of signing in or out there, and still answers the guest surface', async () => {
    const refused = ['mutation { requestSignInCode(channel: EMAIL, to: "a@example.com") }', 'mutation { verifySignInCode(channel: EMAIL, to: "a@example.com", code: "123456") { sessionToken } }', 'mutation { signIn(email: "a@example.com", password: "long enough password") { sessionToken } }', 'mutation { signOut }']
    for (const source of refused) expect((await gql(previewHost('a1'), source, { 'x-shop-session': session })).code, source).toBe('NOT_IN_PREVIEW')
    expect((await db.sql`select 1 from customer_session where customer_id = ${t.customerA1} and ended_at is null`).length).toBe(1)
    expect((await gql(previewHost('a1'), '{ signInOptions { email } }')).code).toBeUndefined()
  })
})

describe('the retired partner preview address (0210)', () => {
  it('leaves no preview row, and the check refuses a new one', async () => {
    expect(await db.sql`select 1 from partner_domain where kind = 'preview'`).toEqual([])
    await expect(db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerB}, 'preview', '*.preview.bolt.example', 'waiting', 'CNAME', 'x')`).rejects.toThrow(/partner_domain_kind_check/)
  })
})
