import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleAssets } from '#apis/store/assets'
import { withSystemScope } from '#db/scoped/index'
import type { AssetStore } from '#engine/modules/catalog/index'
import { createGitHubApp, storeRepos, type StoreRepos } from '#integrations/github/index'
import { localGitHub, type LocalGitHub } from '#integrations/local/github'
import { digestOf, handleRepoPush, runPublish, sameWorkflow, startPublish, type PublishDeps, type PublishSteps, type RepoPush } from '#saas/storefronts/index'
import { stagingFolder } from '#saas/storefronts/layout'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { testProbe } from './support/edgeProbe'
import { fakeSites, putText, type FakeSites } from './support/sites'
import { seedStoreWorld, type StoreWorld, type Who } from './support/storeWorld'

// #1415: once a push to a store repo's main is live, the images in its src/theme/media/ that Storefront › Assets
// doesn't hold yet are copied there, named after their files (storefront LIVE-SHOP.md §4 "A push to `main`" step 7, AI-STUDIO.md §8).

let db: TestDatabase
let t: Tenants
let w: StoreWorld
let github: LocalGitHub
let repos: StoreRepos
const repoOf: Record<string, string> = {}
const repoIds: Record<string, string> = {}
const stored = new Map<string, Uint8Array>()
const files: AssetStore = { put: async (key, value) => void stored.set(key, value), get: async () => null }

/** A PNG's signature and header, `width` making each one's bytes its own. */
const png = (width: number) => {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, 10)
  return bytes
}
const media = (name: string, bytes: Uint8Array | null) => ({ path: `src/theme/media/${name}`, content: bytes === null ? null : github.binary(bytes) })
const banner = (words: string) => ({ path: 'src/theme/components/Banner.tsx', content: `export const Banner = () => <p>${words}</p>\n` })

const steps: PublishSteps = { do: (_, work) => work(), waitFor: async () => undefined }
const sites: FakeSites = fakeSites()
const assets: FakeSites = fakeSites()
const deps = (): PublishDeps => ({
  sql: db.sql,
  sites,
  assets,
  drafts: fakeSites(),
  assetOrigin: null,
  shopDomain: 'shop.example',
  mapsFrameOrigin: null,
  dispatch: async () => true,
  fetchSource: async (_, commit) => new TextEncoder().encode(`bundle of ${commit}`).buffer,
  workflowIntact: async (repo, known) => sameWorkflow(repos, repo, known, (await repos.head(repo)) ?? ''),
  now: () => new Date(),
  probe: testProbe(db.sql, { sites, assets }),
  assetHost: 'sf-assets.my-store.one',
  wait: async () => undefined,
  repoMedia: { read: repos.themeMedia, files },
})

const commitOn = async (repo: string, changes: { path: string; content: string | null }[]) => {
  const head = (await repos.head(repo)) ?? ''
  const tree = await repos.writeTree(repo, await repos.treeOf(repo, head), changes)
  const commit = await repos.commit(repo, { tree, parent: head, message: 'A hand edit', at: new Date() })
  await repos.advance(repo, commit)
  return commit
}
const pushed = (storeId: string, commit: string): RepoPush => ({ repoId: repoIds[storeId] ?? '', commit, pusher: 'dev-one' })
const lastRun = async (storeId: string) => (await db.sql<{ id: string }[]>`select id from publish_run where store_id = ${storeId} order by created_at desc limit 1`)[0]?.id ?? ''
const live = async (storeId: string) => (await db.sql<{ live_build_id: string | null }[]>`select live_build_id from storefront where store_id = ${storeId}`)[0]?.live_build_id ?? null

/** The run's passing report and upload, as the build's calls leave them; then the rest of its publish. */
const goLive = async (storeId: string, runId: string, s: PublishSteps = steps) => {
  const d = deps()
  const html = `<p>${runId}</p>`
  const uploaded = await Promise.all(['index.html', 'checkout/index.html'].map(async (path) => ({ path, sha256: await putText(sites, `${stagingFolder(storeId, runId)}${path}`, html), size: html.length })))
  await db.sql`
    update publish_run set state = 'deploying', started_at = now(), gate = ${db.sql.json({ passed: true, checks: [] })}, gate_digest = ${await digestOf(uploaded)},
      uploaded_at = now(), upload_manifest = ${db.sql.json({ files: uploaded })} where id = ${runId}`
  return runPublish(d, { runId, storeId }, s)
}
/** A person's push to main, built and put live as a `repo` publish. */
const pushLive = async (storeId: string, changes: { path: string; content: string | null }[], s: PublishSteps = steps) => {
  const commit = await commitOn(repoOf[storeId] ?? '', changes)
  expect(await handleRepoPush({ sql: db.sql, repos, now: () => new Date() }, pushed(storeId, commit))).toBe('started')
  const runId = await lastRun(storeId)
  expect(await goLive(storeId, runId, s)).toBe('live')
  expect(await live(storeId)).toBe(runId)
  return commit
}

const library = async (who: Who) =>
  ((await w.gql(who, 'query { libraryAssets { assets { id kind mime name } } }')).data?.['libraryAssets'] as { assets: { id: string; kind: string; mime: string; name: string | null }[] }).assets
const named = async (who: Who, name: string) => (await library(who)).filter((a) => a.name === name)
const copies = (storeId: string) =>
  db.sql<{ actor_kind: string; reason: string | null; changes: { field: string; after: string }[] }[]>`
    select actor_kind, reason, changes from activity_log where store_id = ${storeId} and action = 'asset.uploaded' and reason = 'repo_push' order by occurred_at`

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  w = await seedStoreWorld(db.sql, t, { now: () => new Date(), secrets: null, lookup: null, extra: { files } })
  await db.sql`update store set status = 'active' where id in (${t.storeA1}, ${t.storeB1})`
  await db.sql`update partner set state = 'live' where id in (${t.partnerA}, ${t.partnerB})`
  github = localGitHub({ org: 'dripfunnel', installationId: '42', appId: '7' })
  const { privateKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey))))}\n-----END PRIVATE KEY-----`
  repos = storeRepos(createGitHubApp({ appId: '7', installationId: '42', privateKey: pem, fetchImpl: github.fetch, sleep: async () => undefined }).session(), 'dripfunnel')
  for (const [storeId, repo] of [
    [t.storeA1, 'sf-imgpush001'],
    [t.storeB1, 'sf-imgpush002'],
  ] as const) {
    const { id } = await repos.create(repo)
    repoOf[storeId] = repo
    repoIds[storeId] = String(id)
    const first = (await repos.head(repo)) ?? ''
    const tree = await repos.writeTree(repo, null, [{ path: 'package.json', content: '{"name":"store"}\n' }, { path: '.github/workflows/build.yml', content: 'on: workflow_dispatch\n' }, banner('Welcome')])
    const main = await repos.commit(repo, { tree, parent: first, message: 'Start from the linen template', at: new Date() })
    await repos.advance(repo, main)
    await db.sql`update storefront set repo = ${repo}, repo_id = ${id}, repo_state = 'ready', repo_head = ${main}, template = 'linen' where store_id = ${storeId}`
    // The store's first live build, as the merchant's first Publish leaves it.
    const started = await withSystemScope(db.sql, (tx) =>
      startPublish(tx, { storeId, kind: 'manual', commit: main, template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: new Date() }),
    )
    expect(await goLive(storeId, started.ok ? started.runId : '')).toBe('live')
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('a live push’s theme images', () => {
  it('copies each into Storefront › Assets, named after its file, by the system, naming the commit', async () => {
    const commit = await pushLive(t.storeA1, [media('hero.png', png(1)), media('logo-mark.png', png(2))])
    expect((await named('owner', 'hero')).map((a) => [a.kind, a.mime])).toEqual([['image', 'image/png']])
    expect(await named('owner', 'logo-mark')).toHaveLength(1)
    const made = await db.sql<{ created_by: string | null; seller_id: string | null; r2_key: string }[]>`select created_by, seller_id, r2_key from asset where store_id = ${t.storeA1} and name in ('hero', 'logo-mark')`
    expect(made.map((a) => [a.created_by, a.seller_id])).toEqual([
      [null, null],
      [null, null],
    ])
    for (const a of made) expect(stored.get(a.r2_key)?.byteLength).toBe(33)
    const entries = await copies(t.storeA1)
    expect(entries).toHaveLength(2)
    for (const e of entries) expect(e).toMatchObject({ actor_kind: 'job', changes: [{ field: 'commit', after: commit }] })
  })

  it('adds nothing for the same push delivered again, or a later push holding the same images', async () => {
    const before = (await library('owner')).length
    const head = (await repos.head(repoOf[t.storeA1] ?? '')) ?? ''
    expect(await handleRepoPush({ sql: db.sql, repos, now: () => new Date() }, pushed(t.storeA1, head))).toBe('own_commit')
    await pushLive(t.storeA1, [banner('Spring sale')])
    expect(await library('owner')).toHaveLength(before)
    expect(await copies(t.storeA1)).toHaveLength(2)
  })

  it('skips an image whose bytes the merchant already uploaded to Assets', async () => {
    const ctx = await w.context('owner')
    const upload = await handleAssets(new Request('https://store.example/api/assets', { method: 'POST', body: png(3) }), ctx, files)
    expect(upload.status).toBe(200)
    const before = (await library('owner')).length
    await pushLive(t.storeA1, [media('uploaded-too.png', png(3))])
    expect(await library('owner')).toHaveLength(before)
    expect(await named('owner', 'uploaded-too')).toEqual([])
  })

  it('keeps the copy when a later push removes the image from the repo', async () => {
    await pushLive(t.storeA1, [media('hero.png', null)])
    expect(await named('owner', 'hero')).toHaveLength(1)
  })

  it('brings back a copy the merchant deleted once, when a later push still holds it', async () => {
    const [mark] = await named('owner', 'logo-mark')
    expect((await w.gql('owner', 'mutation D($i: ID!) { deleteLibraryAsset(id: $i) }', { i: mark?.id })).data?.['deleteLibraryAsset']).toBe(true)
    expect(await named('owner', 'logo-mark')).toEqual([])
    await pushLive(t.storeA1, [banner('Summer sale')])
    expect(await named('owner', 'logo-mark')).toHaveLength(1)
    await pushLive(t.storeA1, [banner('Autumn sale')])
    expect(await named('owner', 'logo-mark')).toHaveLength(1)
  })

  it('copies nothing for a design, page or catalogue publish, even of a commit holding a new image', async () => {
    const commit = await commitOn(repoOf[t.storeA1] ?? '', [media('not-pushed.png', png(4))])
    await db.sql`update storefront set repo_head = ${commit} where store_id = ${t.storeA1}`
    // Every step answered as a live publish's would, but the push and the copy, which run.
    const answers: Record<string, string> = { claim: 'claimed', catalogue: '-1', reported: 'passed', verdict: 'passed', checked: 'go', uploaded: 'uploaded', inherit: '0', switch: 'switched', checks: 'passed', confirm: 'live' }
    const pushAndMedia: PublishSteps = { do: async (name, work) => (name === 'push' || name === 'media' ? work() : (answers[name] ?? 'done')), waitFor: async () => undefined }
    for (const kind of ['design', 'page', 'manual', 'automatic'] as const) {
      const started = await withSystemScope(db.sql, (tx) =>
        startPublish(tx, { storeId: t.storeA1, kind, commit, template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: new Date(), ...(kind === 'page' ? { render: { pages: ['/'], drop: [] } } : {}) }),
      )
      const runId = started.ok ? started.runId : ''
      expect(await runPublish(deps(), { runId, storeId: t.storeA1 }, pushAndMedia), kind).toBe('live')
      await db.sql`update publish_run set state = 'failed', error = 'deploy_failed' where id = ${runId}`
    }
    expect(await named('owner', 'not-pushed')).toEqual([])
  })

  it('keeps the publish live when the read fails, and the step’s retry copies', async () => {
    const trees = /^GET \/repos\/dripfunnel\/sf-imgpush001\/git\/trees\/[0-9a-f]{40}\?recursive=1$/
    github.fail(trees, 422)
    await pushLive(t.storeA1, [media('after-failure.png', png(5))])
    expect(await named('owner', 'after-failure')).toEqual([])
    // The Workflow's step retries (publish-storefront.ts `stepConfig`): one failed attempt, then the copy.
    const retrying: PublishSteps = {
      do: async (name, work) => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await work()
          } catch (error) {
            if (name !== 'media' || attempt >= 3) throw error
          }
        }
      },
      waitFor: async () => undefined,
    }
    github.fail(trees, 422)
    await pushLive(t.storeA1, [banner('Retried')], retrying)
    expect(await named('owner', 'after-failure')).toHaveLength(1)
  })
})

describe('isolation', () => {
  it('copies an image another store already has, and never shows it in that store’s Assets', async () => {
    const bBefore = await library('bOwner')
    await pushLive(t.storeB1, [media('shared.png', png(1))])
    expect(await named('bOwner', 'shared')).toHaveLength(1)
    const aIds = (await library('owner')).map((a) => a.id)
    const bIds = (await library('bOwner')).map((a) => a.id)
    expect(bIds.filter((id) => aIds.includes(id))).toEqual([])
    expect(bIds).toHaveLength(bBefore.length + 1)
    expect(await named('owner', 'shared')).toEqual([])
    expect(await copies(t.storeB1)).toHaveLength(1)
  })
})
