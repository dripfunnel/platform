import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { factsOf } from '#auth/activity'
import { isAssigned } from '#auth/assignment'
import type { StaffMember, StaffRole } from '#auth/staff'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { catalogImportDeliverer, importPhotosDeliverer, sampleCollectionPhotoDeliverer } from '#jobs/queues/deliverers/catalogImport'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createStoreCategoryAdminService } from '#saas/storeCategories/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Sample catalogs (DATA-MODEL §7.2, CATALOG-DESIGN A4): staff add 1–50 products in 1–10 collections per category,
// photos copied once into R2; a store's merchant side adds it through the ordinary import, once, before any order.

let db: TestDatabase
let t: Tenants
const now = new Date('2026-11-16T06:00:00Z')
const staff = new Map<StaffRole, StaffMember>()
type Who = 'owner' | 'supplier' | 'other' | 'bOwner'
const cookies = {} as Record<Who, string>
const ids = { footwear: '', watches: '' }

// Photos come from addresses the test answers itself; the bucket is R2's stand-in.
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0x80, 0, 0, 1, 0xe0, 8, 6, 0, 0, 0])
const bucket = new Map<string, Uint8Array>()
const r2 = {
  put: async (key: string, value: Uint8Array) => void bucket.set(key, value),
  get: async (key: string) => {
    const value = bucket.get(key)
    return value ? { body: new Response(value.slice()).body as ReadableStream } : null
  },
}
const lookup = { resolve: async (_host: string, type: string) => (type === 'A' ? ['93.184.216.34'] : []) }
const fetched: string[] = []
const fakeFetch = (async (input: RequestInfo | URL) => {
  const url = String(input)
  fetched.push(url)
  return /[/]ok-/.test(url) ? new Response(new Uint8Array([...png, ...new TextEncoder().encode(url)]), { headers: { 'content-type': 'image/png' } }) : new Response('no', { status: 404 })
}) as typeof fetch

const request = new Request('https://admin.dripfunnel.ai/api', { headers: { 'cf-ray': 'ray-test' } })
const admin = async <T = Record<string, unknown>>(source: string, role: StaffRole, variables: Record<string, unknown> = {}) => {
  const member = staff.get(role) ?? null
  const contextValue: AdminContext = {
    staff: member,
    isAssigned: (id, target) => isAssigned(db.sql, id, target),
    staffActivity: null,
    partners: null,
    stores: null,
    customers: null,
    staffSessions: null,
    provisioning: null,
    dashboard: null,
    staffMembers: null,
    storeCategories: member ? createStoreCategoryAdminService({ sql: db.sql, staff: member, facts: factsOf(request), activity: activityLog, now: () => now, photos: { assets: r2, lookup, fetchImpl: fakeFetch } }) : null,
  }
  const result = await graphql({ schema: adminSchema as GraphQLSchema, source, variableValues: variables, contextValue })
  return { data: result.data as T | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

const shop = async (source: string, who: Who, variables: Record<string, unknown> = {}, as: { support?: 'read' } = {}) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const storeId = who === 'other' ? t.storeA2 : who === 'bOwner' ? t.storeB1 : t.storeA1
  const partnerId = who === 'bOwner' ? t.partnerB : t.partnerA
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeId, ...(who === 'supplier' ? { [supplierHeader]: t.sellerA1First } : {}) }
  const resolved = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, now, activityLog, facts)
  const standing =
    as.support && resolved.kind === 'acting'
      ? {
          ...resolved,
          caller: {
            ...resolved.caller,
            context: { ...resolved.caller.context, caller: { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: as.support } },
            support: { sessionId: crypto.randomUUID(), agent: { id: crypto.randomUUID(), name: 'Priya' }, partnerName: 'Partner A', actingAs: 'Owner', access: as.support, expiresAt: new Date(now.getTime() + 3_600_000), extendable: true, writeRequest: null },
          },
        }
      : resolved
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: activityLog, facts, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

const relay = async () => {
  for (let round = 0; round < 20; round++) {
    const counts = await relayDue(
      db.sql,
      { 'import.catalog': catalogImportDeliverer(db.sql, null, null, () => now), 'import.photos': importPhotosDeliverer(db.sql, r2, lookup, { now: () => now, fetchImpl: fakeFetch }), 'import.collection_photo': sampleCollectionPhotoDeliverer(db.sql, r2, () => now) },
      { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) },
    )
    if (Object.values(counts).every((n) => n === 0)) return
  }
}

const subscribe = async (storeId: string, partnerId: string, currency: string) => {
  const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${`Plan ${storeId.slice(0, 6)}`}, 'live') returning id`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${partnerId}, 1, 'products', 50)`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled) values (${plan?.id ?? ''}, ${partnerId}, 1, 'import_spreadsheet', true)`
  await db.sql`update store set plan_id = ${plan?.id ?? ''}, pricing_currency = ${currency} where id = ${storeId}`
  await db.sql`delete from store_subscription where store_id = ${storeId}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${storeId}, ${partnerId}, ${plan?.id ?? ''}, 1, 'active', 'month', ${currency}, 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})`
}

/** Six products, two collections (the first product in both), in INR, each with a photo. */
const sampleCsv = (o: { products?: number; collections?: string[]; noSku?: boolean; photo?: (n: number) => string } = {}) => {
  const names = o.collections ?? ['Sneakers', 'Sandals']
  const rows = Array.from({ length: o.products ?? 6 }, (_, i) => {
    const n = i + 1
    const collection = n === 1 ? names.join(';') : (names[i % names.length] ?? '')
    return `shoe-${n},Shoe ${n},yes,${o.noSku && n === 2 ? '' : `SH-${n}`},900,${o.photo ? o.photo(n) : `https://cdn.example/ok-${n}.png`},${collection}`
  })
  return ['handle,name,visible,sku,price,image,collection', ...rows].join('\n')
}

const save = `mutation($c: ID!, $r: String!) { addDefaultStoreCategorySample(categoryId: $c, reason: $r) {
  category { sample { currency products collections { name products } photos } } problems { line column code message } } }`
type Saved = { addDefaultStoreCategorySample: { category: { sample: { currency: string; products: number; collections: { name: string; products: number }[]; photos: number } | null } | null; problems: { line: number; column: string | null; code: string }[] } }
const add = 'mutation { addSampleCatalog }'
const jobsOf = async (storeId: string) => db.sql<{ id: string; state: string }[]>`select id, state from catalog_import where store_id = ${storeId} and sample_category_id is not null`

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  for (const role of ['staff-super-admin', 'staff-partner-manager'] as const) {
    const [row] = await db.sql<{ id: string }[]>`insert into staff_user (sso_subject, email, name, role_key, status) values (${role}, ${`${role}@dripfunnel.example`}, ${role}, ${role}, 'active') returning id`
    staff.set(role, { id: row?.id ?? '', email: `${role}@dripfunnel.example`, name: role, role })
  }
  const person = async (email: string, partnerId: string, storeId: string, role: string, seller: string | null = null) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${email.split('@')[0] ?? ''}, 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${u?.id ?? ''}, ${storeId}, ${seller}, ${role}, 'active')`
    return withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId }, new Date()))
  }
  await db.sql`update seller set access_level = 'vendor-catalogue' where id = ${t.sellerA1First}`
  cookies.owner = await person('owner@a1.example', t.partnerA, t.storeA1, 'owner')
  cookies.supplier = await person('anand@a1.example', t.partnerA, t.storeA1, 'supplier-admin', t.sellerA1First)
  cookies.other = await person('owner@a2.example', t.partnerA, t.storeA2, 'owner')
  cookies.bOwner = await person('owner@b1.example', t.partnerB, t.storeB1, 'owner')
  await subscribe(t.storeA1, t.partnerA, 'AED')
  await subscribe(t.storeA2, t.partnerA, 'INR')
  await subscribe(t.storeB1, t.partnerB, 'INR')
  await db.sql`insert into exchange_rate (currency, per_euro, source, published_on, fetched_at) values ('INR', '90', 'ecb', '2026-11-14', now()), ('AED', '4', 'ecb', '2026-11-14', now())
    on conflict (currency) do update set per_euro = excluded.per_euro`
  const keys = Object.fromEntries((await db.sql<{ id: string; key: string }[]>`select id, key from store_category`).map((r) => [r.key, r.id]))
  ids.footwear = keys['footwear'] ?? ''
  ids.watches = keys['watches'] ?? ''
  await db.sql`update store set category_id = ${ids.footwear} where id in (${t.storeA1}, ${t.storeA2})`
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('a category’s sample, as staff upload it', () => {
  // The built-in data is seeded (0401); each case writes the file it checks in its place.
  const run = async (file: string, role: StaffRole = 'staff-super-admin', category = ids.footwear) => {
    await db.sql`insert into store_category_default_sample (category_id, file, currency) values (${category}, ${file}, 'INR')
      on conflict (category_id) do update set file = excluded.file, currency = excluded.currency`
    return admin<Saved>(save, role, { c: category, r: 'Launch samples' })
  }
  const codes = async (file: string) => (await run(file)).data?.addDefaultStoreCategorySample.problems.map((p) => p.code)

  it('is Super admin only', async () => {
    expect((await run(sampleCsv(), 'staff-partner-manager')).code).toBe('FORBIDDEN')
  })

  it('refuses 51 products, 11 collections, a missing SKU and a photo that won’t download, keeping nothing', async () => {
    expect(await codes(sampleCsv({ products: 51 }))).toEqual(['PRODUCT_COUNT'])
    expect(await codes(sampleCsv({ collections: Array.from({ length: 11 }, (_, i) => `C${i}`), products: 11 }))).toEqual(['COLLECTION_COUNT'])
    expect(await codes(sampleCsv({ noSku: true }))).toContain('SKU_REQUIRED')
    const missing = (await run(sampleCsv({ photo: (n) => (n === 4 ? 'https://cdn.example/missing.png' : `https://cdn.example/ok-${n}.png`) }))).data?.addDefaultStoreCategorySample.problems
    expect(missing).toEqual([expect.objectContaining({ line: 5, column: 'image', code: 'PHOTO_UNAVAILABLE' })])
    expect(await db.sql`select 1 from store_category_sample`).toHaveLength(0)
  })

  it('saves six products and two collections, every photo copied once into R2, with the reason logged', async () => {
    bucket.clear()
    fetched.length = 0
    const saved = (await run(sampleCsv())).data?.addDefaultStoreCategorySample
    expect(saved?.problems).toEqual([])
    expect(saved?.category?.sample).toEqual({ currency: 'INR', products: 6, collections: [{ name: 'Sneakers', products: 3 }, { name: 'Sandals', products: 4 }], photos: 6 })
    expect([...bucket.keys()].every((k) => k.startsWith(`platform/store-category-samples/${ids.footwear}/`))).toBe(true)
    expect(bucket.size).toBe(6)
    expect(fetched).toHaveLength(6)
    const [entry] = await db.sql<{ reason: string }[]>`select reason from activity_log where action = 'store_category.sample_saved' and target_id = ${ids.footwear}`
    expect(entry?.reason).toBe('Launch samples')
  })
})

describe('adding the sample to a store', () => {
  it('says which categories have one', async () => {
    const choice = (await shop('{ shopCategory { current { key hasSample } options { key hasSample } } }', 'owner')).data?.['shopCategory'] as { current: { hasSample: boolean }; options: { key: string; hasSample: boolean }[] }
    expect(choice.current.hasSample).toBe(true)
    expect(choice.options.filter((o) => o.hasSample).map((o) => o.key)).toEqual(['footwear'])
  })

  it('imports straight away, with no review: prices converted, photos read from R2, then both collections', async () => {
    fetched.length = 0
    const started = await shop(add, 'owner')
    expect(started.code).toBeUndefined()
    const jobId = started.data?.['addSampleCatalog'] as string
    await relay()
    const job = (await shop('query($id: ID!) { catalogImport(id: $id) { state ready conversion { from to } } }', 'owner', { id: jobId })).data?.['catalogImport']
    expect(job).toMatchObject({ state: 'done', ready: 6 })
    expect((await shop('mutation($id: ID!) { confirmCatalogImport(id: $id, matching: skip) }', 'owner', { id: jobId })).code).toBe('NOT_READY')
    await relay()

    expect(await db.sql`select state from catalog_import where id = ${jobId}`).toEqual([{ state: 'done' }])
    const products = await db.sql<{ name: string; visibility: string; currency: string; amount: string; photos: number }[]>`
      select p.name, p.visibility, trim(vp.currency) as currency, vp.amount::text as amount, (select count(*)::int from product_photo ph where ph.product_id = p.id) as photos
      from product p join product_version v on v.product_id = p.id join version_price vp on vp.version_id = v.id
      where p.store_id = ${t.storeA1} and p.deleted_at is null order by p.name`
    expect(products).toHaveLength(6)
    expect(products.every((p) => p.visibility === 'visible' && p.currency === 'AED' && p.photos === 1)).toBe(true)
    // 900 INR at 90 per euro is 10 euros, at 4 per euro 40 AED.
    expect(Number(products[0]?.amount)).toBeGreaterThanOrEqual(3900)
    expect(Number(products[0]?.amount)).toBeLessThanOrEqual(4100)
    expect(fetched).toEqual([])

    const collections = await db.sql<{ name: string; visibility: string; products: number }[]>`
      select c.name, c.visibility, (select count(*)::int from collection_product cp where cp.collection_id = c.id) as products
      from collection c where c.store_id = ${t.storeA1} and c.deleted_at is null order by c.name`
    expect(collections).toEqual([{ name: 'Sandals', visibility: 'visible', products: 4 }, { name: 'Sneakers', visibility: 'visible', products: 3 }])
    expect((await db.sql`select sample_catalog_added_at from store where id = ${t.storeA1} and sample_catalog_added_at is not null`).length).toBe(1)
    expect((await db.sql`select 1 from activity_log where action = 'catalog.sample_added' and store_id = ${t.storeA1}`).length).toBe(1)
  })

  it('never twice, even once the job is gone', async () => {
    await db.sql`delete from catalog_import where store_id = ${t.storeA1}`
    expect((await shop(add, 'owner')).code).toBe('ALREADY_ADDED')
  })

  it('makes one job of a double click', async () => {
    const both = await Promise.all([shop(add, 'other'), shop(add, 'other')])
    expect(both.map((r) => r.code ?? 'ok').sort()).toEqual(['ALREADY_ADDED', 'ok'])
    expect(await jobsOf(t.storeA2)).toHaveLength(1)
  })

  it('is refused with no category, no sample, or an order', async () => {
    expect((await shop(add, 'bOwner')).code).toBe('NO_CATEGORY')
    await db.sql`update store set category_id = ${ids.watches} where id = ${t.storeB1}`
    expect((await shop(add, 'bOwner')).code).toBe('NO_SAMPLE')
    await db.sql`update store set category_id = ${ids.footwear} where id = ${t.storeB1}`
    await db.sql`insert into "order" (store_id, state, payment_state, fulfilment_state, currency, number, placed_at, subtotal_amount, shipping_amount, tax_amount, total_amount)
      values (${t.storeB1}, 'placed', 'paid', 'unfulfilled', 'INR', 'B-1', ${now}, 100, 0, 0, 100)`
    expect((await shop(add, 'bOwner')).code).toBe('HAS_ORDERS')
    expect(await jobsOf(t.storeB1)).toHaveLength(0)
  })

  it('is never a supplier’s or a read-only support session’s (isolation matrix)', async () => {
    await db.sql`delete from catalog_import where store_id = ${t.storeA2}`
    expect((await shop(add, 'supplier')).code).toBe('FORBIDDEN')
    expect((await shop(add, 'other', {}, { support: 'read' })).code).toBeDefined()
    expect(await jobsOf(t.storeA2)).toHaveLength(0)
  })

  it('reads R2 for a sample job only: a merchant’s own file naming the same address is fetched from it', async () => {
    fetched.length = 0
    const file = 'handle,name,sku,price,image\nmine,Mine,MINE-1,100,https://cdn.example/ok-1.png\n'
    const started = await shop('mutation($f: String!) { startCatalogImport(file: $f) }', 'other', { f: file })
    await relay()
    await shop('mutation($id: ID!) { confirmCatalogImport(id: $id, matching: skip) }', 'other', { id: started.data?.['startCatalogImport'] })
    await relay()
    expect(fetched).toEqual(['https://cdn.example/ok-1.png'])
  })
})

describe('the sample editor', () => {
  const detailQuery = `query($c: ID!) { storeCategorySample(categoryId: $c) { currency products { handle name sku price stock visible photos { ref previewUrl } collections } collections { name products } } }`
  type Detail = { currency: string; products: { handle: string; name: string; sku: string; price: string; stock: number | null; visible: boolean; photos: { ref: string; previewUrl: string | null }[]; collections: string[] }[]; collections: { name: string; products: number }[] }
  const saveItems = `mutation($c: ID!, $i: StoreCategorySampleInput!, $r: String!) { saveStoreCategorySampleItems(categoryId: $c, input: $i, reason: $r) {
    category { sample { products collections { name products } } } problems { line column code message } } }`
  type SavedItems = { saveStoreCategorySampleItems: { category: { sample: { products: number; collections: { name: string; products: number }[] } } | null; problems: { code: string; line: number }[] } }
  const service = (role: StaffRole) => createStoreCategoryAdminService({ sql: db.sql, staff: staff.get(role) as StaffMember, facts: factsOf(request), activity: activityLog, now: () => now, photos: { assets: r2, lookup, fetchImpl: fakeFetch } })
  const detail = async () => (await admin<{ storeCategorySample: Detail }>(detailQuery, 'staff-partner-manager', { c: ids.footwear })).data?.storeCategorySample
  const inputOf = (d: Detail) => ({
    currency: d.currency,
    collections: d.collections.map((c) => c.name),
    products: d.products.map((p) => ({ name: p.name, description: '', sku: p.sku, price: p.price, stock: p.stock, visible: p.visible, photos: p.photos.map((x) => x.ref), collections: p.collections })),
  })

  it('stores an uploaded photo once under the category, refusing what isn’t an image', async () => {
    const svc = service('staff-super-admin')
    expect(await svc.uploadSamplePhoto(ids.footwear, new TextEncoder().encode('not an image') as Uint8Array<ArrayBuffer>)).toEqual({ ok: false, code: 'PHOTO_REFUSED' })
    const up = await svc.uploadSamplePhoto(ids.footwear, new Uint8Array([...png, 7, 7, 7]))
    expect(up).toMatchObject({ ok: true, ref: expect.stringMatching(/^sample-photo:[0-9a-f]{64}$/) })
    expect(up.ok && bucket.has(`platform/store-category-samples/${ids.footwear}/${up.sha}`)).toBe(true)
    // Nothing names it yet, so nothing is logged until a Save does, with its reason.
    expect((await db.sql`select 1 from activity_log where target_id = ${ids.footwear} and action like 'store_category.sample_photo%'`).length).toBe(0)
  })

  it('shows every role the products and collections, each photo with its preview', async () => {
    const d = await detail()
    expect(d?.products).toHaveLength(6)
    expect(d?.products[0]).toMatchObject({ handle: 'shoe-1', name: 'Shoe 1', sku: 'SH-1', price: '900', visible: true, collections: ['Sneakers', 'Sandals'] })
    expect(d?.products[0]?.photos[0]?.previewUrl).toMatch(new RegExp(`^/api/store-category-photos/${ids.footwear}/[0-9a-f]{64}$`))
    expect(d?.collections).toEqual([{ name: 'Sneakers', products: 3 }, { name: 'Sandals', products: 4 }])
  })

  it('saves edits: a rename, a new price, a product moved, a 7th product with two uploaded photos, a collection removed', async () => {
    const d = (await detail()) as Detail
    const up = await service('staff-super-admin').uploadSamplePhoto(ids.footwear, new Uint8Array([...png, 9, 9]))
    const ref = up.ok ? up.ref : ''
    const upToo = await service('staff-super-admin').uploadSamplePhoto(ids.footwear, new Uint8Array([...png, 8, 8]))
    const second = upToo.ok ? upToo.ref : ''
    fetched.length = 0
    const input = inputOf(d)
    const first = input.products[0]
    if (!first) throw new Error('no first product')
    input.products[0] = { ...first, name: 'Trail Runner', price: '1250.50', collections: ['Sneakers'] }
    input.products.push({ name: 'Canvas Slip-On', description: 'New', sku: 'SH-7', price: '700', stock: 5, visible: true, photos: [ref, second], collections: ['Sneakers'] })
    input.collections = ['Sneakers']
    for (const p of input.products) p.collections = ['Sneakers']
    expect((await admin(saveItems, 'staff-partner-manager', { c: ids.footwear, i: input, r: 'Edit' })).code).toBe('FORBIDDEN')
    const saved = (await admin<SavedItems>(saveItems, 'staff-super-admin', { c: ids.footwear, i: input, r: 'Better names' })).data?.saveStoreCategorySampleItems
    expect(saved?.problems).toEqual([])
    expect(saved?.category?.sample).toEqual({ products: 7, collections: [{ name: 'Sneakers', products: 7 }] })
    // Photos copied at the first save are kept; the uploaded one is never fetched.
    expect(fetched).toEqual([])
    const after = (await detail()) as Detail
    expect(after.products[0]).toMatchObject({ name: 'Trail Runner', price: '1250.50' })
    expect(after.products[6]?.photos.map((x) => x.ref)).toEqual([ref, second])
    const [logged] = await db.sql<{ reason: string; changes: { field: string; after: string | null }[] }[]>`select reason, changes from activity_log
      where action = 'store_category.sample_saved' and target_id = ${ids.footwear} order by occurred_at desc, id desc limit 1`
    expect(logged?.reason).toBe('Better names')
    expect(logged?.changes.find((c) => c.field === 'photos_added')?.after?.split(', ').sort()).toEqual([ref, second].sort())
  })

  it('refuses no SKU, a duplicate SKU, an empty collection and no products, keeping the last save', async () => {
    const d = (await detail()) as Detail
    const base = inputOf(d)
    const [one, two] = base.products
    if (!one || !two) throw new Error('sample has fewer than two products')
    const problems = async (change: (i: ReturnType<typeof inputOf>) => void) => {
      const input = inputOf(d)
      change(input)
      const r = await admin<SavedItems>(saveItems, 'staff-super-admin', { c: ids.footwear, i: input, r: 'Try' })
      return r.code ?? r.data?.saveStoreCategorySampleItems.problems.map((p) => p.code)
    }
    expect(await problems((i) => void (i.products[1] = { ...two, sku: '' }))).toBe('INVALID_INPUT')
    expect(await problems((i) => void (i.products[1] = { ...two, sku: 'SH-7' }))).toContain('SKU_IN_FILE')
    expect(await problems((i) => void i.collections.push('Sandals'))).toEqual(['COLLECTION_EMPTY'])
    expect(await problems((i) => void (i.products = []))).toEqual(expect.arrayContaining(['PRODUCT_COUNT']))
    expect(await problems((i) => void (i.products = Array.from({ length: 51 }, (_, n) => ({ ...one, sku: `X-${n}`, name: `P ${n}` }))))).toBe('INVALID_INPUT')
    expect((await detail())?.products).toHaveLength(7)
  })

  it('saves a collection’s uploaded photo by name, refusing one for a collection that isn’t there or not uploaded', async () => {
    const svc = service('staff-super-admin')
    const up = await svc.uploadSamplePhoto(ids.footwear, new Uint8Array([...png, 5, 5]))
    const ref = up.ok ? up.ref : ''
    const input = inputOf((await detail()) as Detail)
    expect(await svc.saveSampleItems(ids.footwear, { ...input, collectionPhotos: [{ name: 'Boots', photo: ref }] }, 'Collection photo')).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    expect(await svc.saveSampleItems(ids.footwear, { ...input, collectionPhotos: [{ name: 'Sneakers', photo: 'https://x/ok-1.jpg' }] }, 'Collection photo')).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    const missing = await svc.saveSampleItems(ids.footwear, { ...input, collectionPhotos: [{ name: 'Sneakers', photo: 'sample-photo:' + 'e'.repeat(64) }] }, 'Collection photo')
    expect(missing).toMatchObject({ ok: false, reason: 'SAMPLE_INVALID', problems: [{ column: 'collection', code: 'PHOTO_UNAVAILABLE' }] })

    const saved = await admin<SavedItems>(saveItems, 'staff-super-admin', { c: ids.footwear, i: { ...input, collectionPhotos: [{ name: 'Sneakers', photo: ref }] }, r: 'Collection photo' })
    expect(saved.data?.saveStoreCategorySampleItems.problems).toEqual([])
    const [row] = await db.sql<{ collections: { name: string; photo?: string }[]; photos: Record<string, string> }[]>`select collections, photos from store_category_sample where category_id = ${ids.footwear}`
    expect(row?.collections[0]?.photo).toBe(ref)
    expect(row?.photos[ref]).toBe(`platform/store-category-samples/${ids.footwear}/${up.ok ? up.sha : ''}`)
    const shown = await admin<{ storeCategorySample: { collections: { name: string; photo: { ref: string; previewUrl: string } | null }[] } }>(
      `query($c: ID!) { storeCategorySample(categoryId: $c) { collections { name photo { ref previewUrl } } } }`, 'staff-partner-manager', { c: ids.footwear })
    expect(shown.data?.storeCategorySample.collections).toEqual([{ name: 'Sneakers', photo: { ref, previewUrl: `/api/store-category-photos/${ids.footwear}/${up.ok ? up.sha : ''}` } }])
  })

  it('counts a collection’s photo in the sample’s 60', async () => {
    const svc = service('staff-super-admin')
    const refs: string[] = []
    for (let i = 0; i < 61; i++) {
      const up = await svc.uploadSamplePhoto(ids.footwear, new Uint8Array([...png, 7, i]))
      refs.push(up.ok ? up.ref : '')
    }
    const input = inputOf((await detail()) as Detail)
    const products = input.products.map((p, i) => (i < 3 ? { ...p, photos: refs.slice(i * 20, i * 20 + 20) } : { ...p, photos: [] }))
    const refused = await svc.saveSampleItems(ids.footwear, { ...input, products, collectionPhotos: [{ name: 'Sneakers', photo: refs[60] ?? '' }] }, 'Too many photos')
    expect(refused).toMatchObject({ ok: false, reason: 'SAMPLE_INVALID', problems: [{ code: 'TOO_MANY_PHOTOS' }] })
  })

  it('adds an edited sample to a store with exactly its products, collection and uploaded photos, read from R2', async () => {
    fetched.length = 0
    // Store B1's test order (above) is taken away, so it can add the sample as a new store would.
    await db.sql`delete from "order" where store_id = ${t.storeB1}`
    const added = await shop(add, 'bOwner')
    expect(added.code).toBeUndefined()
    const jobId = added.data?.['addSampleCatalog'] as string | undefined
    await relay()
    await relay()
    expect(await db.sql`select state from catalog_import where id = ${jobId ?? ''}`).toEqual([{ state: 'done' }])
    const products = await db.sql<{ name: string; photos: number }[]>`select p.name, (select count(*)::int from product_photo ph where ph.product_id = p.id) as photos
      from product p where p.store_id = ${t.storeB1} and p.deleted_at is null order by p.name`
    expect(products).toHaveLength(7)
    expect(products.find((p) => p.name === 'Canvas Slip-On')?.photos).toBe(2)
    expect(fetched).toEqual([])
    const collections = await db.sql<{ name: string; n: number; image: boolean }[]>`select c.name, (select count(*)::int from collection_product cp where cp.collection_id = c.id) as n,
      exists (select 1 from asset a where a.id = c.image_asset_id and a.store_id = c.store_id) as image from collection c where c.store_id = ${t.storeB1} and c.deleted_at is null`
    expect(collections).toEqual([{ name: 'Sneakers', n: 7, image: true }])
  })

  it('sets a collection’s photo once, only on an empty image in its own store, and leaves it without one when the photo can’t be read', async () => {
    const [row] = await db.sql<{ id: string; idempotency_key: string; payload: Record<string, unknown> }[]>`select id, idempotency_key, payload from outbox
      where kind = 'import.collection_photo' and store_id = ${t.storeB1}`
    const payload = row?.payload ?? {}
    const collectionId = String(payload['collectionId'])
    const deliverer = sampleCollectionPhotoDeliverer(db.sql, r2, () => now)
    const deliver = (p: Record<string, unknown>) =>
      deliverer.deliver({ id: row?.id ?? '', kind: 'import.collection_photo', idempotencyKey: row?.idempotency_key ?? '', payload: p, partnerId: t.partnerB, storeId: t.storeB1, attempt: 2 }, new AbortController().signal)
    const imageOf = async (id: string) => (await db.sql<{ image: string | null }[]>`select image_asset_id as image from collection where id = ${id}`)[0]?.image
    const saved = async () => (await db.sql`select 1 from activity_log where action = 'collection.saved' and target_id = ${collectionId} and changes @> '[{"field":"image"}]'`).length
    const assets = async () => (await db.sql`select 1 from asset where store_id = ${t.storeB1}`).length
    const first = await imageOf(collectionId)
    expect(first).toEqual(expect.any(String))
    expect(await saved()).toBe(1)

    // Redelivered: the image and its one entry stay, and no second copy is stored.
    const before = await assets()
    await deliver(payload)
    expect(await imageOf(collectionId)).toBe(first)
    expect(await saved()).toBe(1)
    expect(await assets()).toBe(before)

    // A job in store B1 naming another store's collection changes nothing there.
    const [other] = await db.sql<{ id: string }[]>`update collection set image_asset_id = null where store_id = ${t.storeA1} and deleted_at is null returning id`
    await deliver({ ...payload, collectionId: other?.id ?? '' })
    expect(await imageOf(other?.id ?? '')).toBeNull()

    // A ref the sample doesn't hold, or one whose R2 object is gone, leaves the collection without an image and the job delivered.
    await db.sql`update collection set image_asset_id = null where id = ${collectionId}`
    await deliver({ ...payload, ref: 'sample-photo:' + 'f'.repeat(64) })
    expect(await imageOf(collectionId)).toBeNull()
    const [{ key } = { key: '' }] = await db.sql<{ key: string }[]>`select photos ->> ${String(payload['ref'])} as key from store_category_sample where category_id = ${ids.footwear}`
    const kept = bucket.get(key)
    bucket.delete(key)
    await deliver(payload)
    expect(await imageOf(collectionId)).toBeNull()
    if (kept) bucket.set(key, kept)
    await db.sql`update collection set image_asset_id = ${first ?? null} where id = ${collectionId}`
  })

  it('never reads R2 for a merchant’s own file naming a sample photo', async () => {
    const d = (await detail()) as Detail
    const ref = d.products[6]?.photos[0]?.ref ?? ''
    fetched.length = 0
    const file = `handle,name,visible,sku,price,image\nown-1,Own 1,yes,OWN-1,100,${ref}\n`
    const started = await shop('mutation($f: String!) { startCatalogImport(file: $f) }', 'other', { f: file })
    await relay()
    await shop('mutation($id: ID!) { confirmCatalogImport(id: $id, matching: skip) }', 'other', { id: started.data?.['startCatalogImport'] })
    await relay()
    const [own] = await db.sql<{ photos: number }[]>`select (select count(*)::int from product_photo ph where ph.product_id = p.id) as photos from product p where p.store_id = ${t.storeA2} and p.name = 'Own 1'`
    expect(own?.photos).toBe(0)
  })

  it('drops the collection photos on Reset to default, which replaces the whole sample with the built-in one', async () => {
    const photoOf = async () => (await db.sql<{ photo: string | null }[]>`select c ->> 'photo' as photo from store_category_sample, jsonb_array_elements(collections) c
      where category_id = ${ids.footwear} and c ->> 'name' = 'Sneakers'`)[0]?.photo
    expect(await photoOf()).toEqual(expect.stringMatching(/^sample-photo:/))
    const reset = await admin<Saved>(save, 'staff-super-admin', { c: ids.footwear, r: 'Reset to default' })
    expect(reset.data?.addDefaultStoreCategorySample.problems).toEqual([])
    expect(await photoOf()).toBeNull()
  })
})
