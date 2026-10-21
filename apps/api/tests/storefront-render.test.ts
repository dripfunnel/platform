import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { withSystemScope } from '#db/scoped/index'
import { indexNowDeliverer } from '#jobs/queues/deliverers/indexNow'
import { storefrontRenderDeliverer } from '#jobs/queues/deliverers/storefrontRender'
import { GiveUp, type Effect } from '#jobs/queues/outbox-relay'
import { IndexNowRefused, type IndexNow } from '#integrations/indexnow/client'
import { cleanStorefronts, digestOf, indexNowSubmission, lookupRedirects, renderInputs, runPublish, startPublish, type PublishDeps, type PublishSteps } from '#saas/storefronts/index'
import { buildFolder, snapshotFile, sourceBundle, stagingFolder } from '#saas/storefronts/layout'
import { freezeBuild } from '#saas/storefronts/freeze'
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
const host = 'store-a1.shop.example'
const commit = (n: number) => n.toString(16).padStart(40, '0')
const steps: PublishSteps = { do: (_, work) => work(), waitFor: async () => undefined }
const deps = (): PublishDeps => ({ sql: db.sql, sites, assets, drafts: fakeSites(), assetOrigin: null, shopDomain: 'shop.example', mapsFrameOrigin: null, dispatch: async () => true, now: () => new Date(), probe, assetHost: 'sf-assets.my-store.one', wait: async () => undefined })
const signal = new AbortController().signal
const effect = (kind: string, payload: unknown): Effect => ({ id: 'e', kind, idempotencyKey: 'k', payload, partnerId: null, storeId: null, attempt: 1 })

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set status = 'active' where id in (${t.storeA1}, ${t.storeA2})`
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
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
    update publish_run set state = 'deploying', started_at = now(), gate = ${db.sql.json({ passed: true, checks: [] })}, gate_digest = ${await digestOf(manifest)}, uploaded_at = now(),
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
    const submission = await indexNowSubmission({ sql: db.sql, sites, shopDomain: 'shop.example' }, { storeId: t.storeA1, buildId: render, previousBuildId: base })
    expect(submission?.host).toBe(host)
    expect(submission?.key).toMatch(/^[a-f0-9]{32}$/)
    expect(submission?.urls).toEqual([`https://${host}/products/blue-mug/`, `https://${host}/products/mug/`])
    const sent: { urls: readonly string[] }[] = []
    const client: IndexNow = { submit: async (s) => void sent.push(s) }
    await indexNowDeliverer(db.sql, sites, client, 'shop.example').deliver(effect('storefront.indexnow', queuedNow?.payload), signal)
    expect(sent.map((s) => s.urls)).toEqual([submission?.urls])
    const refusing: IndexNow = { submit: async () => Promise.reject(new IndexNowRefused('answered 403')) }
    await expect(indexNowDeliverer(db.sql, sites, refusing, 'shop.example').deliver(effect('storefront.indexnow', queuedNow?.payload), signal)).rejects.toBeInstanceOf(GiveUp)
  })

  it('never tells IndexNow about the pages a build serves for missing addresses, wherever its `_edge.json` puts them', async () => {
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()]
    const write = async (build: string, files: Record<string, string>, edge: unknown) => {
      for (const [path, text] of Object.entries(files)) await putText(sites, `${buildFolder(t.storeA1, build)}${path}`, text)
      const manifest = await Promise.all(Object.entries(files).map(async ([path, text]) => ({ path, sha256: await putText(sites, `${buildFolder(t.storeA1, build)}${path}`, text), size: text.length })))
      await putText(sites, `${buildFolder(t.storeA1, build)}_manifest.json`, JSON.stringify({ files: manifest }))
      await putText(sites, `${buildFolder(t.storeA1, build)}_edge.json`, JSON.stringify(edge))
    }
    const edge = { redirects: [], fallbacks: [{ prefix: '/products/', page: '/products/_/' }], notFound: '/not-found.html' }
    await write(a, { 'index.html': 'one', 'not-found.html': 'missing one', 'products/_/index.html': 'shell one' }, edge)
    await write(b, { 'index.html': 'two', 'not-found.html': 'missing two', 'products/_/index.html': 'shell two' }, edge)
    const submission = await indexNowSubmission({ sql: db.sql, sites, shopDomain: 'shop.example' }, { storeId: t.storeA1, buildId: b, previousBuildId: a })
    expect(submission?.urls).toEqual([`https://${host}/`])
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

describe('isolation', () => {
  it('queues a product change in store B for store B alone, and never reads another store’s live build, folder or key', async () => {
    await db.sql`update store set status = 'active' where id = ${t.storeB1}`
    const started = await withSystemScope(db.sql, (tx) =>
      startPublish(tx, { storeId: t.storeB1, kind: 'design', commit: commit(9), template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: new Date() }),
    )
    const baseB = started.ok ? started.runId : ''
    await stage(t.storeB1, baseB, { 'index.html': html('B home'), 'checkout/index.html': html('B checkout'), 'products/secret/index.html': html('B secret') })
    expect(await runPublish(deps(), { runId: baseB, storeId: t.storeB1 }, steps)).toBe('live')
    const before = (await db.sql`select 1 from outbox where kind = 'storefront.render' and store_id = ${t.storeA1}`).length
    await db.sql`insert into product (store_id, name, slug, visibility) values (${t.storeB1}, 'Vase', 'vase', 'visible')`
    const queued = await db.sql<{ store_id: string; payload: { storeId: string } }[]>`select store_id, payload from outbox where kind = 'storefront.render' and payload->>'storeId' = ${t.storeB1}`
    expect(queued.map((q) => [q.store_id, q.payload.storeId])).toEqual([[t.storeB1, t.storeB1]])
    expect((await db.sql`select 1 from outbox where kind = 'storefront.render' and store_id = ${t.storeA1}`).length).toBe(before)

    // Store A's page run renders beside store A's live build, with store A's assets.
    const liveA = await live(t.storeA1)
    const page = await withSystemScope(db.sql, (tx) =>
      startPublish(tx, { storeId: t.storeA1, kind: 'page', commit: commit(1), template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: new Date(), render: { pages: ['/'], drop: [] } }),
    )
    const pageA = page.ok ? page.runId : ''
    const inputs = await renderInputs(db.sql, pageA)
    expect(inputs?.assetsBuildId).not.toBe(baseB)
    expect([liveA, base]).toContain(inputs?.assetsBuildId)
    await stage(t.storeA1, pageA, { 'index.html': html('A home again') })
    expect(await runPublish(deps(), { runId: pageA, storeId: t.storeA1 }, steps)).toBe('live')
    expect([...snapshotOf(buildFolder(t.storeA1, pageA)).values()].join('')).not.toContain('B ')

    // IndexNow for store A names store A's host and key; a build of store B named under store A reads nothing of B's.
    const keys = await db.sql<{ store_id: string; indexnow_key: string }[]>`select store_id, indexnow_key from storefront where store_id in (${t.storeA1}, ${t.storeB1})`
    const keyOf = (id: string) => keys.find((k) => k.store_id === id)?.indexnow_key
    const submission = await indexNowSubmission({ sql: db.sql, sites, shopDomain: 'shop.example' }, { storeId: t.storeA1, buildId: pageA, previousBuildId: liveA })
    expect(submission?.key).toBe(keyOf(t.storeA1))
    expect(submission?.urls.every((u) => u.startsWith(`https://${host}/`))).toBe(true)
    const forged = await indexNowSubmission({ sql: db.sql, sites, shopDomain: 'shop.example' }, { storeId: t.storeA1, buildId: baseB, previousBuildId: null })
    expect(forged).toBeNull()
  })
})

describe('a page run’s frozen input', () => {
  it('points its pages at the live build’s JS and CSS', async () => {
    const liveA = (await live(t.storeA1)) ?? ''
    const [assetsOf] = await db.sql<{ id: string }[]>`select coalesce(assets_build_id, id) as id from publish_run where id = ${liveA}`
    const started = await withSystemScope(db.sql, (tx) =>
      startPublish(tx, { storeId: t.storeA1, kind: 'page', commit: commit(1), template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: new Date(), render: { pages: ['/'], drop: [] } }),
    )
    const runId = started.ok ? started.runId : ''
    const drafts = fakeSites()
    await putText(drafts, sourceBundle(t.storeA1, liveA), 'bundle')
    const frozen = { sql: db.sql, drafts, assetOrigin: 'https://sf-assets.my-store.one', shopDomain: 'shop.example', mapsFrameOrigin: 'https://hooks.dripfunnel.com', dispatch: async () => true, now: () => new Date() }
    expect(await freezeBuild(frozen, t.storeA1, runId)).toBe('frozen')
    const snapshot = JSON.parse((await (await drafts.get(snapshotFile(t.storeA1, runId)))?.text()) ?? '{}') as { assetBase: string; csp: { mapsFrameOrigin?: string } }
    expect(snapshot.assetBase).toBe(`https://sf-assets.my-store.one/stores/${t.storeA1}/builds/${assetsOf?.id ?? ''}/assets/`)
    expect(snapshot.csp.mapsFrameOrigin).toBe('https://hooks.dripfunnel.com')
    await db.sql`delete from outbox where payload->>'runId' = ${runId}`
    await db.sql`delete from publish_run where id = ${runId}`
  })
})

describe('a page run that waited', () => {
  it('builds the live commit and core as they are when it starts, so a publish that went live meanwhile keeps its core', async () => {
    // A publish upgrading core runs; a product's render is asked for meanwhile, from the build live then.
    const upgrade = await withSystemScope(db.sql, (tx) =>
      startPublish(tx, { storeId: t.storeA1, kind: 'design', commit: commit(77), template: 'linen', coreVersion: '1.1.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: new Date() }),
    )
    const upgradeId = upgrade.ok ? upgrade.runId : ''
    await db.sql`update publish_run set state = 'building' where id = ${upgradeId}`
    await storefrontRenderDeliverer(db.sql, () => new Date()).deliver(effect('storefront.render', { storeId: t.storeA1, pages: ['/products/late'], drop: [] }), signal)
    const [waiting] = await queued(t.storeA1)
    expect(waiting?.kind).toBe('page')
    await stage(t.storeA1, upgradeId, { 'index.html': html('upgraded'), 'checkout/index.html': html('checkout') })
    expect(await runPublish(deps(), { runId: upgradeId, storeId: t.storeA1 }, steps)).toBe('live')
    // The page run starts now, beside the upgraded build: its report and upload are in, and it was never claimed.
    await stage(t.storeA1, waiting?.id ?? '', { 'products/late/index.html': html('late') })
    await db.sql`update publish_run set state = 'queued' where id = ${waiting?.id ?? ''}`
    // Its passing report moves it to deploying, as the build's `report` call does (builds.ts).
    const reported: PublishSteps = { ...steps, do: async (name, work) => (name === 'verdict' ? (await db.sql`update publish_run set state = 'deploying' where id = ${waiting?.id ?? ''}`, work()) : work()) }
    expect(await runPublish(deps(), { runId: waiting?.id ?? '', storeId: t.storeA1 }, reported)).toBe('live')
    const [run] = await db.sql<{ commit: string; core_version: string }[]>`select commit, core_version from publish_run where id = ${waiting?.id ?? ''}`
    expect(run).toEqual({ commit: commit(77), core_version: '1.1.0' })
    const [store] = await db.sql<{ core_version: string }[]>`select core_version from store where id = ${t.storeA1}`
    expect(store?.core_version).toBe('1.1.0')
  })
})

