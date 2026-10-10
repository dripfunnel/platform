import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { handleAssets } from '#apis/store/assets'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #323 (SAPI 22), part 1: what a download, a service and a gift card hold (CatEditor; CATALOG-DESIGN T14), the
// merchant side's only, a supplier's product being a physical one (decided on #323), and the key pool nobody reads back.

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-10T09:00:00Z')
type Who = 'owner' | 'staff' | 'supplier' | 'bOwner'
const people: Record<Who, string> = { owner: '', staff: '', supplier: '', bOwner: '' }
const cookies: Record<Who, string> = { owner: '', staff: '', supplier: '', bOwner: '' }

const user = async (partnerId: string, email: string) =>
  (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, 'P', 'active') returning id`)[0]?.id ?? ''

const subscribe = async (storeId: string, partnerId: string) => {
  const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${`Plan ${storeId}`}, 'live') returning id`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${partnerId}, 1, 'products', 50)`
  await db.sql`update store set plan_id = ${plan?.id ?? ''}, pricing_currency = 'INR', country = 'IN' where id = ${storeId}`
  await db.sql`delete from store_subscription where store_id = ${storeId}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${storeId}, ${partnerId}, ${plan?.id ?? ''}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})`
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update seller set access_level = 'vendor-catalogue' where id = ${t.sellerA1First}`
  people.owner = await user(t.partnerA, 'owner@a.example')
  people.staff = await user(t.partnerA, 'staff@a.example')
  people.supplier = await user(t.partnerA, 'anand@a.example')
  people.bOwner = await user(t.partnerB, 'owner@b.example')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.staff}, ${t.storeA1}, 'staff', 'active'), (${people.bOwner}, ${t.storeB1}, 'owner', 'active')`
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${people.supplier}, ${t.storeA1}, ${t.sellerA1First}, 'supplier-admin', 'active')`
  await subscribe(t.storeA1, t.partnerA)
  await subscribe(t.storeB1, t.partnerB)
  for (const who of Object.keys(cookies) as Who[]) {
    cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: who === 'bOwner' ? t.partnerB : t.partnerA }, now))
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const contextFor = async (who: Who, as: { support?: 'read' } = {}): Promise<StoreContext> => {
  const partnerId = who === 'bOwner' ? t.partnerB : t.partnerA
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: who === 'bOwner' ? t.storeB1 : t.storeA1, ...(who === 'supplier' ? { [supplierHeader]: t.sellerA1First } : {}) }
  const resolved = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, now, activityLog, facts)
  // Acting through a read-only support session (ACCESS §8), as store-customers.test.ts does.
  const standing = as.support && resolved.kind === 'acting'
    ? { ...resolved, caller: { ...resolved.caller, context: { ...resolved.caller.context, caller: { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: as.support } } } }
    : resolved
  return { standing, partnerId, sql: db.sql, activity: activityLog, facts, now: () => now }
}

const gql = async (source: string, who: Who, variables: Record<string, unknown> = {}, as: { support?: 'read' } = {}) => {
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue: await contextFor(who, as), variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

const bucket = new Map<string, Uint8Array>()
const r2 = {
  put: async (key: string, value: Uint8Array) => void bucket.set(key, value),
  get: async (key: string) => {
    const value = bucket.get(key)
    return value ? { body: new Response(value.slice()).body as ReadableStream } : null
  },
}
const pdf = new TextEncoder().encode('%PDF-1.7 a pattern pack')
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0x80, 0, 0, 1, 0xe0, 8, 6, 0, 0, 0])
const upload = async (who: Who, body: Uint8Array<ArrayBuffer>, kind: string | null = 'download') => {
  const response = await handleAssets(new Request(`https://store.example/api/assets${kind ? `?kind=${kind}` : ''}`, { method: 'POST', body }), await contextFor(who), r2)
  return { status: response.status, ...((await response.json()) as { code?: string; asset?: { id: string; kind: string; mime: string } }) }
}

const product = async (who: Who, productType: string) => {
  const result = await gql('mutation S($input: ProductInput!) { saveProduct(input: $input) { id } }', who, {
    input: { name: `A ${productType}`, productType, options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '90000' }], trackStock: true }] },
  })
  return { id: (result.data?.['saveProduct'] as { id: string } | undefined)?.id ?? '', code: result.code }
}

const kindFields = 'productType revision download { mode file { id mime } limit days keysLeft keysSold } service { duration location } giftCard { expiryMonths shortestMonths }'
type Kind = { productType: string; revision: number; download: { mode: string; file: { id: string; mime: string } | null; limit: number; days: number; keysLeft: number; keysSold: number } | null; service: { duration: string | null; location: string | null } | null; giftCard: { expiryMonths: number | null; shortestMonths: number } | null }
const kindOf = async (who: Who, productId: string) => {
  const result = await gql(`query K($id: ID!) { productKind(productId: $id) { ${kindFields} } }`, who, { id: productId })
  return { kind: result.data?.['productKind'] as Kind | null | undefined, code: result.code }
}
const saveKind = async (who: Who, productId: string, revision: number, input: Record<string, unknown>, as: { support?: 'read' } = {}) => {
  const result = await gql(`mutation S($id: ID!, $revision: Int!, $input: ProductKindInput!) { saveProductKind(productId: $id, revision: $revision, input: $input) { ${kindFields} } }`, who, { id: productId, revision, input }, as)
  return { kind: result.data?.['saveProductKind'] as Kind | undefined, code: result.code }
}
const addKeys = async (who: Who, productId: string, keys: string[]) => {
  const result = await gql(`mutation A($id: ID!, $keys: [String!]!) { addLicenceKeys(productId: $id, keys: $keys) { ${kindFields} } }`, who, { id: productId, keys })
  return { kind: result.data?.['addLicenceKeys'] as Kind | undefined, code: result.code }
}
const merchantOf = (storeId: string, seller: string | null = null): TenantContext => ({
  caller: { kind: 'person', userId: people.owner, sessionId: 's' },
  partnerId: t.partnerA,
  storeId,
  sellerScope: seller ? { kind: 'seller', sellerId: seller } : { kind: 'all' },
  subscription: 'active',
})

describe('a download', () => {
  let id = ''
  let revision = 0

  it('is counted in no stock, and takes a private file the merchant uploaded for it', async () => {
    id = (await product('owner', 'digital')).id
    expect(await db.sql`select track_stock from product_version where product_id = ${id}`).toEqual([{ track_stock: false }])
    const file = await upload('owner', pdf)
    expect(file).toMatchObject({ status: 200, asset: { kind: 'file', mime: 'application/pdf' } })
    const before = (await kindOf('owner', id)).kind
    expect(before).toMatchObject({ productType: 'digital', download: { mode: 'file', file: null, limit: 5, days: 30, keysLeft: 0 }, service: null, giftCard: null })
    const saved = await saveKind('owner', id, before?.revision ?? 0, { download: { mode: 'file', fileId: file.asset?.id, limit: 3, days: 7 } })
    expect(saved.kind?.download).toMatchObject({ mode: 'file', file: { id: file.asset?.id, mime: 'application/pdf' }, limit: 3, days: 7 })
    revision = saved.kind?.revision ?? 0
    expect((await db.sql<{ reason: string }[]>`select reason from activity_log where action = 'product.updated' and target_id = ${id}`).map((r) => r.reason)).toContain('kind')
  })

  it('refuses a photo, another store’s file, a link rule off the list, another kind’s card and a stale save', async () => {
    const photo = await upload('owner', png, null)
    expect((await saveKind('owner', id, revision, { download: { mode: 'file', fileId: photo.asset?.id, limit: 3, days: 7 } })).code).toBe('FILE_REFUSED')
    const theirs = await upload('bOwner', pdf)
    expect((await saveKind('owner', id, revision, { download: { mode: 'file', fileId: theirs.asset?.id, limit: 3, days: 7 } })).code).toBe('FILE_REFUSED')
    expect((await saveKind('owner', id, revision, { download: { mode: 'file', fileId: theirs.asset?.id, limit: 4, days: 7 } })).code).toBe('INVALID_INPUT')
    expect((await saveKind('owner', id, revision, { download: { mode: 'keys', fileId: theirs.asset?.id, limit: 3, days: 7 } })).code).toBe('INVALID_INPUT')
    expect((await saveKind('owner', id, revision, { service: { duration: '1 hour' } })).code).toBe('WRONG_KIND')
    expect((await saveKind('owner', id, revision, { service: { duration: '1 hour' }, giftCard: {} })).code).toBe('INVALID_INPUT')
    expect((await saveKind('owner', id, revision - 1, { download: { mode: 'keys', limit: 3, days: 7 } })).code).toBe('STALE_REVISION')
    // A script is never stored as a download.
    expect(await upload('owner', new TextEncoder().encode('#!/bin/sh\nrm -rf /'))).toMatchObject({ status: 415, code: 'UNSUPPORTED_TYPE' })
  })

  it('switches to a key pool whose keys are counted, skipped when repeated, and never read back', async () => {
    const saved = await saveKind('owner', id, revision, { download: { mode: 'keys', limit: 3, days: 7 } })
    expect(saved.kind?.download).toMatchObject({ mode: 'keys', file: null, keysLeft: 0 })
    revision = saved.kind?.revision ?? 0
    expect((await addKeys('owner', id, ['AAAA-1111', ' BBBB-2222 ', '', 'AAAA-1111'])).kind?.download).toMatchObject({ keysLeft: 2, keysSold: 0 })
    expect((await addKeys('owner', id, ['BBBB-2222', 'CCCC-3333'])).kind?.download?.keysLeft).toBe(3)
    expect((await addKeys('owner', id, ['x'.repeat(201)])).code).toBe('INVALID_INPUT')
    expect((await addKeys('owner', id, [])).code).toBe('INVALID_INPUT')
    expect(await db.sql`select reason from activity_log where action = 'product.licence_keys_added' and target_id = ${id} order by reason`).toEqual([{ reason: '1' }, { reason: '2' }])
    await expect(withScope(db.sql, merchantOf(t.storeA1), (tx) => tx`select key from licence_key`)).rejects.toThrow(/permission denied/)
    // Only a key-pool download takes keys, written through the engine or not at all.
    const shirt = (await product('owner', 'physical')).id
    expect((await addKeys('owner', shirt, ['DDDD'])).code).toBe('WRONG_KIND')
    await expect(withScope(db.sql, merchantOf(t.storeA1), (tx) => tx`insert into licence_key (store_id, product_id, key) values (${t.storeA1}, ${shirt}, 'EEEE')`)).rejects.toThrow(/row-level security/)
  })

  it('is the merchant side’s: Staff reads it, a supplier and another store reach nothing, a read-only session changes nothing', async () => {
    expect((await kindOf('staff', id)).kind?.download?.keysLeft).toBe(3)
    expect((await saveKind('staff', id, revision, { download: { mode: 'keys', limit: 5, days: 7 } })).code).toBe('FORBIDDEN')
    expect((await addKeys('staff', id, ['FFFF'])).code).toBe('FORBIDDEN')
    expect((await kindOf('supplier', id)).code).toBe('FORBIDDEN')
    expect((await addKeys('supplier', id, ['FFFF'])).code).toBe('FORBIDDEN')
    expect(await upload('supplier', pdf)).toMatchObject({ status: 403, code: 'FORBIDDEN' })
    expect((await kindOf('bOwner', id)).kind).toBeNull()
    expect((await saveKind('bOwner', id, revision, { download: { mode: 'keys', limit: 5, days: 7 } })).code).toBe('NOT_FOUND')
    expect((await addKeys('bOwner', id, ['FFFF'])).code).toBe('NOT_FOUND')
    expect((await saveKind('owner', id, revision, { download: { mode: 'keys', limit: 5, days: 7 } }, { support: 'read' })).code).toBe('READ_ONLY')
    // No branch reaches the pool from another store, a supplier, a partner or staff, not even its count.
    expect(await withScope(db.sql, merchantOf(t.storeA1), (tx) => tx`select count(*)::int as n from licence_key`)).toEqual([{ n: 3 }])
    expect(await withScope(db.sql, merchantOf(t.storeA2), (tx) => tx`select count(*)::int as n from licence_key`)).toEqual([{ n: 0 }])
    await expect(withScope(db.sql, merchantOf(t.storeA1, t.sellerA1First), (tx) => tx`select id from licence_key`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, { caller: { kind: 'partner-user', partnerUserId: crypto.randomUUID() }, partnerId: t.partnerA }, (tx) => tx`select id from licence_key`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, { caller: { kind: 'staff', staffId: crypto.randomUUID() } }, (tx) => tx`select id from licence_key`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, { ...merchantOf(t.storeA1), caller: { kind: 'shopper', customerId: null } }, (tx) => tx`select id from licence_key`)).rejects.toThrow(/permission denied/)
  })
})

describe('a supplier', () => {
  it('sells only physical items: a download, a service or a gift card of its own is refused, by the engine and the table', async () => {
    for (const kind of ['digital', 'service', 'gift_card']) expect((await product('supplier', kind)).code).toBe('SUPPLIER_FIELD')
    expect((await product('supplier', 'physical')).code).toBeUndefined()
    await expect(db.sql`insert into product (store_id, seller_id, name, slug, product_type) values (${t.storeA1}, ${t.sellerA1First}, 'E-book', 'e-book', 'digital')`).rejects.toThrow(/product_supplier_physical/)
  })
})

describe('a service', () => {
  it('keeps an optional length and place, each within its limit, and no stock', async () => {
    const { id } = await product('owner', 'service')
    const kind = (await kindOf('owner', id)).kind
    expect(kind).toMatchObject({ service: { duration: null, location: null }, download: null })
    const saved = await saveKind('owner', id, kind?.revision ?? 0, { service: { duration: ' 2 hours ', location: 'Our Jaipur studio, MI Road' } })
    expect(saved.kind?.service).toEqual({ duration: '2 hours', location: 'Our Jaipur studio, MI Road' })
    expect((await saveKind('owner', id, saved.kind?.revision ?? 0, { service: { duration: 'x'.repeat(61) } })).code).toBe('INVALID_INPUT')
    expect((await saveKind('owner', id, saved.kind?.revision ?? 0, { service: {} })).kind?.service).toEqual({ duration: null, location: null })
    expect(await db.sql`select track_stock from product_version where product_id = ${id}`).toEqual([{ track_stock: false }])
  })
})

describe('a gift card', () => {
  it('expires no sooner than its country allows: a year in India, five in the US, or never', async () => {
    const { id } = await product('owner', 'gift_card')
    const kind = (await kindOf('owner', id)).kind
    expect(kind?.giftCard).toEqual({ expiryMonths: null, shortestMonths: 12 })
    const india = await saveKind('owner', id, kind?.revision ?? 0, { giftCard: { expiryMonths: 12 } })
    expect(india.kind?.giftCard).toEqual({ expiryMonths: 12, shortestMonths: 12 })
    expect((await saveKind('owner', id, india.kind?.revision ?? 0, { giftCard: { expiryMonths: 121 } })).code).toBe('INVALID_INPUT')
    await db.sql`update store set country = 'US' where id = ${t.storeA1}`
    try {
      expect((await kindOf('owner', id)).kind?.giftCard?.shortestMonths).toBe(60)
      expect((await saveKind('owner', id, india.kind?.revision ?? 0, { giftCard: { expiryMonths: 24 } })).code).toBe('EXPIRY_TOO_SHORT')
      const us = await saveKind('owner', id, india.kind?.revision ?? 0, { giftCard: { expiryMonths: 60 } })
      expect(us.kind?.giftCard?.expiryMonths).toBe(60)
      expect((await saveKind('owner', id, us.kind?.revision ?? 0, { giftCard: { expiryMonths: null } })).kind?.giftCard?.expiryMonths).toBeNull()
    } finally {
      await db.sql`update store set country = 'IN' where id = ${t.storeA1}`
    }
  })
})
