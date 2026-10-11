import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { withSystemScope } from '#db/scoped/index'
import { indexNowDeliverer } from '#jobs/queues/deliverers/indexNow'
import { storefrontRenderDeliverer } from '#jobs/queues/deliverers/storefrontRender'
import { GiveUp, type Effect } from '#jobs/queues/outbox-relay'
import { IndexNowRefused, type IndexNow } from '#integrations/indexnow/client'
import { cleanStorefronts, digestOf, indexNowSubmission, lookupRedirects, renderInputs, runPublish, startPublish, type PublishDeps, type PublishSteps } from '#saas/storefronts/index'
import { buildFolder, stagingFolder } from '#saas/storefronts/layout'
import { createTestDatabase, type TestDatabase } from './support/database'
import { testProbe, type TestProbe } from './support/edgeProbe'
import { seedTenants, type Tenants } from './support/fixtures'
import { fakeSites, putText, type FakeSites } from './support/sites'

// Card #484 (INF 5) part 2: the single-page render (storefront LIVE-SHOP.md §7): a new or renamed product's page at once,
// in a new build folder completed from the live build's, with its sitemap, the old address's 301 and IndexNow.

let db: TestDatabase
let t: Tenants
let sites: FakeSites
let assets: FakeSites
let probe: TestProbe
const host = 'store-a1.shops.acme.example'
const commit = (n: number) => n.toString(16).padStart(40, '0')
const steps: PublishSteps = { do: (_, work) => work(), waitForUpload: async () => undefined }
const deps = (): PublishDeps => ({ sql: db.sql, sites, assets, now: () => new Date(), probe, assetHost: 'sf-assets.dripfunnel.com', wait: async () => undefined })
const signal = new AbortController().signal
const effect = (kind: string, payload: unknown): Effect => ({ id: 'e', kind, idempotencyKey: 'k', payload, partnerId: null, storeId: null, attempt: 1 })

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set status = 'active' where id in (${t.storeA1}, ${t.storeA2})`
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x')`
  await db.sql`insert into store_language (store_id, language, status, position) values (${t.storeA1}, 'hi-IN', 'active', 1) on conflict do nothing`
  sites = fakeSites()
  assets = fakeSites()
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

beforeEach(() => {
  probe = testProbe(db.sql, { sites, assets })
})

const html = (text: string) => `<!doctype html><title>${text}</title>`
/** Stages `files` for a run that passed its gate, as #517's build calls leave it. */
const stage = async (storeId: string, runId: string, files: Record<string, string>) => {
  const manifest = await Promise.all(Object.entries(files).map(async ([path, text]) => ({ path, sha256: await putText(sites, `${stagingFolder(storeId, runId)}${path}`, text), size: new TextEncoder().encode(text).length })))
  await db.sql`
    update publish_run set gate = ${db.sql.json({ passed: true, checks: [] })}, gate_digest = ${await digestOf(manifest)}, uploaded_at = now(),
      upload_manifest = ${db.sql.json({ files: manifest })} where id = ${runId}`
}
const renderOutbox = (storeId: string) =>
  db.sql<{ id: string; payload: { storeId: string; pages: string[]; drop: string[] } }[]>`select id, payload from outbox where kind = 'storefront.render' and store_id = ${storeId} and delivered_at is null order by created_at`
const deliverRenders = async (storeId: string) => {
  for (const row of await renderOutbox(storeId)) {
    await storefrontRenderDeliverer(db.sql, () => new Date()).deliver(effect('storefront.render', row.payload), signal)
    await db.sql`update outbox set delivered_at = now() where id = ${row.id}`
  }
}
const queued = (storeId: string) => db.sql<{ id: string; kind: string; uses_allowance: boolean; render: { pages: string[]; drop: string[] } | null }[]>`select id, kind, uses_allowance, render from publish_run where store_id = ${storeId} and state = 'queued'`
const live = async (storeId: string) => (await db.sql<{ live_build_id: string | null }[]>`select live_build_id from storefront where store_id = ${storeId}`)[0]?.live_build_id ?? null
const snapshotOf = (prefix: string) => new Map([...sites.objects].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), new TextDecoder().decode(v.bytes)]))

let productId = ''
let base = ''

describe('a render request', () => {
  it('asks nothing of a store with no live build: its first publish has every page', async () => {
    await db.sql`insert into product (store_id, name, slug, visibility) values (${t.storeA2}, 'Lamp', 'lamp', 'visible')`
    expect(await renderOutbox(t.storeA2)).toEqual([])
  })

  it('publishes the store whole first', async () => {
    const started = await withSystemScope(db.sql, (tx) =>
      startPublish(tx, { storeId: t.storeA1, kind: 'design', commit: commit(1), template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: new Date() }),
    )
    base = started.ok ? started.runId : ''
    await stage(t.storeA1, base, { 'index.html': html('home'), 'checkout/index.html': html('checkout'), 'products/mug/index.html': html('mug'), 'sitemap.xml': '<urlset/>', 'assets/app.js': 'console.log(1)' })
    expect(await runPublish(deps(), { runId: base, storeId: t.storeA1 }, steps)).toBe('live')
  })

  it('asks for a new visible product’s page in every language, and for a renamed one’s new pages without the old', async () => {
    const [row] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${t.storeA1}, 'Mug', 'mug', 'hidden') returning id`
    productId = row?.id ?? ''
    expect(await renderOutbox(t.storeA1)).toEqual([])
    await db.sql`update product set visibility = 'visible' where id = ${productId}`
    await db.sql`update product set slug = 'blue-mug' where id = ${productId}`
    expect((await renderOutbox(t.storeA1)).map((r) => r.payload)).toEqual([
      { storeId: t.storeA1, pages: ['/products/mug', '/hi-in/products/mug'], drop: [] },
      { storeId: t.storeA1, pages: ['/products/blue-mug', '/hi-in/products/blue-mug'], drop: ['/products/mug', '/hi-in/products/mug'] },
    ])
  })

  it('becomes one waiting page run of the live commit, using no allowance', async () => {
    // A run in progress keeps the page run waiting, so the two requests merge into it.
    await db.sql`update publish_run set state = 'building' where id = ${base}`
    await deliverRenders(t.storeA1)
    await db.sql`update publish_run set state = 'live' where id = ${base}`
    const [run] = await queued(t.storeA1)
    expect(run).toMatchObject({ kind: 'page', uses_allowance: false, render: { pages: ['/products/blue-mug', '/hi-in/products/blue-mug'], drop: ['/products/mug', '/hi-in/products/mug'] } })
    expect(await renderInputs(db.sql, run?.id ?? '')).toEqual({ pages: run?.render?.pages, assetsBuildId: base })
  })

  it('widens into the full publish pressed behind it, and into an automatic one past the page limit', async () => {
    const [waiting] = await queued(t.storeA1)
    const pressed = await withSystemScope(db.sql, (tx) =>
      startPublish(tx, { storeId: t.storeA1, kind: 'manual', commit: commit(1), template: 'linen', coreVersion: '1.0.0', usesAllowance: true, startedBy: { kind: 'system', id: null }, at: new Date() }),
    )
    expect(pressed).toEqual({ ok: true, runId: waiting?.id })
    expect(await queued(t.storeA1)).toMatchObject([{ kind: 'manual', uses_allowance: true, render: null }])
    await db.sql`delete from outbox where kind like 'storefront.%' and payload->>'runId' = ${waiting?.id ?? ''}`
    await db.sql`delete from publish_run where id = ${waiting?.id ?? ''}`
    const many = Array.from({ length: 120 }, (_, i) => `/products/p${i}`)
    await db.sql`update publish_run set state = 'building' where id = ${base}`
    for (const pages of [many.slice(0, 40), many.slice(40, 80), many.slice(80)]) await storefrontRenderDeliverer(db.sql, () => new Date()).deliver(effect('storefront.render', { storeId: t.storeA1, pages, drop: [`${pages[0] ?? ''}-old`] }), signal)
    await db.sql`update publish_run set state = 'live' where id = ${base}`
    const [widened] = await queued(t.storeA1)
    expect(widened).toMatchObject({ kind: 'automatic', uses_allowance: false, render: null })
    await db.sql`delete from publish_run where id = ${widened?.id ?? ''}`
  })
})

describe('a single-page render', () => {
  let render = ''

  it('writes a new build folder with the rendered page and sitemap and the live build’s other files, leaving the old address out', async () => {
    const before = snapshotOf(buildFolder(t.storeA1, base))
    const usage = await db.sql`select key, used from store_usage where store_id = ${t.storeA1} order by key`
    const started = await withSystemScope(db.sql, (tx) =>
      startPublish(tx, { storeId: t.storeA1, kind: 'page', commit: commit(1), template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: new Date(), render: { pages: ['/products/blue-mug'], drop: ['/products/mug'] } }),
    )
    render = started.ok ? started.runId : ''
    expect(await db.sql`select 1 from outbox where kind = 'storefront.render_page' and payload->>'runId' = ${render}`).toHaveLength(1)
    await stage(t.storeA1, render, { 'products/blue-mug/index.html': html('blue mug'), 'sitemap.xml': '<urlset><url>blue-mug</url></urlset>' })
    expect(await runPublish(deps(), { runId: render, storeId: t.storeA1 }, steps)).toBe('live')

    expect(await live(t.storeA1)).toBe(render)
    const folder = snapshotOf(buildFolder(t.storeA1, render))
    expect([...folder.keys()].sort()).toEqual(['_manifest.json', 'assets/app.js', 'checkout/index.html', 'index.html', 'products/blue-mug/index.html', 'sitemap.xml'])
    expect(folder.get('sitemap.xml')).toContain('blue-mug')
    expect(folder.get('index.html')).toBe(html('home'))
    const manifest = JSON.parse(folder.get('_manifest.json') ?? '{}') as { files: { path: string }[] }
    expect(manifest.files.map((f) => f.path)).toEqual(['assets/app.js', 'checkout/index.html', 'index.html', 'products/blue-mug/index.html', 'sitemap.xml'])
    // The live build's folder is never changed in place.
    expect(snapshotOf(buildFolder(t.storeA1, base))).toEqual(before)
    // No allowance: the run doesn't count, and no meter moved.
    const [run] = await db.sql<{ uses_allowance: boolean; assets_build_id: string; kind: string }[]>`select uses_allowance, assets_build_id, kind from publish_run where id = ${render}`
    expect(run).toEqual({ uses_allowance: false, assets_build_id: base, kind: 'page' })
    expect(await db.sql`select key, used from store_usage where store_id = ${t.storeA1} order by key`).toEqual(usage)
    // The same version, now built by the render.
    expect(await db.sql`select number, state, build_id from design_version where store_id = ${t.storeA1}`).toEqual([{ number: 1, state: 'live', build_id: render }])
  })

  it('answers the renamed product’s old address with a 301 to the new one', async () => {
    const { redirects } = await lookupRedirects(db.sql, t.storeA1)
    expect(redirects).toEqual(expect.arrayContaining([{ from: '/products/mug', to: '/products/blue-mug', everyLanguage: false }, { from: '/hi-in/products/mug', to: '/hi-in/products/blue-mug', everyLanguage: false }]))
  })

  it('tells IndexNow the pages that changed or went, on the store’s own address', async () => {
    const [queuedNow] = await db.sql<{ payload: { storeId: string; buildId: string; previousBuildId: string } }[]>`select payload from outbox where kind = 'storefront.indexnow' and payload->>'buildId' = ${render}`
    expect(queuedNow?.payload).toEqual({ storeId: t.storeA1, buildId: render, previousBuildId: base })
    const submission = await indexNowSubmission({ sql: db.sql, sites }, { storeId: t.storeA1, buildId: render, previousBuildId: base })
    expect(submission?.host).toBe(host)
    expect(submission?.key).toMatch(/^[a-f0-9]{32}$/)
    expect(submission?.urls).toEqual([`https://${host}/products/blue-mug/`, `https://${host}/products/mug/`])
    const sent: { urls: readonly string[] }[] = []
    const client: IndexNow = { submit: async (s) => void sent.push(s) }
    await indexNowDeliverer(db.sql, sites, client).deliver(effect('storefront.indexnow', queuedNow?.payload), signal)
    expect(sent.map((s) => s.urls)).toEqual([submission?.urls])
    const refusing: IndexNow = { submit: async () => Promise.reject(new IndexNowRefused('answered 403')) }
    await expect(indexNowDeliverer(db.sql, sites, refusing).deliver(effect('storefront.indexnow', queuedNow?.payload), signal)).rejects.toBeInstanceOf(GiveUp)
  })

  it('keeps the build whose JS and CSS its pages load through clean-up', async () => {
    await db.sql`update publish_run set finished_at = now() - interval '30 days' where id = ${base}`
    // Twenty newer builds would push the first past the kept ones; only the render still names it.
    for (let n = 0; n < 21; n++) {
      await db.sql`insert into publish_run (store_id, kind, state, commit, template, core_version, started_by_kind, finished_at, switched_at) values (${t.storeA1}, 'manual', 'live', ${commit(50 + n)}, 'linen', '1.0.0', 'system', now(), now())`
    }
    await cleanStorefronts(db.sql, { sites, assets, drafts: fakeSites() }, new Date())
    expect((await db.sql<{ files_deleted_at: Date | null }[]>`select files_deleted_at from publish_run where id = ${base}`)[0]?.files_deleted_at).toBeNull()
    expect(sites.keys(buildFolder(t.storeA1, base)).length).toBeGreaterThan(0)
  })

  it('rolls a render whose checks fail back to the build it replaced, the same version again', async () => {
    const started = await withSystemScope(db.sql, (tx) =>
      startPublish(tx, { storeId: t.storeA1, kind: 'page', commit: commit(1), template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: new Date(), render: { pages: ['/'], drop: [] } }),
    )
    const home = started.ok ? started.runId : ''
    await stage(t.storeA1, home, { 'index.html': html('new home') })
    probe.breakPath(/^\/checkout$/, { status: 500 })
    expect(await runPublish(deps(), { runId: home, storeId: t.storeA1 }, steps)).toBe('rolled_back')
    expect(await live(t.storeA1)).toBe(render)
    expect(await db.sql`select number, state, build_id from design_version where store_id = ${t.storeA1}`).toEqual([{ number: 1, state: 'live', build_id: render }])
  })

  it('re-renders the home page when its search and sharing are saved, with no allowance (#471 queues it)', async () => {
    await storefrontRenderDeliverer(db.sql, () => new Date()).deliver(effect('storefront.render', { storeId: t.storeA1, pages: ['/'], drop: [] }), signal)
    const [run] = await queued(t.storeA1)
    expect(run).toMatchObject({ kind: 'page', uses_allowance: false, render: { pages: ['/'], drop: [] } })
    await stage(t.storeA1, run?.id ?? '', { 'index.html': html('home, new words') })
    expect(await runPublish(deps(), { runId: run?.id ?? '', storeId: t.storeA1 }, steps)).toBe('live')
    expect(snapshotOf(buildFolder(t.storeA1, run?.id ?? '')).get('index.html')).toBe(html('home, new words'))
  })

  it('refuses a request that isn’t a list of plain addresses', async () => {
    const deliver = (payload: unknown) => storefrontRenderDeliverer(db.sql, () => new Date()).deliver(effect('storefront.render', payload), signal)
    await expect(deliver({ storeId: t.storeA1, pages: ['//evil.example/'], drop: [] })).rejects.toBeInstanceOf(GiveUp)
    await expect(deliver({ storeId: t.storeA1, pages: [], drop: [] })).rejects.toBeInstanceOf(GiveUp)
  })
})
