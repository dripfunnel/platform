import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { paymentModeOf } from '#apis/shop/access'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { hashSessionId, newSessionId } from '#auth/session'
import { resolveShopper, type ShopResolution } from '#auth/shopCaller'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Cards #744 and #745: every store's live address is {slug}.<SHOP_DOMAIN> and its preview {slug}-preview.<SHOP_DOMAIN>
// (storefront PREVIEW.md §2 step 5, §5, §6); the partner shops address is retired (SAAS §3.5).

const shopDomain = 'shop.example'
let db: TestDatabase
let t: Tenants
const slugs: Record<'a1' | 'a2' | 'b1', string> = { a1: '', a2: '', b1: '' }
const publicKeys: Record<'a1' | 'a2' | 'b1', string> = { a1: '', a2: '', b1: '' }
let session = ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set pricing_currency = 'INR', country = 'IN', status = 'active' where id in (${t.storeA1}, ${t.storeA2}, ${t.storeB1})`
  await db.sql`update partner set state = 'live' where id in (${t.partnerA}, ${t.partnerB})`
  await db.sql`insert into custom_domain (store_id, host, status, expected_cname, ownership_token) values (${t.storeA2}, 'www.a2-shop.example', 'live', 'x', 'y')`
  for (const [k, id] of [['a1', t.storeA1], ['a2', t.storeA2], ['b1', t.storeB1]] as const) {
    const [row] = await db.sql<{ slug: string; public_store_key: string }[]>`select s.slug, f.public_store_key from store s join storefront f on f.store_id = s.id where s.id = ${id}`
    slugs[k] = row?.slug ?? ''
    publicKeys[k] = row?.public_store_key ?? ''
  }
  session = newSessionId()
  await db.sql`insert into customer_session (id_hash, store_id, customer_id, created_at, last_seen_at, expires_at)
    values (${await hashSessionId(session)}, ${t.storeA1}, ${t.customerA1}, now(), now(), now() + interval '1 day')`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const resolve = (host: string, headers: Record<string, string> = {}, domain: string | null = shopDomain) =>
  resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers }), host, domain)
const found = (r: ShopResolution) => {
  if (r.kind !== 'found') throw new Error(`no store: ${r.kind}`)
  return r.shopper
}
const liveHost = (k: keyof typeof slugs) => `${slugs[k]}.${shopDomain}`
const previewHost = (k: keyof typeof slugs) => `${slugs[k]}-preview.${shopDomain}`
const gql = async (host: string, source: string, headers: Record<string, string> = {}) => {
  const shopper = found(await resolve(host, headers))
  const contextValue: ShopContext = { sql: db.sql, shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.9', userAgent: null }, allowAttempt: async () => true, sessionToken: shopper.preview ? null : (headers['x-shop-session'] ?? null), allowNewCart: async () => true, now: () => new Date() }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

describe('store slugs (0354)', () => {
  it('gives every store, old and new, a slug, and a store made without one gets one from its code', async () => {
    const [made] = await db.sql<{ id: string; slug: string }[]>`insert into store (partner_id, name, code) values (${t.partnerB}, 'Fresh', 'fresh') returning id, slug`
    expect(made?.slug).toBe('fresh')
    expect((await db.sql<{ n: number }[]>`select count(*)::int as n from store where slug is null`)[0]?.n).toBe(0)
  })

  it('gives two stores with one code under different partners distinct slugs', async () => {
    const [x, y] = await db.sql<{ slug: string }[]>`insert into store (partner_id, name, code) values (${t.partnerA}, 'Twin', 'twin'), (${t.partnerB}, 'Twin', 'twin') returning slug`
    expect([x?.slug, y?.slug]).toEqual(['twin', 'twin-2'])
  })

  it('never makes a reserved or -preview slug, and refuses one a store inserts', async () => {
    const [shop] = await db.sql<{ slug: string }[]>`insert into store (partner_id, name, code) values (${t.partnerA}, 'Shop', 'shop') returning slug`
    const [pre] = await db.sql<{ slug: string }[]>`insert into store (partner_id, name, code) values (${t.partnerA}, 'Acme preview', 'acme-preview') returning slug`
    expect([shop?.slug, pre?.slug]).toEqual(['shop-store', 'acme-preview-store'])
    await expect(db.sql`update store set slug = 'bad-preview' where id = ${t.storeA1}`).rejects.toThrow(/store_slug_check/)
  })

  it('refuses a second store with a slug already taken, whatever its case', async () => {
    await expect(db.sql`update store set slug = ${slugs.a1.toUpperCase()} where id = ${t.storeA2}`).rejects.toThrow(/store_slug/)
  })
})

describe('finding the store on its live and preview hosts', () => {
  it('serves the store its slug names, live on {slug}. and in test mode on {slug}-preview.', async () => {
    const live = found(await resolve(liveHost('a1')))
    const preview = found(await resolve(previewHost('a1')))
    expect([live.context.storeId, live.preview, paymentModeOf(live)]).toEqual([t.storeA1, false, 'live'])
    expect([preview.context.storeId, preview.preview, paymentModeOf(preview)]).toEqual([t.storeA1, true, 'test'])
    expect(found(await resolve(previewHost('b1').toUpperCase())).context.storeId).toBe(t.storeB1)
    expect(found(await resolve(liveHost('b1'))).context.storeId).toBe(t.storeB1)
  })

  it('knows no store for an unknown slug, a nested label or a closed store or partner, whatever key comes with it', async () => {
    expect(await resolve(`nobody.${shopDomain}`)).toEqual({ kind: 'unknown' })
    expect(await resolve(`nobody.${shopDomain}`, { 'x-shop-key': publicKeys.a1 })).toEqual({ kind: 'unknown' })
    expect(await resolve(`nobody-preview.${shopDomain}`, { 'x-shop-key': publicKeys.a1 })).toEqual({ kind: 'unknown' })
    expect(await resolve(`x.${liveHost('a1')}`)).toEqual({ kind: 'unknown' })
    expect(await resolve(`x.${previewHost('a1')}`)).toEqual({ kind: 'unknown' })
    expect(await resolve(shopDomain, { 'x-shop-key': publicKeys.a1 })).toEqual({ kind: 'found', shopper: expect.objectContaining({ preview: false }) })
    await db.sql`update partner set state = 'closed' where id = ${t.partnerB}`
    expect(await resolve(liveHost('b1'))).toEqual({ kind: 'unknown' })
    expect(await resolve(previewHost('b1'))).toEqual({ kind: 'unknown' })
    await db.sql`update partner set state = 'live' where id = ${t.partnerB}`
    await db.sql`update store set status = 'closed' where id = ${t.storeB1}`
    expect(await resolve(liveHost('b1'))).toEqual({ kind: 'unknown' })
    expect(await resolve(previewHost('b1'))).toEqual({ kind: 'unknown' })
    await db.sql`update store set status = 'active' where id = ${t.storeB1}`
    expect(found(await resolve(previewHost('b1'))).context.storeId).toBe(t.storeB1)
  })

  it('refuses store X’s key on store Y’s hosts, and takes Y’s own', async () => {
    for (const host of [previewHost('a2'), liveHost('a2')]) {
      expect(await resolve(host, { 'x-shop-key': publicKeys.a1 })).toEqual({ kind: 'key-mismatch' })
      expect(await resolve(host, { 'x-shop-key': 'pk_' + '0'.repeat(32) })).toEqual({ kind: 'key-mismatch' })
      expect(found(await resolve(host, { 'x-shop-key': publicKeys.a2 })).context.storeId).toBe(t.storeA2)
    }
  })

  it('no longer reaches a store at {code}.shops.<partner domain> or {code}.preview.<partner domain>, and keeps a live domain in live mode', async () => {
    expect(await resolve('store-a1.preview.acme.example')).toEqual({ kind: 'unknown' })
    expect(await resolve('store-a1.shops.acme.example')).toEqual({ kind: 'unknown' })
    const own = found(await resolve('www.a2-shop.example'))
    expect([own.context.storeId, own.preview, paymentModeOf(own)]).toEqual([t.storeA2, false, 'live'])
  })

  it('treats a slug-shaped host as no store’s where no shop domain is set', async () => {
    expect(await resolve(previewHost('a1'), {}, null)).toEqual({ kind: 'unknown' })
    expect(await resolve(liveHost('a1'), {}, null)).toEqual({ kind: 'unknown' })
  })
})

describe('a preview has guests only (PREVIEW.md §5 step 5)', () => {
  it('never takes a shopper session there, though the same session signs in on the shop', async () => {
    const headers = { 'x-shop-session': session, cookie: `__Host-df_preview=${session}` }
    expect(found(await resolve(liveHost('a1'), headers)).context.caller).toMatchObject({ kind: 'shopper', customerId: t.customerA1 })
    expect(found(await resolve(previewHost('a1'), headers)).context.caller).toMatchObject({ kind: 'shopper', customerId: null })
    expect((await gql(previewHost('a1'), '{ account { id } }', headers)).data?.['account']).toBeNull()
    expect((await gql(liveHost('a1'), '{ account { id } }', headers)).data?.['account']).toEqual({ id: t.customerA1 })
  })

  it('refuses every way of signing in or out there, and still answers the guest surface', async () => {
    const refused = ['mutation { requestSignInCode(channel: EMAIL, to: "a@example.com") }', 'mutation { verifySignInCode(channel: EMAIL, to: "a@example.com", code: "123456") { sessionToken } }', 'mutation { signIn(email: "a@example.com", password: "long enough password") { sessionToken } }', 'mutation { signOut }']
    for (const source of refused) expect((await gql(previewHost('a1'), source, { 'x-shop-session': session })).code, source).toBe('NOT_IN_PREVIEW')
    expect((await db.sql`select 1 from customer_session where customer_id = ${t.customerA1} and ended_at is null`).length).toBe(1)
    expect((await gql(previewHost('a1'), '{ signInOptions { email } }')).code).toBeUndefined()
  })
})

describe('the retired partner addresses (0232, 0355)', () => {
  it('leaves no preview or shops row, and the check refuses a new one', async () => {
    expect(await db.sql`select 1 from partner_domain where kind in ('preview', 'shops')`).toEqual([])
    await expect(db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerB}, 'shops', '*.shops.bolt.example', 'waiting', 'CNAME', 'x')`).rejects.toThrow(/partner_domain_kind_check/)
    await expect(db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerB}, 'preview', '*.preview.bolt.example', 'waiting', 'CNAME', 'x')`).rejects.toThrow(/partner_domain_kind_check/)
  })
})
