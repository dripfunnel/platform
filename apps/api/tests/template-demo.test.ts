import { readFileSync } from 'node:fs'
import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { factsOf } from '#auth/activity'
import { isAssigned } from '#auth/assignment'
import { demoThemeCookie, resolveShopper } from '#auth/shopCaller'
import type { StaffMember, StaffRole } from '#auth/staff'
import { withScope, withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { allowanceFor } from '#saas/entitlements/index'
import { isReservedSlug } from '#saas/stores/slug'
import { createTemplateAdminService, lookupDemoSite } from '#saas/storefrontTemplates/index'
import { demoName, demoTemplateKind, fillDemo } from '#saas/storefrontTemplates/demo'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { fakeSites, putText, type FakeSites } from './support/sites'

// A category template's demo store (admin FIRST-RELEASE §11d, migration 0416): made by a Super admin's first Preview,
// hidden from every staff and partner list, filled with the category's sample and the template's preview, and opened
// on the open demo host, demo.<SHOP_DOMAIN>/?theme=<key> (storefront PREVIEW.md §9).

let db: TestDatabase
let t: Tenants
let sites: FakeSites
let house = ''
const now = new Date('2026-11-24T06:00:00Z')
const core = '1.0.0'
const domain = 'my-store.test'
const request = new Request('https://admin.dripfunnel.ai/api', { headers: { 'cf-ray': 'ray-test' } })
const staff = new Map<StaffRole, StaffMember>()
const assets = new Map<string, Uint8Array>()
const assetStore = { put: async (key: string, value: Uint8Array) => void assets.set(key, value), get: async () => null }

const admin = async <T = Record<string, unknown>>(source: string, role: StaffRole) => {
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
    templates: member ? createTemplateAdminService({ sql: db.sql, staff: member, activity: activityLog, facts: factsOf(request), shopDomain: domain, now: () => now }) : null,
  }
  const result = await graphql({ schema: adminSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as T | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

type Preview = { templatePreviewLink: { demo: string; url: string | null } }
const press = (role: StaffRole, key = 'fashion') => admin<Preview>(`mutation { templatePreviewLink(key: "${key}") { demo url } }`, role)
const demoId = async () => (await db.sql<{ id: string | null }[]>`select demo_store_id as id from storefront_template where key = 'fashion'`)[0]?.id ?? ''
const fill = (storeId: string) => fillDemo({ sql: db.sql, sites, assets: assetStore, activity: activityLog, now: () => now }, { storeId, template: 'fashion' })

const sampleCsv = ['handle,name,visible,sku,price,collection', 'tee-1,Tee 1,yes,TE-1,900,Tops;Dresses', 'tee-2,Tee 2,yes,TE-2,900,Dresses'].join('\n')

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  sites = fakeSites()
  house = (await db.sql<{ id: string }[]>`insert into partner (name, is_house, country) values ('DripFunnel', true, 'IN') returning id`)[0]?.id ?? ''
  for (const role of ['staff-super-admin', 'staff-support'] as const) {
    const [row] = await db.sql<{ id: string }[]>`insert into staff_user (sso_subject, email, name, role_key, status) values (${role}, ${`${role}@dripfunnel.example`}, ${role}, ${role}, 'active') returning id`
    staff.set(role, { id: row?.id ?? '', email: `${role}@dripfunnel.example`, name: role, role })
  }
  const [fashion] = await db.sql<{ id: string }[]>`select id from store_category where key = 'fashion_apparel'`
  await db.sql`insert into store_category_sample (category_id, file, currency, collections) values (${fashion?.id ?? ''}, ${sampleCsv}, 'INR', ${db.sql.json([
    { name: 'Tops', skus: ['TE-1'] },
    { name: 'Dresses', skus: ['TE-1', 'TE-2'] },
  ])})`
  await putText(sites, 'templates/current.json', JSON.stringify({ core }))
  const index = '<!doctype html><title>Thread</title>'
  const runtime = 'export {}'
  await putText(sites, `templates/${core}/themes/fashion/preview/files/index.html`, index, 'text/html')
  await putText(sites, `templates/${core}/themes/fashion/preview/files/assets/core/boot.js`, runtime, 'text/javascript')
  const sha = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('')
  await putText(
    sites,
    `templates/${core}/themes/fashion/preview/manifest.json`,
    JSON.stringify({ files: [{ path: 'index.html', sha256: await sha(index) }, { path: 'assets/core/boot.js', sha256: await sha(runtime) }] }),
  )
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('a template’s demo store', () => {
  it('isn’t made by a role that can’t manage categories', async () => {
    expect((await press('staff-support')).code).toBe('NO_DEMO')
    expect(await demoId()).toBe('')
  })

  it('says a template with no category has no preview', async () => {
    expect((await press('staff-super-admin', 'classic')).code).toBe('NOT_FOUND')
  })

  it('is made once by a Super admin’s first Preview, under the house partner, and its fill queued', async () => {
    expect((await press('staff-super-admin')).data?.templatePreviewLink).toEqual({ demo: 'creating', url: null })
    const id = await demoId()
    const [store] = await db.sql<{ name: string; partner_id: string; is_demo: boolean; status: string; pricing_currency: string }[]>`
      select name, partner_id, is_demo, status, pricing_currency from store where id = ${id}`
    expect(store).toEqual({ name: demoName, partner_id: house, is_demo: true, status: 'active', pricing_currency: 'INR' })
    expect(await db.sql`select 1 from outbox where store_id = ${id} and kind = ${demoTemplateKind}`).toHaveLength(1)
    expect(await db.sql`select 1 from activity_log where action = 'storefront_template.demo_created' and target_id = 'fashion'`).toHaveLength(1)
    // A second press while it fills makes nothing more.
    expect((await press('staff-super-admin')).data?.templatePreviewLink.demo).toBe('creating')
    expect(await db.sql`select 1 from store where is_demo`).toHaveLength(1)
  })

  it('is hidden from staff and partners, the house partner included', async () => {
    const id = await demoId()
    const member = staff.get('staff-support')
    const asStaff = await withScope(db.sql, { caller: { kind: 'staff', staffId: member?.id ?? '' } }, (tx) => tx`select 1 from store where id = ${id}`)
    expect(asStaff).toHaveLength(0)
    const [partnerUser] = await db.sql<{ id: string }[]>`insert into partner_user (partner_id, email, name, role_key, status) values (${house}, 'ravi@dripfunnel.example', 'Ravi', 'partner-owner', 'active') returning id`
    const asPartner = await withScope(db.sql, { caller: { kind: 'partner-user', partnerUserId: partnerUser?.id ?? '' }, partnerId: house }, (tx) => tx`select 1 from store where id = ${id}`)
    expect(asPartner).toHaveLength(0)
  })

  it('is set once and only under the house partner', async () => {
    await expect(db.sql`update store set is_demo = false where id = ${await demoId()}`).rejects.toThrow(/set once/)
    await expect(db.sql`insert into store (partner_id, name, code, is_demo) values (${t.partnerA}, 'Fake', 'fake', true)`).rejects.toThrow(/house partner/)
  })

  it('is filled with the logo, its category’s sample and the template’s preview, and allowed the sample’s products', async () => {
    const id = await demoId()
    expect(await fill(id)).toBe('filled')
    const [store] = await db.sql<{ logo: string | null; brand: string | null }[]>`
      select s.logo_asset_id as logo, b.logo_asset_id as brand from store s left join storefront_brand b on b.store_id = s.id where s.id = ${id}`
    expect(store?.logo).toBeTruthy()
    expect(store?.brand).toBe(store?.logo)
    expect([...assets.keys()]).toEqual([expect.stringMatching(new RegExp(`^stores/${id}/assets/[0-9a-f-]{36}\\.png$`))])
    expect(await db.sql`select 1 from catalog_import where store_id = ${id} and sample_category_id is not null`).toHaveLength(1)
    expect(sites.keys(`stores/${id}/preview/demo/`)).toEqual([`stores/${id}/preview/demo/assets/core/boot.js`, `stores/${id}/preview/demo/index.html`])
    const [owner] = await db.sql<{ user_id: string }[]>`select user_id from membership where store_id = ${id}`
    const context = { caller: { kind: 'person' as const, userId: owner?.user_id ?? '', sessionId: '' }, partnerId: house, storeId: id, sellerScope: { kind: 'all' as const }, subscription: 'active' as const }
    expect(await allowanceFor(db.sql, context, 'products', now)).toBe(50)
    // A retry adds nothing twice.
    expect(await fill(id)).toBe('filled')
    expect(assets.size).toBe(1)
    expect(await db.sql`select 1 from catalog_import where store_id = ${id}`).toHaveLength(1)
  })

  it('opens for every role once ready on the open demo address, each opening logged', async () => {
    const list = await admin<{ storefrontTemplates: { key: string; demo: string }[] }>('{ storefrontTemplates { key demo } }', 'staff-support')
    expect(list.data?.storefrontTemplates.find((x) => x.key === 'fashion')?.demo).toBe('ready')
    const opened = (await press('staff-support')).data?.templatePreviewLink
    expect(opened).toEqual({ demo: 'ready', url: `https://demo.${domain}/?theme=fashion` })
    expect(await withSystemScope(db.sql, (tx) => tx`select 1 from activity_log where action = 'storefront_template.preview_opened' and actor_kind = 'staff'`)).toHaveLength(1)
  })
})

describe('the demo host', () => {
  const shop = (cookie: string | null, session = '') =>
    resolveShopper(db.sql, new Request(`https://demo.${domain}/shop-api/graphql`, { headers: { ...(cookie === null ? {} : { cookie }), ...(session ? { 'x-shop-session': session } : {}) } }), `demo.${domain}`, domain)

  it('gives store-proxy a ready demo’s key, store and folder, by key or by name, and nothing for any other template', async () => {
    const ready = { ok: true, key: 'fashion', storeId: await demoId(), folder: 'demo' }
    expect(await lookupDemoSite(db.sql, 'fashion')).toEqual(ready)
    const [name] = await db.sql<{ name: string }[]>`select lower(name) as name from storefront_template where key = 'fashion'`
    expect(await lookupDemoSite(db.sql, name?.name)).toEqual(ready)
    expect(await lookupDemoSite(db.sql, 'classic')).toEqual({ ok: false })
    expect(await lookupDemoSite(db.sql, 'Fashion')).toEqual({ ok: false })
    expect(await lookupDemoSite(db.sql, '../x')).toEqual({ ok: false })
  })

  it('serves the Shop API for the template its cookie names, as a guest-only preview', async () => {
    const found = await shop(`a=b; ${demoThemeCookie}=fashion`, 'f'.repeat(64))
    expect(found.kind).toBe('found')
    if (found.kind !== 'found') return
    expect(found.shopper.context.storeId).toBe(await demoId())
    expect(found.shopper.preview).toBe(true)
    expect(found.shopper.context.caller).toMatchObject({ kind: 'shopper', customerId: null })
  })

  it('finds no store without a cookie, for a template with no demo, or for a real store', async () => {
    expect((await shop(null)).kind).toBe('unknown')
    expect((await shop(`${demoThemeCookie}=classic`)).kind).toBe('unknown')
    expect((await shop(`${demoThemeCookie}=../fashion`)).kind).toBe('unknown')
    const [real] = await db.sql<{ slug: string }[]>`select slug from store where id = ${t.storeA1}`
    expect((await shop(`${demoThemeCookie}=${real?.slug ?? ''}`)).kind).toBe('unknown')
  })

  it('is a name no store can take', () => {
    expect(isReservedSlug('demo')).toBe(true)
  })

  it('stops migration 0418 while a store holds the slug, and passes once none does', async () => {
    const migration = readFileSync(new URL('../migrations/0418_reserve_demo_slug.sql', import.meta.url), 'utf8')
    const [before] = await db.sql<{ slug: string }[]>`select slug from store where id = ${t.storeA1}`
    await db.sql`update store set slug = 'demo' where id = ${t.storeA1}`
    await expect(db.sql.unsafe(migration)).rejects.toThrow(/holds the slug "demo"/)
    await db.sql`update store set slug = ${before?.slug ?? null} where id = ${t.storeA1}`
    await db.sql.unsafe(migration)
  })
})
