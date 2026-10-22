import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withSystemScope } from '#db/scoped/index'
import { freezeBuild, startPublish } from '#saas/storefronts/index'
import { draftBundle, snapshotFile } from '#saas/storefronts/layout'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { fakeSites } from './support/sites'
import { seedStoreWorld, type StoreWorld, type Who } from './support/storeWorld'

// Card #680: a store's pages may be framed by its partner's live portal (storefront ARCHITECTURE §3.5), so the Overview
// shows the live site (FIRST-RELEASE §14); a build from before then refuses every frame, and the Overview says so.

let db: TestDatabase
let t: Tenants
let w: StoreWorld
const now = () => new Date('2026-10-13T09:00:00.000Z')
const drafts = fakeSites()

const portal = (partnerId: string, host: string, status: string) =>
  db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${partnerId}, 'portal', ${host}, ${status}, 'CNAME', 'x')`

/** The CSP a design publish's snapshot hands the build. */
const frozenCsp = async (): Promise<Record<string, unknown>> => {
  await db.sql`delete from publish_run where store_id = ${t.storeA1} and state = 'building'`
  const started = await withSystemScope(db.sql, (tx) =>
    startPublish(tx, { storeId: t.storeA1, kind: 'design', commit: 'b'.repeat(40), template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: now() }),
  )
  if (!started.ok) throw new Error('the publish did not start')
  expect(await freezeBuild({ sql: db.sql, drafts, assetOrigin: null, shopDomain: 'shop.example', mapsFrameOrigin: null, dispatch: async () => true, now }, t.storeA1, started.runId)).toBe('frozen')
  return (JSON.parse((await (await drafts.get(snapshotFile(t.storeA1, started.runId)))?.text()) ?? '{}') as { csp: Record<string, unknown> }).csp
}

/** A build that went live with these pages' headers in its upload (LIVE-SHOP §4 step 8). */
const liveBuild = async (pages: Record<string, string>, kind = 'design', assetsBuildId: string | null = null): Promise<string> => {
  const files = Object.entries(pages).map(([path, csp]) => ({ path, sha256: '0'.repeat(64), size: 1, headers: { 'content-security-policy': csp } }))
  const [run] = await db.sql<{ id: string }[]>`
    insert into publish_run (store_id, kind, state, commit, template, core_version, started_by_kind, gate, gate_digest, uploaded_at, upload_manifest, assets_build_id, render)
    values (${t.storeA1}, ${kind}, 'live', ${'b'.repeat(40)}, 'linen', '1.0.0', 'system', '{}', ${'0'.repeat(64)}, now(), ${db.sql.json({ files })}, ${assetsBuildId},
      ${kind === 'page' ? db.sql.json({ pages: [], drop: [] }) : null})
    returning id`
  const id = run?.id ?? ''
  await db.sql`update storefront set live_build_id = ${id} where store_id = ${t.storeA1}`
  return id
}

const overviewLive = async (who: Who) => ((await w.gql(who, '{ storefront { live { number portalOrigin } } }')).data?.['storefront'] as { live: { number: number; portalOrigin: string | null } | null }).live

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  w = await seedStoreWorld(db.sql, t, { now, secrets: null, lookup: null })
  await db.sql`update store set status = 'active', pricing_currency = 'INR' where id = ${t.storeA1}`
  await db.sql`insert into design_draft (store_id, head_commit, template, core_version) values (${t.storeA1}, ${'b'.repeat(40)}, 'linen', '1.0.0')`
  const bytes = new TextEncoder().encode('draft').buffer
  await drafts.put(draftBundle(t.storeA1), bytes, { sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('') })
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('the snapshot a publish builds from', () => {
  it('carries the partner’s portal only once it is live, and never another partner’s', async () => {
    await portal(t.partnerB, 'shop.bravo.example', 'live')
    expect(await frozenCsp()).not.toHaveProperty('portalOrigin')
    await portal(t.partnerA, 'shop.acme.example', 'verifying')
    expect(await frozenCsp()).not.toHaveProperty('portalOrigin')
    await db.sql`update partner_domain set status = 'live' where host = 'shop.acme.example'`
    expect(await frozenCsp()).toEqual({ assetOrigin: null, mediaOrigins: [], analytics: [], payments: [], portalOrigin: 'https://shop.acme.example' })
  })
})

describe('the Overview’s live version', () => {
  it('names the portal the live home page lets frame it, to the Owner and the Manager alike', async () => {
    const build = await liveBuild({ 'index.html': "default-src 'none'; frame-ancestors https://shop.acme.example; base-uri 'none'", 'cart/index.html': "frame-ancestors 'none'" })
    await db.sql`insert into design_version (store_id, number, commit, template, core_version, build_id, published_at, state) values (${t.storeA1}, 7, ${'b'.repeat(40)}, 'linen', '1.0.0', ${build}, now(), 'live')`
    expect(await overviewLive('owner')).toEqual({ number: 7, portalOrigin: 'https://shop.acme.example' })
    expect(await overviewLive('manager')).toEqual({ number: 7, portalOrigin: 'https://shop.acme.example' })
  })

  it('names none for a build from before, whose pages refuse every frame', async () => {
    await liveBuild({ 'index.html': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" })
    expect(await overviewLive('owner')).toEqual({ number: 7, portalOrigin: null })
  })

  it('reads a page run’s home page from the build it renders beside, unless it rendered the home page itself', async () => {
    const full = await liveBuild({ 'index.html': "frame-ancestors https://shop.acme.example" })
    await liveBuild({ 'products/kurta/index.html': "frame-ancestors https://shop.acme.example" }, 'page', full)
    expect(await overviewLive('owner')).toEqual({ number: 7, portalOrigin: 'https://shop.acme.example' })
    await liveBuild({ 'index.html': "frame-ancestors 'none'" }, 'page', full)
    expect(await overviewLive('owner')).toEqual({ number: 7, portalOrigin: null })
  })
})
