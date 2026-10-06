import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { deleteExpiredImports } from '#db/scoped/catalogImports'
import { withSystemScope } from '#db/scoped/index'
import { catalogExportDeliverer } from '#jobs/queues/deliverers/catalogExport'
import { catalogImportDeliverer, catalogImportDeps, importPhotosDeliverer } from '#jobs/queues/deliverers/catalogImport'
import { runImportChunk } from '#engine/modules/catalog/index'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #301 (SAPI 16, part 2): import from a spreadsheet, ours or Shopify's (CATALOG K; FIRST-RELEASE §13).

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-06T09:00:00Z')
type Who = 'owner' | 'staff' | 'supplier' | 'otherSupplier' | 'bOwner'
const people: Record<Who, string> = { owner: '', staff: '', supplier: '', otherSupplier: '', bOwner: '' }
const cookies: Record<Who, string> = { owner: '', staff: '', supplier: '', otherSupplier: '', bOwner: '' }

const user = async (partnerId: string, email: string, name: string) =>
  (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`)[0]?.id ?? ''

const subscribe = async (storeId: string, partnerId: string) => {
  const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${`Plan ${storeId.slice(0, 6)}`}, 'live') returning id`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${partnerId}, 1, 'products', 50)`
  await db.sql`update store set plan_id = ${plan?.id ?? ''}, pricing_currency = 'INR' where id = ${storeId}`
  await db.sql`delete from store_subscription where store_id = ${storeId}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${storeId}, ${partnerId}, ${plan?.id ?? ''}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})`
}

const sellerOf: Partial<Record<Who, () => string>> = { supplier: () => t.sellerA1First, otherSupplier: () => t.sellerA1Second }

/** Acting as `who`'s person through a read-only support session (ACCESS §8), at the resolver itself. */
const asSupport = (context: StoreContext, access: 'read' | 'write' = 'read'): StoreContext => {
  if (context.standing.kind !== 'acting') return context
  const { caller } = context.standing
  return { ...context, standing: { ...context.standing, caller: { ...caller, context: { ...caller.context, caller: { kind: 'support', supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access } } } } }
}

const gql = async (source: string, who: Who, variables: Record<string, unknown> = {}, storeId = who === 'bOwner' ? t.storeB1 : t.storeA1, through: (c: StoreContext) => StoreContext = (c) => c) => {
  const partnerId = who === 'bOwner' ? t.partnerB : t.partnerA
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const seller = sellerOf[who]?.()
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeId, ...(seller ? { [supplierHeader]: seller } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, now, activityLog, facts)
  const contextValue: StoreContext = through({ standing, partnerId, sql: db.sql, activity: activityLog, facts, now: () => now })
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, errors: result.errors }
}

// Photos come from addresses the test answers itself: a public host serving a PNG, a missing one, and a private one.
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0x80, 0, 0, 1, 0xe0, 8, 6, 0, 0, 0])
const bucket = new Map<string, Uint8Array>()
const r2 = { put: async (key: string, value: Uint8Array) => void bucket.set(key, value), get: async () => null }
const lookup = { resolve: async (host: string, type: string) => (type !== 'A' ? [] : host === 'inside.example' ? ['10.0.0.8'] : ['93.184.216.34']) }
const fetched: string[] = []
const fakeFetch = (async (input: RequestInfo | URL) => {
  const url = String(input)
  fetched.push(url)
  return url.endsWith('/front.png') ? new Response(png.slice(), { headers: { 'content-type': 'image/png' } }) : new Response('no', { status: 404 })
}) as typeof fetch

const relay = async () => {
  for (let round = 0; round < 12; round++) {
    const counts = await relayDue(
      db.sql,
      {
        'import.catalog': catalogImportDeliverer(db.sql, null, null, () => now),
        'import.photos': importPhotosDeliverer(db.sql, r2, lookup, () => now, fakeFetch),
        'export.catalog': catalogExportDeliverer(db.sql, () => now),
      },
      { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) },
    )
    if (Object.values(counts).every((n) => n === 0)) return
  }
}

/** An import confirmed and run to the point where its one photo job waits, taken off the outbox to deliver by hand. */
const importWithPhotoQueued = async (who: Who, handle: string, url: string) => {
  const { id } = await upload(who, `handle,name,price,image\n${handle},${handle},10,${url}\n`)
  await gql('mutation C($id: ID!) { confirmCatalogImport(id: $id, matching: update) }', who, { id })
  for (let round = 0; round < 6; round++) await relayDue(db.sql, { 'import.catalog': catalogImportDeliverer(db.sql, null, null, () => now) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
  const [row] = await db.sql<{ id: string; payload: unknown }[]>`
    update outbox set delivered_at = now() where kind = 'import.photos' and payload->>'jobId' = ${id} and delivered_at is null returning id, payload`
  const photo = { id: row?.id ?? '', kind: 'import.photos', idempotencyKey: 'k', payload: row?.payload, partnerId: t.partnerA, storeId: t.storeA1 }
  return { id, photo }
}

type Problem = { line: number; column: string | null; code: string; message: string }
type Job = { id: string; source: string; state: string; products: number; ready: number; matched: number; created: number; updated: number; skipped: number; failed: number; problemCount: number; problems: Problem[]; problemsCsv: string | null }
const fields = 'id source state products ready matched created updated skipped failed problemCount problems { line column code message } problemsCsv'
const read = async (who: Who, id: string) => (await gql(`query J($id: ID!) { catalogImport(id: $id) { ${fields} } }`, who, { id })).data?.['catalogImport'] as Job | null
const upload = async (who: Who, file: string) => {
  const result = await gql('mutation S($f: String!) { startCatalogImport(file: $f) }', who, { f: file })
  await relay()
  const id = result.data?.['startCatalogImport'] as string | undefined
  return { id: id ?? '', code: result.code, job: id ? await read(who, id) : null }
}
const confirm = async (who: Who, id: string, matching: 'update' | 'skip' = 'update', warehouseId?: string) => {
  const result = await gql('mutation C($id: ID!, $m: CatalogImportMatching!, $w: ID) { confirmCatalogImport(id: $id, matching: $m, warehouseId: $w) }', who, { id, m: matching, w: warehouseId })
  await relay()
  return { code: result.code, job: await read(who, id) }
}
const productBySku = async (sku: string, storeId = t.storeA1) =>
  (await db.sql<{ id: string; name: string; seller_id: string | null; visibility: string; approval_status: string | null }[]>`
    select p.id, p.name, p.seller_id, p.visibility, p.approval_status from product p join product_version v on v.product_id = p.id
    where v.sku = ${sku} and p.store_id = ${storeId} and v.deleted_at is null and p.deleted_at is null`)

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update seller set access_level = 'vendor-catalogue' where id in (${t.sellerA1First}, ${t.sellerA1Second})`
  people.owner = await user(t.partnerA, 'owner@a.example', 'Olivia')
  people.staff = await user(t.partnerA, 'staff@a.example', 'Sam')
  people.supplier = await user(t.partnerA, 'anand@a.example', 'Anand')
  people.otherSupplier = await user(t.partnerA, 'bhatia@a.example', 'Bhatia')
  people.bOwner = await user(t.partnerB, 'owner@b.example', 'Bea')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.staff}, ${t.storeA1}, 'staff', 'active'), (${people.bOwner}, ${t.storeB1}, 'owner', 'active')`
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${people.supplier}, ${t.storeA1}, ${t.sellerA1First}, 'supplier-admin', 'active'), (${people.otherSupplier}, ${t.storeA1}, ${t.sellerA1Second}, 'supplier-admin', 'active')`
  await subscribe(t.storeA1, t.partnerA)
  await subscribe(t.storeB1, t.partnerB)
  await db.sql`insert into store_language (store_id, language, status, position) values (${t.storeA1}, 'hi-IN', 'active', 1) on conflict do nothing`
  await db.sql`insert into store_currency (store_id, currency, mode, position) values (${t.storeA1}, 'USD', 'manual', 1)`
  for (const who of Object.keys(cookies) as Who[]) {
    cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: who === 'bOwner' ? t.partnerB : t.partnerA }, now))
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const ours = [
  'handle,name,description,type,visible,option1 name,option1 value,option2 name,option2 value,option3 name,option3 value,sku,barcode,price,compare at price,cost,weight grams,stock,name:hi-IN,description:hi-IN,price:USD',
  'kurta,Kurta,Handloomed,physical,yes,Size,S,,,,,KU-S,,1299.50,1499.00,600.00,300,7,कुर्ता,,15.99',
  'kurta,,,,,,M,,,,,KU-M,,1299.50,,,,3,,,',
  'lamp,Lamp,,,no,,,,,,,LAMP,,50,,,,,,,',
  'broken,Broken,,,,,,,,,,BRK,,12.5x,,,,,,,',
].join('\n')

describe('a spreadsheet import', () => {
  it('checks the file and writes nothing until it’s confirmed, then imports with stock, translations and hand prices', async () => {
    const { id, job } = await upload('owner', ours)
    expect(job).toMatchObject({ state: 'ready', source: 'csv', products: 3, ready: 2, matched: 0, problemCount: 1 })
    expect(job?.problems).toEqual([{ line: 5, column: 'price', code: 'BAD_PRICE', message: 'Write the price as a number, like 1299.50.' }])
    expect(await productBySku('KU-S')).toEqual([])
    const done = await confirm('owner', id)
    expect(done.job).toMatchObject({ state: 'done', created: 2, updated: 0, failed: 0 })
    const [kurta] = await productBySku('KU-S')
    expect(kurta).toMatchObject({ name: 'Kurta', seller_id: null, visibility: 'visible' })
    expect(await db.sql`select trim(currency) as currency, amount::text as amount, compare_at_amount::text as compare from version_price vp join product_version v on v.id = vp.version_id where v.sku = 'KU-S' order by currency`).toEqual([
      { currency: 'INR', amount: '129950', compare: '149900' },
      { currency: 'USD', amount: '1599', compare: null },
    ])
    expect(await db.sql`select w.name, s.on_hand, m.reason from stock_level s join warehouse w on w.id = s.warehouse_id join product_version v on v.id = s.version_id join stock_movement m on m.version_id = v.id where v.sku = 'KU-M'`).toEqual([{ name: 'Main location', on_hand: 3, reason: 'import' }])
    expect(await db.sql`select text from translation where entity = 'product' and entity_id = ${kurta?.id ?? ''} and language = 'hi-IN' and field = 'name'`).toEqual([{ text: 'कुर्ता' }])
    expect((await productBySku('LAMP'))[0]?.visibility).toBe('hidden')
    // The error file holds the row that failed with its problem, ready to fix and upload again.
    expect(done.job?.problemsCsv?.split('\n')).toEqual([
      'handle,name,description,type,visible,option1 name,option1 value,option2 name,option2 value,option3 name,option3 value,sku,barcode,price,compare at price,cost,weight grams,stock,name:hi-IN,description:hi-IN,price:USD,problem',
      'broken,Broken,,,,,,,,,,BRK,,12.5x,,,,,,,,"price: Write the price as a number, like 1299.50."',
    ])
    expect((await confirm('owner', id)).code).toBe('NOT_READY')
    const logged = await db.sql<{ action: string }[]>`select action from activity_log where action like 'catalog.import%' and actor_id = ${people.owner} order by occurred_at`
    expect(logged.map((l) => l.action)).toEqual(['catalog.import_started', 'catalog.imported'])
  })

  it('round-trips an export: matched by SKU, updated in place or skipped', async () => {
    const asked = await gql('mutation { requestCatalogExport(kind: products) }', 'owner')
    await relay()
    const exported = (await gql('query J($id: ID!) { catalogExport(id: $id) { csv } }', 'owner', { id: asked.data?.['requestCatalogExport'] })).data?.['catalogExport'] as { csv: string }
    const edited = exported.csv.replace('Kurta,Handloomed', 'Kurta,Handloomed in Bengal').replace(/1299\.50/g, '1199.00')
    const skipped = await upload('owner', edited)
    expect(skipped.job).toMatchObject({ ready: 2, matched: 2 })
    expect((await confirm('owner', skipped.id, 'skip')).job).toMatchObject({ state: 'done', skipped: 2, updated: 0 })
    const updated = await upload('owner', edited)
    expect((await confirm('owner', updated.id, 'update')).job).toMatchObject({ state: 'done', updated: 2, created: 0 })
    const kurtas = await productBySku('KU-S')
    expect(kurtas).toHaveLength(1)
    expect(await db.sql`select description, slug from product where id = ${kurtas[0]?.id ?? ''}`).toEqual([{ description: 'Handloomed in Bengal', slug: 'kurta' }])
    expect(await db.sql`select amount::text as amount from version_price vp join product_version v on v.id = vp.version_id where v.sku = 'KU-M' and vp.currency = 'INR'`).toEqual([{ amount: '119900' }])
    // The hand price the file still carried, and the version kept its stock and history.
    expect(await db.sql`select amount::text as amount from version_price vp join product_version v on v.id = vp.version_id where v.sku = 'KU-S' and vp.currency = 'USD'`).toEqual([{ amount: '1599' }])
  })

  it('keeps what an update’s file has no column or value for, on the product and each version it names', async () => {
    const [ku] = await productBySku('KU-S')
    await db.sql`update product_version set name = 'Small', length_mm = 300, width_mm = 200, height_mm = 20, hs_code = '621142', customs_description = 'Cotton kurta', track_stock = false, continue_selling = true, cost_amount = 55000, cost_currency = 'INR', weight_grams = 280, barcode = '036000291452'
      where sku = 'KU-S'`
    await db.sql`update product set seo_title = 'Kurta, handloomed', product_type = 'physical' where id = ${ku?.id ?? ''}`
    const { id } = await upload('owner', 'handle,name,option1 name,option1 value,sku,price,cost,weight grams,barcode\nkurta,Kurta,Size,S,KU-S,1399.00,,,\nkurta,,,M,KU-M,1399.00,,,\n')
    expect((await confirm('owner', id, 'update')).job).toMatchObject({ state: 'done', updated: 1, failed: 0 })
    expect(await db.sql`select name, length_mm, width_mm, height_mm, hs_code, customs_description, track_stock, continue_selling, cost_amount::text as cost, weight_grams, barcode from product_version where sku = 'KU-S' and deleted_at is null`).toEqual([
      { name: 'Small', length_mm: 300, width_mm: 200, height_mm: 20, hs_code: '621142', customs_description: 'Cotton kurta', track_stock: false, continue_selling: true, cost: '55000', weight_grams: 280, barcode: '036000291452' },
    ])
    expect(await db.sql`select seo_title, description from product where id = ${ku?.id ?? ''}`).toEqual([{ seo_title: 'Kurta, handloomed', description: 'Handloomed in Bengal' }])
    expect(await db.sql`select amount::text as amount from version_price vp join product_version v on v.id = vp.version_id where v.sku = 'KU-S' and vp.currency = 'INR'`).toEqual([{ amount: '139900' }])
  })

  it('reads Shopify’s file, fetching photos from public addresses only', async () => {
    const shopify = [
      'Handle,Title,Body (HTML),Vendor,Type,Published,Option1 Name,Option1 Value,Variant SKU,Variant Grams,Variant Inventory Qty,Variant Price,Image Src,Image Alt Text,Status',
      'tee,Tee,<p>Soft &amp; light</p>,Acme,Shirts,TRUE,Size,S,TEE-S,180,5,499.00,https://cdn.example/front.png,Front,active',
      'tee,,,,,,,M,TEE-M,190,2,499.00,https://cdn.example/gone.png,,',
      'tee,,,,,,,,,,,,https://inside.example/secret.png,,',
    ].join('\n')
    const { id, job } = await upload('owner', shopify)
    expect(job).toMatchObject({ source: 'shopify', ready: 1, problemCount: 0 })
    const done = (await confirm('owner', id)).job
    expect(done).toMatchObject({ state: 'done', created: 1 })
    const [tee] = await productBySku('TEE-S')
    expect(await db.sql`select description from product where id = ${tee?.id ?? ''}`).toEqual([{ description: 'Soft & light' }])
    expect(await db.sql`select position, alt from product_photo where product_id = ${tee?.id ?? ''}`).toEqual([{ position: 0, alt: 'Front' }])
    expect(done?.problems.map((p) => [p.line, p.code])).toEqual([[3, 'PHOTO_UNAVAILABLE'], [4, 'PHOTO_UNAVAILABLE']])
    // The private address was refused before any request went to it.
    expect(fetched.some((u) => u.includes('inside.example'))).toBe(false)
  })

  it('resumes after a failure part-way through a chunk without making any product twice', async () => {
    const { id } = await upload('owner', 'handle,name,price,stock\nretry-a,Retry A,10,1\nretry-b,Retry B,10,2\nretry-c,Retry C,10,3\n')
    await gql('mutation C($id: ID!) { confirmCatalogImport(id: $id, matching: update) }', 'owner', { id })
    // The run's job, taken off the outbox so this test can deliver it with a failure on the second product.
    const [row] = await db.sql<{ id: string; payload: { jobId: string; partnerId: string; storeId: string; caller: { kind: 'person'; userId: string }; sellerId: null; subscription: 'active'; phase: 'run' } }[]>`
      update outbox set delivered_at = now() where kind = 'import.catalog' and payload->>'jobId' = ${id} and payload->>'phase' = 'run' and delivered_at is null returning id, payload`
    if (!row) throw new Error('no run queued')
    const deps = catalogImportDeps(db.sql, row.payload, { id: row.id }, () => now)
    let saves = 0
    const failing = { ...deps, catalog: { ...deps.catalog, create: async (...args: Parameters<typeof deps.catalog.create>) => (++saves === 2 ? Promise.reject(new Error('lost the database')) : deps.catalog.create(...args)) } }
    await expect(runImportChunk(failing, id, 6_000)).rejects.toThrow('lost the database')
    expect((await read('owner', id))?.created).toBe(1)
    await runImportChunk(deps, id, 6_000)
    await relay()
    expect(await read('owner', id)).toMatchObject({ state: 'done', created: 3, failed: 0 })
    expect(await db.sql`select name, count(*)::int as n from product where store_id = ${t.storeA1} and name like 'Retry %' and deleted_at is null group by name order by name`).toEqual([
      { name: 'Retry A', n: 1 },
      { name: 'Retry B', n: 1 },
      { name: 'Retry C', n: 1 },
    ])
    expect(await db.sql`select v.sku, s.on_hand from stock_level s join product_version v on v.id = s.version_id join product p on p.id = v.product_id where p.name like 'Retry %' order by p.name`).toHaveLength(3)
  })

  it('says why a file can’t be read, and refuses a location that isn’t the importer’s', async () => {
    const unreadable = await upload('owner', 'colour,size\nred,S\n')
    expect(unreadable.job).toMatchObject({ state: 'unreadable', problems: [{ line: 0, code: 'NO_NAME_COLUMN' }] })
    const supplierPlace = (await db.sql<{ id: string }[]>`insert into warehouse (store_id, seller_id, name, is_default) values (${t.storeA1}, ${t.sellerA1First}, 'Anand’s', true) returning id`)[0]?.id ?? ''
    const ready = await upload('owner', 'handle,name,price\nnew-pot,New pot,20\n')
    expect((await confirm('owner', ready.id, 'update', supplierPlace)).code).toBe('WAREHOUSE_NOT_FOUND')
    expect((await gql('mutation S($f: String!) { startCatalogImport(file: $f) }', 'owner', { f: 'x'.repeat(5 * 1024 * 1024 + 1) })).code).toBe('FILE_TOO_LARGE')
    // A store that hasn't chosen its currency can't have prices read: refused, never priced in one we picked.
    await db.sql`update store set pricing_currency = null where id = ${t.storeA1}`
    try {
      expect((await upload('owner', 'handle,name,price\npot,Pot,10\n')).job).toMatchObject({ state: 'unreadable', problems: [{ line: 0, code: 'CURRENCY_REQUIRED' }] })
    } finally {
      await db.sql`update store set pricing_currency = 'INR' where id = ${t.storeA1}`
    }
  })
})

describe('a supplier’s import', () => {
  it('writes only its own rows, waiting for approval while it’s on, whatever SKUs the store uses', async () => {
    await gql('mutation { setApproval(on: true) }', 'owner')
    const { id, job } = await upload('supplier', 'handle,name,visible,sku,price,stock,price:USD\nmug,Mug,yes,MUG,200,4,3\nkurta-copy,Kurta copy,,KU-S,300,,\n')
    expect(job).toMatchObject({ ready: 2, matched: 0, problems: [{ line: 1, column: 'price:USD', code: 'SUPPLIER_CURRENCY' }] })
    expect((await confirm('supplier', id)).job).toMatchObject({ state: 'done', created: 2 })
    const [mug] = await productBySku('MUG')
    expect(mug).toMatchObject({ seller_id: t.sellerA1First, approval_status: 'pending', visibility: 'hidden' })
    // The store's own KU-S is untouched: the supplier's row made its own product with that SKU.
    const kus = await productBySku('KU-S')
    expect(kus.map((k) => k.seller_id).sort()).toEqual([null, t.sellerA1First].sort())
    expect(kus.find((k) => k.seller_id === null)?.name).toBe('Kurta')
    expect(await db.sql`select w.seller_id from stock_level s join warehouse w on w.id = s.warehouse_id join product_version v on v.id = s.version_id where v.sku = 'MUG'`).toEqual([{ seller_id: t.sellerA1First }])
  })

  it('is read back only by whoever imported it; Staff can’t import', async () => {
    const { id } = await upload('supplier', 'handle,name,price\ncup,Cup,10\n')
    for (const who of ['otherSupplier', 'owner', 'bOwner'] as const) expect(await read(who, id), who).toBeNull()
    expect((await confirm('otherSupplier', id)).code).toBe('NOT_FOUND')
    expect((await gql('{ catalogImports { id } }', 'staff')).code).toBe('FORBIDDEN')
    expect((await gql('mutation { startCatalogImport(file: "handle,name,price\\na,A,1") }', 'staff')).code).toBe('FORBIDDEN')
    expect(((await gql('{ catalogImports { id } }', 'supplier')).data?.['catalogImports'] as { id: string }[]).map((i) => i.id)).toContain(id)
    expect((await gql('{ catalogImportTemplate }', 'supplier')).data?.['catalogImportTemplate']).toMatch(/^handle,name,description,type,option1 name/)
    expect((await gql('{ catalogImportTemplate }', 'owner')).data?.['catalogImportTemplate']).toMatch(/,name:hi-IN,description:hi-IN,price:USD\n/)
  })

  it('is a catalogue tier’s: a Stock-only supplier is refused everywhere, and a read-only support session can’t start or confirm', async () => {
    await db.sql`update seller set access_level = 'vendor-stock' where id = ${t.sellerA1Second}`
    try {
      expect((await gql('mutation { startCatalogImport(file: "handle,name,price\\na,A,1") }', 'otherSupplier')).code).toBe('FORBIDDEN')
      expect((await gql('mutation { confirmCatalogImport(id: "00000000-0000-4000-8000-000000000000", matching: update) }', 'otherSupplier')).code).toBe('FORBIDDEN')
      expect((await gql('{ catalogImports { id } }', 'otherSupplier')).code).toBe('FORBIDDEN')
      expect((await gql('{ catalogImportTemplate }', 'otherSupplier')).code).toBe('FORBIDDEN')
    } finally {
      await db.sql`update seller set access_level = 'vendor-catalogue' where id = ${t.sellerA1Second}`
    }
    expect((await gql('mutation { startCatalogImport(file: "handle,name,price\\na,A,1") }', 'owner', {}, t.storeA1, asSupport)).code).toBe('FORBIDDEN')
    const { id } = await upload('owner', 'handle,name,price\nsupport-try,Support try,1\n')
    expect((await gql('mutation C($id: ID!) { confirmCatalogImport(id: $id, matching: update) }', 'owner', { id }, t.storeA1, asSupport)).code).toBe('FORBIDDEN')
    // With write access too: the run checks a person's seat each chunk, so a support session isn't let start one it can't finish.
    const asWriteSupport = (c: StoreContext) => asSupport(c, 'write')
    expect((await gql('mutation { startCatalogImport(file: "handle,name,price\\na,A,1") }', 'owner', {}, t.storeA1, asWriteSupport)).code).toBe('FORBIDDEN')
    expect((await gql('mutation C($id: ID!) { confirmCatalogImport(id: $id, matching: update) }', 'owner', { id }, t.storeA1, asWriteSupport)).code).toBe('FORBIDDEN')
  })

  it('stops a run whose importer can’t import any more, making nothing after', async () => {
    const { id } = await upload('supplier', 'handle,name,price\nafter-suspend,After suspend,1\n')
    await gql('mutation C($id: ID!) { confirmCatalogImport(id: $id, matching: update) }', 'supplier', { id })
    // Suspended between the confirm and the run.
    await db.sql`update outbox set next_attempt_at = now() + interval '1 day' where kind = 'import.catalog' and payload->>'jobId' = ${id}`
    await db.sql`update seller set status = 'suspended' where id = ${t.sellerA1First}`
    try {
      await db.sql`update outbox set next_attempt_at = now() where kind = 'import.catalog' and payload->>'jobId' = ${id}`
      await relay()
      expect(await productBySku('after-suspend')).toEqual([])
      expect(await db.sql`select name from product where name = 'After suspend'`).toEqual([])
      const [row] = await db.sql<{ state: string; problems: { code: string }[] }[]>`select state, problems from catalog_import where id = ${id}`
      expect(row?.state).toBe('failed')
      expect(row?.problems.map((p) => p.code)).toContain('NOT_ALLOWED')
    } finally {
      await db.sql`update seller set status = 'active' where id = ${t.sellerA1First}`
    }
  })

  it('reports a photo job that keeps failing on its line, and finishes the import', async () => {
    const { id, photo } = await importWithPhotoQueued('owner', 'photo-fails', 'https://cdn.example/front.png')
    const broken = { put: async () => Promise.reject(new Error('R2 is down')), get: async () => null }
    await importPhotosDeliverer(db.sql, broken, lookup, () => now, fakeFetch).deliver({ ...photo, attempt: defaultRelayOptions.maxAttempts }, AbortSignal.timeout(5000))
    const job = await read('owner', id)
    expect(job).toMatchObject({ state: 'done', created: 1 })
    expect(job?.problems.map((p) => p.code)).toEqual(['PHOTO_UNAVAILABLE'])
  })

  it('fetches nothing for an importer who can’t import any more, and still finishes the import', async () => {
    const { id, photo } = await importWithPhotoQueued('owner', 'photo-revoked', 'https://cdn.example/front.png?revoked')
    await db.sql`update membership set status = 'removed' where user_id = ${people.owner} and store_id = ${t.storeA1}`
    try {
      await importPhotosDeliverer(db.sql, r2, lookup, () => now, fakeFetch).deliver({ ...photo, attempt: 1 }, AbortSignal.timeout(5000))
      expect(fetched.some((u) => u.endsWith('?revoked'))).toBe(false)
      const [row] = await db.sql<{ state: string; problems: { code: string }[] }[]>`select state, problems from catalog_import where id = ${id}`
      expect(row?.state).toBe('done')
      expect(row?.problems.map((p) => p.code)).toEqual(['NOT_ALLOWED'])
    } finally {
      await db.sql`update membership set status = 'active' where user_id = ${people.owner} and store_id = ${t.storeA1}`
    }
  })

  it('is purged after its day', async () => {
    const before = (await db.sql<{ n: number }[]>`select count(*)::int as n from catalog_import`)[0]?.n ?? 0
    expect(await withSystemScope(db.sql, (tx) => deleteExpiredImports(tx, new Date(Date.now() + 3 * 86_400_000)))).toBe(before)
  })
})
