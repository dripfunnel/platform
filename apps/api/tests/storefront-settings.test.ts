import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveShopper } from '#auth/shopCaller'
import { withScope, withSystemScope } from '#db/scoped/index'
import { selectShopAsset } from '#db/scoped/shop'
import { activityLog } from '#saas/activity/index'
import { freezeBuild, startPublish } from '#saas/storefronts/index'
import { draftBundle, snapshotFile } from '#saas/storefronts/layout'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { fakeSites } from './support/sites'
import { seedStoreWorld, type StoreWorld, type Who } from './support/storeWorld'

// Card #471 (SAPI 17b), part 1: the brand and the home page's search and sharing on the Store API, read by the Shop API
// for core's useStorefront() (FIRST-RELEASE §14; SAAS §9.2; DATA-MODEL §7.8).

let db: TestDatabase
let t: Tenants
let w: StoreWorld
const now = () => new Date('2026-10-11T09:00:00.000Z')
const files = { logo: '', favicon: '', supplierImage: '', otherStore: '', photo: '', hiddenPhoto: '', otherPhoto: '' }

const asset = async (storeId: string, sellerId: string | null = null) =>
  (await db.sql<{ id: string }[]>`insert into asset (store_id, seller_id, r2_key, kind, mime, bytes, checksum) values (${storeId}, ${sellerId}, ${`stores/${storeId}/assets/${crypto.randomUUID()}.png`}, 'image', 'image/png', 10, ${'0'.repeat(64)}) returning id`)[0]?.id ?? ''
const photoOf = async (storeId: string, visibility: string) => {
  const [product] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${storeId}, 'Kurta', ${`kurta-${crypto.randomUUID().slice(0, 8)}`}, ${visibility}) returning id`
  const id = await asset(storeId)
  await db.sql`insert into product_photo (product_id, store_id, asset_id, position) values (${product?.id ?? ''}, ${storeId}, ${id}, 0)`
  return id
}

const brandFields = 'shopName logoAssetId faviconAssetId primaryColour secondaryColour tagline description social { instagram facebook x youtube tiktok whatsapp } contactEmail contactPhone contactAddress { street city postal region } voice brandReady'
const saveBrand = (who: Who, input: Record<string, unknown>) =>
  w.gql(who, `mutation S($input: StorefrontBrandInput!) { saveStorefrontBrand(input: $input) { ${brandFields} } }`, { input })
const saveSeo = (who: Who, input: Record<string, unknown>) =>
  w.gql(who, 'mutation S($input: StorefrontSeoInput!) { saveStorefrontSeo(input: $input) { title description shareImageAssetId } }', { input })
const renders = (storeId: string) => db.sql<{ payload: { pages: string[]; drop: string[] } }[]>`select payload from outbox where kind = 'storefront.render' and store_id = ${storeId} order by created_at`

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  w = await seedStoreWorld(db.sql, t, { now, secrets: null, lookup: null })
  await db.sql`update store set contact_email = 'hello@a1.example', contact_phone = '+91 98 7654 3210', address = '{"city": "Jaipur"}', country = 'IN' where id = ${t.storeA1}`
  files.logo = await asset(t.storeA1)
  files.favicon = await asset(t.storeA1)
  files.supplierImage = await asset(t.storeA1, t.sellerA1First)
  files.otherStore = await asset(t.storeB1)
  files.photo = await photoOf(t.storeA1, 'visible')
  files.hiddenPhoto = await photoOf(t.storeA1, 'hidden')
  files.otherPhoto = await photoOf(t.storeB1, 'visible')
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('the brand', () => {
  it('is not ready until the logo is saved, and starts from Store info’s contact details', async () => {
    const read = await w.gql('owner', `{ storefrontBrand { ${brandFields} } }`)
    expect(read.data?.['storefrontBrand']).toMatchObject({
      shopName: 'Store A1',
      logoAssetId: null,
      brandReady: false,
      contactEmail: 'hello@a1.example',
      contactPhone: '+91 98 7654 3210',
      contactAddress: { city: 'Jaipur', street: '' },
      social: { instagram: null },
    })
  })

  it('the Owner saves it; the Manager reads it; Staff, a supplier and the Manager writing are refused', async () => {
    const saved = await saveBrand('owner', {
      shopName: 'Juniper Linen',
      logoAssetId: files.logo,
      faviconAssetId: files.favicon,
      primaryColour: '#1F4E3D',
      secondaryColour: 'fa0',
      tagline: '  Linen for slow days ',
      description: 'Handwoven in Jaipur.',
      social: { instagram: '@juniper.linen', x: 'https://twitter.com/juniper', whatsapp: '+91 98765 43210', youtube: 'youtube.com/@juniper' },
      contactEmail: 'shop@juniper.example',
      contactAddress: { city: 'Jaipur', region: 'Rajasthan' },
      voice: 'Warm and unhurried',
    })
    expect(saved.code).toBeUndefined()
    expect(saved.data?.['saveStorefrontBrand']).toEqual({
      shopName: 'Juniper Linen',
      logoAssetId: files.logo,
      faviconAssetId: files.favicon,
      primaryColour: '#1f4e3d',
      secondaryColour: '#ffaa00',
      tagline: 'Linen for slow days',
      description: 'Handwoven in Jaipur.',
      social: { instagram: 'https://www.instagram.com/juniper.linen', facebook: null, x: 'https://twitter.com/juniper', youtube: 'https://youtube.com/@juniper', tiktok: null, whatsapp: 'https://wa.me/919876543210' },
      contactEmail: 'shop@juniper.example',
      // Saved without a phone, the brand has none: Store info's was only where it started.
      contactPhone: null,
      contactAddress: { street: '', city: 'Jaipur', postal: '', region: 'Rajasthan' },
      voice: 'Warm and unhurried',
      brandReady: true,
    })
    expect((await db.sql<{ name: string }[]>`select name from store where id = ${t.storeA1}`)[0]?.name).toBe('Juniper Linen')
    expect((await w.gql('manager', '{ storefrontBrand { tagline brandReady } }')).data?.['storefrontBrand']).toEqual({ tagline: 'Linen for slow days', brandReady: true })
    for (const who of ['staff', 'supplier'] as const) {
      expect((await w.gql(who, '{ storefrontBrand { tagline } }')).code).toBe('FORBIDDEN')
      expect((await w.gql(who, '{ storefrontSeo { title } }')).code).toBe('FORBIDDEN')
    }
    for (const who of ['manager', 'staff', 'supplier'] as const) {
      expect((await saveBrand(who, { logoAssetId: files.logo })).code).toBe('FORBIDDEN')
      expect((await saveSeo(who, { title: 'Mine' })).code).toBe('FORBIDDEN')
    }
    // The names of what changed, never the values (LOGGING §3).
    const logged = await db.sql<{ action: string; reason: string; changes: unknown }[]>`select action, reason, changes from activity_log where store_id = ${t.storeA1} and action = 'storefront.brand_changed'`
    expect(logged).toHaveLength(1)
    expect(logged[0]?.reason).toBe('shop_name, logo, favicon, primary_colour, secondary_colour, tagline, description, social, contact_email, contact_phone, contact_address, voice')
    expect(JSON.stringify(logged)).not.toContain('juniper')
  })

  it('keeps Store info’s name when none is given, and refuses a blank one', async () => {
    expect((await saveBrand('owner', { logoAssetId: files.logo })).code).toBeUndefined()
    expect((await db.sql<{ name: string }[]>`select name from store where id = ${t.storeA1}`)[0]?.name).toBe('Juniper Linen')
    const blank = await saveBrand('owner', { shopName: '  ', logoAssetId: files.logo })
    expect({ code: blank.code, field: blank.extensions?.['field'] }).toEqual({ code: 'INVALID_INPUT', field: 'shopName' })
  })

  it('takes only the store’s own images, hex colours and https links on each network’s own host', async () => {
    const refused = async (input: Record<string, unknown>) => {
      const r = await saveBrand('owner', { logoAssetId: files.logo, ...input })
      return { code: r.code, field: r.extensions?.['field'] }
    }
    expect(await refused({ logoAssetId: files.otherStore })).toEqual({ code: 'INVALID_IMAGE', field: 'logo' })
    expect(await refused({ logoAssetId: files.supplierImage })).toEqual({ code: 'INVALID_IMAGE', field: 'logo' })
    expect(await refused({ logoAssetId: 'https://evil.example/logo.png' })).toEqual({ code: 'INVALID_IMAGE', field: 'logo' })
    expect(await refused({ faviconAssetId: files.otherStore })).toEqual({ code: 'INVALID_IMAGE', field: 'favicon' })
    expect(await refused({ primaryColour: 'red' })).toEqual({ code: 'INVALID_INPUT', field: 'primaryColour' })
    expect(await refused({ social: { instagram: 'https://evil.example/juniper' } })).toEqual({ code: 'INVALID_INPUT', field: 'social.instagram' })
    expect(await refused({ social: { facebook: 'http://facebook.com/juniper' } })).toEqual({ code: 'INVALID_INPUT', field: 'social.facebook' })
    expect(await refused({ social: { x: 'https://x.com.evil.example/juniper' } })).toEqual({ code: 'INVALID_INPUT', field: 'social.x' })
    expect(await refused({ social: { tiktok: 'https://user:pw@tiktok.com/@juniper' } })).toEqual({ code: 'INVALID_INPUT', field: 'social.tiktok' })
    expect(await refused({ social: { youtube: 'javascript:alert(1)' } })).toEqual({ code: 'INVALID_INPUT', field: 'social.youtube' })
    expect(await refused({ voice: 'x'.repeat(61) })).toEqual({ code: 'INVALID_INPUT', field: 'voice' })
    expect((await refused({ contactEmail: 'not an email' })).code).toBe('INVALID_EMAIL')
    expect((await w.gql('owner', '{ storefrontBrand { logoAssetId } }')).data?.['storefrontBrand']).toEqual({ logoAssetId: files.logo })
  })

  it('keeps each store’s brand its own', async () => {
    expect((await saveBrand('bOwner', { logoAssetId: files.logo })).code).toBe('INVALID_IMAGE')
    expect((await w.gql('a2Owner', '{ storefrontBrand { tagline brandReady } }')).data?.['storefrontBrand']).toEqual({ tagline: null, brandReady: false })
    expect(await db.sql`select 1 from storefront_brand where store_id <> ${t.storeA1}`).toHaveLength(0)
  })
})

describe('search and sharing', () => {
  it('saves the home page’s words and a product photo, and renders the home page in every language once the store is live', async () => {
    // No live build yet: nothing to render beside, so the first publish carries it.
    expect((await saveSeo('owner', { title: 'Juniper linen', description: 'Handwoven in Jaipur.', shareImageAssetId: files.photo })).data?.['saveStorefrontSeo']).toEqual({
      title: 'Juniper linen',
      description: 'Handwoven in Jaipur.',
      shareImageAssetId: files.photo,
    })
    expect(await renders(t.storeA1)).toEqual([])
    const [run] = await db.sql<{ id: string }[]>`insert into publish_run (store_id, kind, state, commit, template, core_version, started_by_kind, finished_at, switched_at) values (${t.storeA1}, 'manual', 'live', ${'a'.repeat(40)}, 'linen', '1.0.0', 'system', now(), now()) returning id`
    await db.sql`update storefront set live_build_id = ${run?.id ?? ''} where store_id = ${t.storeA1}`
    await db.sql`insert into store_language (store_id, language, status, position) values (${t.storeA1}, 'hi-IN', 'active', 1)`
    await saveSeo('owner', { title: 'Juniper — handwoven linen', description: 'Handwoven in Jaipur.', shareImageAssetId: files.photo })
    expect((await renders(t.storeA1)).map((r) => r.payload)).toEqual([{ storeId: t.storeA1, pages: ['/', '/hi-in/'], drop: [] }])
    // Saved unchanged, nothing renders again.
    await saveSeo('owner', { title: 'Juniper — handwoven linen', description: 'Handwoven in Jaipur.', shareImageAssetId: files.photo })
    expect(await renders(t.storeA1)).toHaveLength(1)
    // The render is a page run, which never uses the "Publish now" allowance (LIVE-SHOP §7).
    expect(await db.sql`select 1 from publish_run where store_id = ${t.storeA1} and uses_allowance`).toHaveLength(0)
    expect((await w.gql('manager', '{ storefrontSeo { title } }')).data?.['storefrontSeo']).toEqual({ title: 'Juniper — handwoven linen' })
    const logged = await db.sql<{ reason: string | null }[]>`select reason from activity_log where store_id = ${t.storeA1} and action = 'storefront.seo_changed' order by occurred_at, id`
    expect(logged.map((l) => l.reason)).toEqual(['title, description, share_image', 'title', null])
  })

  it('refuses words past the limits and an image that isn’t one of the store’s product photos', async () => {
    const refused = async (input: Record<string, unknown>) => {
      const r = await saveSeo('owner', input)
      return { code: r.code, field: r.extensions?.['field'] }
    }
    expect(await refused({ title: 'x'.repeat(61) })).toEqual({ code: 'INVALID_INPUT', field: 'title' })
    expect(await refused({ description: 'x'.repeat(156) })).toEqual({ code: 'INVALID_INPUT', field: 'description' })
    expect(await refused({ shareImageAssetId: files.logo })).toEqual({ code: 'INVALID_IMAGE', field: 'shareImage' })
    expect(await refused({ shareImageAssetId: files.otherPhoto })).toEqual({ code: 'INVALID_IMAGE', field: 'shareImage' })
    expect((await saveSeo('owner', { title: 'x'.repeat(60), description: 'y'.repeat(155), shareImageAssetId: files.hiddenPhoto })).code).toBeUndefined()
    expect((await w.gql('bOwner', '{ storefrontSeo { title } }')).data?.['storefrontSeo']).toEqual({ title: null })
  })
})

describe('a read-only store', () => {
  it('refuses every write while past due, and keeps reading', async () => {
    await db.sql`update store set status = 'past_due' where id = ${t.storeA1}`
    try {
      expect((await saveBrand('owner', { logoAssetId: files.logo })).code).toBe('READ_ONLY')
      expect((await saveSeo('owner', { title: 'Late' })).code).toBe('READ_ONLY')
      expect((await w.gql('owner', '{ storefrontBrand { brandReady } }')).code).toBeUndefined()
    } finally {
      await db.sql`update store set status = 'active' where id = ${t.storeA1}`
    }
  })
})

describe('the Shop API and the publish snapshot', () => {
  const shop = async (storeId: string, source: string) => {
    const key = (await db.sql<{ k: string }[]>`select public_store_key as k from storefront where store_id = ${storeId}`)[0]?.k ?? ''
    const found = await resolveShopper(db.sql, new Request('https://shop.example/shop-api', { headers: { 'x-shop-key': key } }), 'shop.example')
    if (found.kind !== 'found') throw new Error('no store')
    const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: 'https://shop.example', activity: activityLog, facts: { requestId: 'r', ip: null, userAgent: null }, allowNewCart: async () => true, now }
    const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
    return { data: result.data as Record<string, unknown> | null | undefined, errors: result.errors }
  }
  const url = (id: string) => `https://shop.example/shop-api/assets/${id}`

  it('carries the brand and the search words with the store’s settings, never the colours or the voice', async () => {
    await db.sql`update store set status = 'active', pricing_currency = 'INR' where id in (${t.storeA1}, ${t.storeB1})`
    await saveBrand('owner', { logoAssetId: files.logo, faviconAssetId: files.favicon, tagline: 'Linen for slow days', social: { instagram: '@juniper.linen', whatsapp: '+91 98765 43210' }, contactEmail: 'shop@juniper.example', primaryColour: '#1f4e3d', voice: 'Warm' })
    await saveSeo('owner', { title: 'Juniper linen', description: 'Handwoven in Jaipur.', shareImageAssetId: files.photo })
    const r = await shop(t.storeA1, '{ store { name tagline contactEmail contactPhone logo { url } favicon { url } social { network url } seo { title description image { url } } } }')
    expect(r.errors).toBeUndefined()
    expect(r.data?.['store']).toEqual({
      name: 'Juniper Linen',
      tagline: 'Linen for slow days',
      contactEmail: 'shop@juniper.example',
      contactPhone: null,
      logo: { url: url(files.logo) },
      favicon: { url: url(files.favicon) },
      social: [{ network: 'instagram', url: 'https://www.instagram.com/juniper.linen' }, { network: 'whatsapp', url: 'https://wa.me/919876543210' }],
      seo: { title: 'Juniper linen', description: 'Handwoven in Jaipur.', image: { url: url(files.photo) } },
    })
    // A store with no brand saved keeps Store info's face, and has no search words yet.
    expect((await shop(t.storeB1, '{ store { tagline social { url } seo { title } } }')).data?.['store']).toEqual({ tagline: null, social: [], seo: null })
    const shopStore = (await shop(t.storeA1, '{ __type(name: "ShopStore") { fields { name } } }')).data?.['__type'] as { fields: { name: string }[] }
    expect(shopStore.fields.map((f) => f.name).filter((n) => /colou?r|voice/i.test(n))).toEqual([])
    // The shopper may fetch the brand's files and the share image, and no other store's.
    const fetchable = (storeId: string, id: string) =>
      withScope(db.sql, { caller: { kind: 'shopper', customerId: null }, partnerId: storeId === t.storeB1 ? t.partnerB : t.partnerA, storeId, sellerScope: { kind: 'all' }, subscription: 'active' }, async (tx) => (await selectShopAsset(tx, storeId, id)) !== null)
    expect([await fetchable(t.storeA1, files.favicon), await fetchable(t.storeA1, files.photo), await fetchable(t.storeB1, files.favicon)]).toEqual([true, true, false])
    await expect(withScope(db.sql, { caller: { kind: 'shopper', customerId: null }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' }, subscription: 'active' }, (tx) => tx`select primary_colour from storefront_brand`)).rejects.toThrow(/permission denied/)
  })

  it('moves the Shop API’s cache version when the brand or the search words change', async () => {
    const version = async () => (await db.sql<{ v: string }[]>`select catalog_version::text as v from storefront where store_id = ${t.storeA1}`)[0]?.v
    const before = await version()
    await saveBrand('owner', { logoAssetId: files.logo, tagline: 'A new line' })
    const between = await version()
    await saveSeo('owner', { title: 'Another title' })
    expect([before !== between, between !== (await version())]).toEqual([true, true])
  })

  it('freezes them into the snapshot a publish builds from, so the next publish of any kind carries them', async () => {
    await db.sql`insert into design_draft (store_id, head_commit, template, core_version) values (${t.storeA1}, ${'b'.repeat(40)}, 'linen', '1.0.0')`
    await saveBrand('owner', { logoAssetId: files.logo, faviconAssetId: files.favicon, tagline: 'Linen for slow days', social: { instagram: '@juniper.linen' }, primaryColour: '#1f4e3d', voice: 'Warm' })
    await saveSeo('owner', { title: 'Juniper linen', shareImageAssetId: files.photo })
    const drafts = fakeSites()
    const bytes = new TextEncoder().encode('draft').buffer
    await drafts.put(draftBundle(t.storeA1), bytes, { sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('') })
    const started = await withSystemScope(db.sql, (tx) =>
      startPublish(tx, { storeId: t.storeA1, kind: 'design', commit: 'b'.repeat(40), template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: now() }),
    )
    const runId = started.ok ? started.runId : ''
    expect(await freezeBuild({ sql: db.sql, drafts, assetOrigin: null, shopDomain: 'shop.example', mapsFrameOrigin: null, dispatch: async () => true, now }, t.storeA1, runId)).toBe('frozen')
    const snapshot = JSON.parse((await (await drafts.get(snapshotFile(t.storeA1, runId)))?.text()) ?? '{}') as { store: Record<string, unknown> }
    expect(snapshot.store).toMatchObject({
      tagline: 'Linen for slow days',
      favicon: { url: `/shop-api/assets/${files.favicon}` },
      social: [{ network: 'instagram', url: 'https://www.instagram.com/juniper.linen' }],
      seo: { title: 'Juniper linen', description: null, image: { url: `/shop-api/assets/${files.photo}` } },
    })
    expect(JSON.stringify(snapshot.store)).not.toMatch(/1f4e3d|Warm/)
  })
})
