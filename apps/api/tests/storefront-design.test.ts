import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { draftBundle, previewFolder } from '#saas/storefronts/index'
import { StudioRunner, type DraftsBucket } from '#saas/studio/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { sandboxProcess, type SandboxProcess } from './support/sandboxProcess'
import { fakeSites, putText, type FakeSites } from './support/sites'
import { seedStoreWorld, type StoreWorld } from './support/storeWorld'
import { localStudio } from './support/studio'

// Card #318 (SAPI 17), part 1: the template gallery, choosing a template and the Storefront overview on the Store API
// (FIRST-RELEASE §14, §19; SAAS §9.2), against the real database and the real sandbox; R2 is in memory.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 })

const core = '0.4.0'
const baselineDir = fileURLToPath(new URL('../../../packages/storefront-core/src/guard/fixtures/baseline/', import.meta.url))
const now = () => new Date('2026-10-12T09:00:00.000Z')

const walk = async (dir: string, prefix = ''): Promise<{ path: string; content: string }[]> =>
  (
    await Promise.all(
      (await readdir(join(dir, prefix))).map(async (name) => {
        const rel = prefix ? `${prefix}/${name}` : name
        return (await stat(join(dir, rel))).isDirectory() ? walk(dir, rel) : [{ path: rel, content: await readFile(join(dir, rel), 'utf8') }]
      }),
    )
  ).flat()

const memoryDrafts = () => {
  const objects = new Map<string, ArrayBuffer>()
  const bucket: DraftsBucket = {
    get: async (key) => {
      const bytes = objects.get(key)
      return bytes ? { arrayBuffer: async () => bytes } : null
    },
    put: async (key, value) => void objects.set(key, value),
    delete: async (key) => objects.delete(key),
  }
  return { bucket, objects }
}

let db: TestDatabase
let t: Tenants
let w: StoreWorld
let sites: FakeSites
const drafts = memoryDrafts()
const processes: SandboxProcess[] = []
const runners = new Map<string, StudioRunner>()
let host: SandboxProcess

const runnerOf = (storeId: string): StudioRunner => {
  const found = runners.get(storeId)
  if (found) return found
  const runner = new StudioRunner({
    db: (work) => work(db.sql),
    storeId,
    host: async () => host,
    drafts: drafts.bucket,
    sites,
    capacity: { acquire: async () => ({ granted: true }), release: async () => undefined },
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    onBundle: () => undefined,
  })
  runners.set(storeId, runner)
  return runner
}
const local = localStudio(() => db.sql, runnerOf)

const choose = (who: Parameters<StoreWorld['gql']>[0], key: string, keepWords: boolean) =>
  w.gql(who, 'mutation C($key: String!, $keep: Boolean!) { chooseTemplate(key: $key, keepWords: $keep) }', { key, keep: keepWords })

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  w = await seedStoreWorld(db.sql, t, { now, secrets: null, lookup: null, studio: local.studio })
  host = await sandboxProcess()
  processes.push(host)
  sites = fakeSites()
  const template = await walk(baselineDir)
  await putText(sites, `templates/${core}/skeleton.json`, JSON.stringify({ files: [{ path: 'package.json', content: '{"name":"store"}\n' }, { path: '.github/workflows/build.yml', content: 'on: workflow_dispatch\n' }] }))
  await putText(sites, `templates/${core}/themes/baseline/source.json`, JSON.stringify({ files: template }))
  // Linen, as ST 0 ships it: words in English only, another headline, its own look.
  const linen = template
    .filter((f) => !f.path.startsWith('content/hi/'))
    .map((f) => (f.path === 'content/en/pages.json' ? { ...f, content: f.content.replace('Made slowly, worn for years', 'Linen for slow days') } : f))
    .map((f) => (f.path === 'src/theme/styles/page.module.css' ? { ...f, content: `${f.content}\n.linen {\n  letter-spacing: 0.02em;\n}\n` } : f))
  await putText(sites, `templates/${core}/themes/linen/source.json`, JSON.stringify({ files: linen }))
  for (const storeId of [t.storeA1, t.storeA2, t.storeB1]) {
    await db.sql`update store set core_version = ${core}, main_language = 'en-IN' where id = ${storeId}`
    await db.sql`insert into store_language (store_id, language) values (${storeId}, 'en-IN'), (${storeId}, 'hi-IN') on conflict do nothing`
  }
  for (const storeId of [t.storeA1, t.storeB1]) {
    const [logo] = await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum) values (${storeId}, ${`stores/${storeId}/assets/${crypto.randomUUID()}.png`}, 'image', 'image/png', 10, ${'0'.repeat(64)}) returning id`
    await db.sql`insert into storefront_brand (store_id, logo_asset_id) values (${storeId}, ${logo?.id ?? ''})`
  }
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) select plan_id, partner_id, 1, 'history_days', 30 from store where plan_id is not null`
}, 180_000)

afterAll(async () => {
  for (const p of processes) await p.close()
  await db?.drop()
})

describe('the template gallery', () => {
  it('lists "Start from scratch" and the six templates; the Manager reads it, Staff and suppliers are refused', async () => {
    const read = await w.gql('owner', '{ storefrontTemplates { key name tag current demoUrl } }')
    const rows = read.data?.['storefrontTemplates'] as { key: string; current: boolean; demoUrl: string | null }[]
    expect(rows.map((r) => r.key)).toEqual(['baseline', 'linen', 'concrete', 'bloom', 'circuit', 'market', 'atelier'])
    expect(rows.some((r) => r.current)).toBe(false)
    expect(rows.every((r) => r.demoUrl === null)).toBe(true)
    expect((await w.gql('manager', '{ storefrontTemplates { key } }')).code).toBeUndefined()
    for (const who of ['staff', 'supplier'] as const) expect((await w.gql(who, '{ storefrontTemplates { key } }')).code).toBe('FORBIDDEN')
  })
})

describe('choosing a template', () => {
  it('is refused until the brand is ready, and for a template that isn’t offered', async () => {
    expect((await choose('a2Owner', 'linen', false)).code).toBe('BRAND_NOT_READY')
    expect((await choose('owner', 'nope', false)).code).toBe('INVALID_TEMPLATE')
  })

  it('is the Owner’s: the Manager, Staff and a supplier are refused', async () => {
    for (const who of ['manager', 'staff', 'supplier'] as const) expect((await choose(who, 'linen', false)).code).toBe('FORBIDDEN')
  })

  it('the first time starts the create-storefront Workflow through the outbox, once', async () => {
    const first = await choose('owner', 'linen', false)
    expect(first).toMatchObject({ code: undefined, data: { chooseTemplate: 'creating' } })
    const queued = await db.sql<{ payload: { template: string; storeId: string } }[]>`select payload from outbox where kind = 'storefront.create' and store_id = ${t.storeA1}`
    expect(queued.map((q) => q.payload)).toEqual([expect.objectContaining({ template: 'linen', storeId: t.storeA1 })])
    expect((await choose('owner', 'bloom', false)).code).toBe('IN_PROGRESS')
    const [logged] = await db.sql<{ action: string; changes: unknown }[]>`select action, changes from activity_log where store_id = ${t.storeA1} and action = 'storefront.template_chosen'`
    expect(logged?.changes).toEqual([expect.objectContaining({ field: 'template', before: null, after: 'linen' }), expect.objectContaining({ field: 'words', before: null, after: 'template' })])
    const notes = await db.sql<{ role: string; text: string }[]>`select role, text from design_message where store_id = ${t.storeA1}`
    expect(notes).toEqual([{ role: 'note', text: 'template:linen' }])
    const status = await w.gql('owner', '{ storefront { status template draft { template } live { number } history { number } } }')
    expect(status.data?.['storefront']).toEqual({ status: 'creating', template: null, draft: null, live: null, history: [] })
  })

  it('later is a commit to the private draft with its preview, through the store’s own studio; nothing is pushed', async () => {
    await db.sql`update job set state = 'done' where store_id = ${t.storeB1} or store_id = ${t.storeA1}`
    await db.sql`update storefront set repo_state = 'ready', template = 'baseline', repo = 'sf-b1aaaaaaaa', repo_head = ${'a'.repeat(40)} where store_id = ${t.storeB1}`
    const pushes = async () => (await db.sql<{ n: number }[]>`select count(*)::int as n from storefront_push`)[0]?.n
    const before = await pushes()
    const chosen = await choose('bOwner', 'linen', true)
    expect(chosen).toMatchObject({ code: undefined, data: { chooseTemplate: 'not_published' } })
    const [draft] = await db.sql<{ head_commit: string; template: string; preview_deploy_ref: string; changed_by: string }[]>`
      select head_commit, template, preview_deploy_ref, changed_by from design_draft where store_id = ${t.storeB1}`
    expect(draft).toMatchObject({ template: 'linen', changed_by: w.people.bOwner })
    expect(drafts.objects.has(draftBundle(t.storeB1))).toBe(true)
    expect(sites.keys(previewFolder(t.storeB1, draft?.preview_deploy_ref ?? '')).length).toBeGreaterThan(0)
    expect(await pushes()).toBe(before)
    expect(local.calls.every((c) => c.storeId === c.contextStore)).toBe(true)
    expect(local.calls.some((c) => c.storeId === t.storeB1)).toBe(true)

    const again = await choose('bOwner', 'baseline', false)
    expect(again.code).toBeUndefined()
    const [moved] = await db.sql<{ head_commit: string; template: string }[]>`select head_commit, template from design_draft where store_id = ${t.storeB1}`
    expect(moved?.template).toBe('baseline')
    expect(moved?.head_commit).not.toBe(draft?.head_commit)
    const read = await w.gql('bOwner', '{ storefront { status template draft { template previewReady } } storefrontTemplates { key current } }')
    expect(read.data?.['storefront']).toEqual({ status: 'not_published', template: 'baseline', draft: { template: 'baseline', previewReady: true } })
    expect((read.data?.['storefrontTemplates'] as { key: string; current: boolean }[]).filter((r) => r.current).map((r) => r.key)).toEqual(['baseline'])
  })
})
