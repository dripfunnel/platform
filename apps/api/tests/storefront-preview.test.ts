import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { previewLinks, previewLinkSeconds, type PreviewLinks } from '#auth/previewLink'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { StorefrontEdge } from '../src/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #317 part 3: "Open preview" in the Store API and the access re-check behind every preview page (storefront
// PREVIEW.md §5, §6).

let db: TestDatabase
let t: Tenants
let links: PreviewLinks
const linkKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(3)))
const domain = 'preview.localhost'
const now = new Date('2026-10-11T09:00:00Z')
type Who = 'owner' | 'manager' | 'supplier' | 'bOwner'
const people: Record<Who, string> = { owner: '', manager: '', supplier: '', bOwner: '' }
const cookies: Record<Who, string> = { owner: '', manager: '', supplier: '', bOwner: '' }
const keys = { a1: '', b1: '' }

const user = async (partnerId: string, email: string) =>
  (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${email}, 'active') returning id`)[0]?.id ?? ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  links = await previewLinks(linkKey)
  await db.sql`update store set status = 'active' where id in (${t.storeA1}, ${t.storeB1})`
  people.owner = await user(t.partnerA, 'owner@a.example')
  people.manager = await user(t.partnerA, 'manager@a.example')
  people.supplier = await user(t.partnerA, 'supplier@a.example')
  people.bOwner = await user(t.partnerB, 'owner@b.example')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.manager}, ${t.storeA1}, 'manager', 'active'), (${people.bOwner}, ${t.storeB1}, 'owner', 'active')`
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${people.supplier}, ${t.storeA1}, ${t.sellerA1First}, 'supplier-admin', 'active')`
  for (const who of Object.keys(cookies) as Who[]) cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: who === 'bOwner' ? t.partnerB : t.partnerA }, now))
  await db.sql`insert into design_draft (store_id, head_commit, template, core_version, preview_deploy_ref) values (${t.storeA1}, ${'a'.repeat(40)}, 'linen', '1.0.0', 'change-2')`
  const rows = await db.sql<{ store_id: string; preview_key: string }[]>`select store_id, preview_key from storefront where store_id in (${t.storeA1}, ${t.storeB1})`
  keys.a1 = rows.find((r) => r.store_id === t.storeA1)?.preview_key ?? ''
  keys.b1 = rows.find((r) => r.store_id === t.storeB1)?.preview_key ?? ''
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const openPreview = async (who: Who, preview: StoreContext['preview'] = { domain, links }) => {
  const partnerId = who === 'bOwner' ? t.partnerB : t.partnerA
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: who === 'bOwner' ? t.storeB1 : t.storeA1, ...(who === 'supplier' ? { [supplierHeader]: t.sellerA1First } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: activityLog, facts, preview, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source: 'mutation { openStorefrontPreview }', contextValue })
  return { url: (result.data?.['openStorefrontPreview'] as string | null | undefined) ?? null, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const tokenOf = (url: string | null) => new URL(url ?? 'https://x/').searchParams.get('t') ?? ''

const ctx = { waitUntil: (promise: Promise<unknown>) => promise, passThroughOnException: () => undefined } as unknown as ExecutionContext
const edge = (extra: Record<string, unknown> = {}) =>
  new StorefrontEdge(ctx, { ADMIN_HOST: 'admin.localhost', PLATFORM_HOST: 'platform.localhost', HOOKS_HOST: 'hooks.localhost', HYPERDRIVE: { connectionString: db.url }, PREVIEW_DOMAIN: domain, PREVIEW_LINK_KEY: linkKey, ...extra } as never)

describe('Open preview', () => {
  it('gives the Owner a link to the store’s own preview host that names nobody, and logs that it did, never the link', async () => {
    const { url } = await openPreview('owner')
    expect(url).toMatch(new RegExp(`^https://${keys.a1}\\.preview\\.localhost/__open\\?t=[A-Za-z0-9_-]+$`))
    expect(url).not.toContain(people.owner)
    expect(url).not.toContain(t.storeA1)
    const grant = await links.open(tokenOf(url))
    expect(grant).toEqual({ storeId: t.storeA1, userId: people.owner, epoch: 0, expiresAt: Math.floor(now.getTime() / 1000) + previewLinkSeconds })
    const entries = await db.sql`select * from activity_log where action = 'storefront.preview_opened'`
    expect(entries).toHaveLength(1)
    expect(JSON.stringify(entries)).not.toContain(tokenOf(url))
    expect((await openPreview('bOwner')).url).toContain(`https://${keys.b1}.`)
  })

  it('refuses a seat that can’t publish, a supplier, and a Worker without the preview’s values', async () => {
    expect((await openPreview('manager')).code).toBe('FORBIDDEN')
    expect((await openPreview('supplier')).url).toBeNull()
    expect((await openPreview('owner', null)).code).toBe('NOT_CONNECTED')
  })
})

describe('the edge’s preview questions', () => {
  it('opens a link only on its own store’s preview host, and only while it lasts', async () => {
    const token = tokenOf((await openPreview('owner')).url)
    expect(await edge().openPreview(keys.a1, token)).toEqual({ ok: true, storeId: t.storeA1, userId: people.owner, epoch: 0, folder: 'change-2' })
    expect(await edge().openPreview(keys.b1, token)).toEqual({ ok: false })
    expect(await edge().openPreview(keys.a1, `${token.slice(0, -3)}AAA`)).toEqual({ ok: false })
    expect(await edge().openPreview('NOT-A-KEY', token)).toEqual({ ok: false })
    const old = await links.seal({ storeId: t.storeA1, userId: people.owner, epoch: 0, expiresAt: Math.floor(Date.now() / 1000) - 1 })
    expect(await edge().openPreview(keys.a1, old)).toEqual({ ok: false })
    expect(await edge({ PREVIEW_LINK_KEY: undefined }).openPreview(keys.a1, token)).toEqual({ ok: false })
  })

  it('re-checks every page: a moved revocation number, a removed or demoted member, or another store’s key closes it', async () => {
    const check = { key: keys.a1, storeId: t.storeA1, userId: people.owner, epoch: 0 }
    expect(await edge().previewAccess(check)).toMatchObject({ ok: true, folder: 'change-2' })
    expect(await edge().previewAccess({ ...check, key: keys.b1 })).toEqual({ ok: false })
    expect(await edge().previewAccess({ ...check, userId: people.manager })).toEqual({ ok: false })
    expect(await edge().previewAccess({ ...check, userId: people.bOwner })).toEqual({ ok: false })
    expect(await edge().previewAccess({ ...check, extra: 1 })).toEqual({ ok: false })
    await db.sql`update storefront set preview_epoch = 1 where store_id = ${t.storeA1}`
    expect(await edge().previewAccess(check)).toEqual({ ok: false })
    expect(await edge().previewAccess({ ...check, epoch: 1 })).toMatchObject({ ok: true })
    await db.sql`update membership set status = 'suspended' where user_id = ${people.owner} and store_id = ${t.storeA1}`
    expect(await edge().previewAccess({ ...check, epoch: 1 })).toEqual({ ok: false })
    await db.sql`update membership set status = 'active' where user_id = ${people.owner} and store_id = ${t.storeA1}`
    await db.sql`update store set status = 'closed', closed_at = now() where id = ${t.storeA1}`
    expect(await edge().previewAccess({ ...check, epoch: 1 })).toEqual({ ok: false })
    await db.sql`update store set status = 'active', closed_at = null where id = ${t.storeA1}`
  })

  it('throws, so the edge answers 503, when the database can’t be asked', async () => {
    await expect(edge({ HYPERDRIVE: undefined }).previewAccess({ key: keys.a1, storeId: t.storeA1, userId: people.owner, epoch: 0 })).rejects.toThrow()
  })
})
