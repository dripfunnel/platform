import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TenantContext } from '#core/tenancy'
import type { StoreRole } from '#auth/storePermissions'
import { draftBundle, previewFolder, sourceBundle, upgradeBundle, upgradeFiles } from '#saas/storefronts/index'
import { liveStudioSession, openStudioSession, renewStudio, studioOf, StudioRunner, StudioUnavailable, type DesignModel, type DraftsBucket, type Proposal, type StudioDeps } from '#saas/studio/index'
import { sandboxClient } from '#integrations/sandbox/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { sandboxProcess, type SandboxProcess } from './support/sandboxProcess'
import { fakeSites, putText, type FakeSites } from './support/sites'

// INF 3 (#482): the studio's change loop against the real sandbox (apps/sandbox in its own process, real git and the
// real fast gate) and the real database; R2 and the model are stand-ins (storefront AI-STUDIO.md §3–§8).
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 })

const core = '0.4.0'
const baselineDir = fileURLToPath(new URL('../../../packages/storefront-core/src/guard/fixtures/baseline/', import.meta.url))

const walk = async (dir: string, prefix = ''): Promise<{ path: string; content: string }[]> =>
  (
    await Promise.all(
      (await readdir(join(dir, prefix))).map(async (name) => {
        const rel = prefix ? `${prefix}/${name}` : name
        return (await stat(join(dir, rel))).isDirectory() ? walk(dir, rel) : [{ path: rel, content: await readFile(join(dir, rel), 'utf8') }]
      }),
    )
  ).flat()

/** The private drafts bucket in memory, counting its writes. */
const memoryDrafts = () => {
  const objects = new Map<string, { bytes: ArrayBuffer }>()
  const puts: string[] = []
  const bucket: DraftsBucket = {
    get: async (key) => {
      const o = objects.get(key)
      return o ? { arrayBuffer: async () => o.bytes } : null
    },
    put: async (key, value) => {
      puts.push(key)
      objects.set(key, { bytes: value })
    },
  }
  return { bucket, objects, puts }
}

let db: TestDatabase
let t: Tenants
let template: { path: string; content: string }[]
const processes: SandboxProcess[] = []

const enPages = () => template.find((f) => f.path === 'content/en/pages.json')?.content ?? ''
const lead = (words: string) => ({ path: 'content/en/pages.json', content: enPages().replace(/"lead": "[^"]*"/, `"lead": "${words}"`) })
const refusedPage = { path: 'src/theme/pages/HomePage.tsx', content: "export const HomePage = () => { fetch('/x'); return null }\n" }

/** A model that answers from a script, one answer per ask, and records what it was asked. */
const scripted = (answers: Proposal['files'][], gate?: Promise<void>) => {
  const asks: { problems: number }[] = []
  const model: DesignModel = {
    propose: async (input) => {
      asks.push({ problems: input.problems.length })
      await gate
      const files = answers[Math.min(asks.length - 1, answers.length - 1)] ?? []
      return { files, model: 'test-model', tokensIn: 120, tokensOut: 80, costAmount: 3, costCurrency: 'USD' }
    },
  }
  return { model, asks }
}

const seedUser = async (storeId: string, partnerId: string, role: string, email: string) => {
  const [user] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, 'Studio', 'active') returning id`
  const userId = user?.id ?? ''
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${userId}, ${storeId}, ${role}, 'active')`
  const sessionHash = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
  await db.sql`insert into user_session (id_hash, user_id, partner_id, absolute_expires_at) values (${sessionHash}, ${userId}, ${partnerId}, now() + interval '1 day')`
  return { userId, sessionHash }
}

const contextFor = (storeId: string, partnerId: string, userId: string, sessionId: string): TenantContext => ({
  caller: { kind: 'person', userId, sessionId },
  partnerId,
  storeId,
  sellerScope: { kind: 'all' },
  subscription: 'active',
})

const owner: StoreRole = { side: 'merchant', role: 'owner' }
const manager: StoreRole = { side: 'merchant', role: 'manager' }
const staff: StoreRole = { side: 'merchant', role: 'staff' }
const supplier: StoreRole = { side: 'supplier', role: 'supplier-admin', tier: 'vendor-catalogue' }

let sites: FakeSites
let drafts: ReturnType<typeof memoryDrafts>
let ownerA: { userId: string; sessionHash: string }

const runnerFor = async (storeId: string, overrides: Partial<StudioDeps> = {}) => {
  const host = await sandboxProcess()
  processes.push(host)
  const released: string[] = []
  const bundles: string[] = []
  const runner = new StudioRunner({
    db: (work) => work(db.sql),
    storeId,
    host: async () => host,
    drafts: drafts.bucket,
    sites,
    capacity: { acquire: async () => ({ granted: true }), release: async () => void released.push(storeId) },
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    onBundle: (b) => void bundles.push(b.id),
    ...overrides,
  })
  return { runner, host, bundles, released }
}

const draftRow = async (storeId: string) => (await db.sql<{ head_commit: string; preview_deploy_ref: string | null; changed_by: string | null }[]>`select head_commit, preview_deploy_ref, changed_by from design_draft where store_id = ${storeId}`)[0] ?? null

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  template = await walk(baselineDir)
  for (const storeId of [t.storeA1, t.storeA2, t.storeB1]) {
    await db.sql`update store set core_version = ${core} where id = ${storeId}`
    await db.sql`update storefront set template = 'baseline', repo_state = 'ready', repo = ${`sf-${storeId.replaceAll('-', '').slice(0, 10)}`} where store_id = ${storeId}`
    await db.sql`insert into store_language (store_id, language) values (${storeId}, 'en-IN'), (${storeId}, 'hi-IN') on conflict do nothing`
    await db.sql`update store set main_language = 'en-IN' where id = ${storeId}`
  }
  ownerA = await seedUser(t.storeA1, t.partnerA, 'owner', 'owner.a1@studio.example')
})

beforeEach(async () => {
  sites = fakeSites()
  drafts = memoryDrafts()
  await putText(sites, `templates/${core}/skeleton.json`, JSON.stringify({ files: [{ path: 'package.json', content: '{"name":"store"}\n' }, { path: '.github/workflows/build.yml', content: 'on: workflow_dispatch\n' }] }))
  await putText(sites, `templates/${core}/themes/baseline/source.json`, JSON.stringify({ files: template }))
  await db.sql`delete from ai_run`
  await db.sql`delete from design_draft`
})

afterAll(async () => {
  for (const p of processes) await p.close()
  await db.drop()
})

describe('one change', () => {
  it('becomes a local commit, saved as the draft bundle, written as the new preview, and undo reverts it', async () => {
    const { runner, bundles } = await runnerFor(t.storeA1)
    const { model } = scripted([[lead('Linen made slowly, for warm days.')]])
    const changed = await runner.change({ request: 'Make the lead warmer', userId: ownerA.userId, billedTo: 'plan', model })
    expect(changed).toMatchObject({ outcome: 'changed', repairs: 0 })
    if (changed.outcome !== 'changed') return
    expect(drafts.objects.has(draftBundle(t.storeA1))).toBe(true)
    expect(sites.objects.has(`${previewFolder(t.storeA1, changed.previewRef)}index.html`)).toBe(true)
    expect([...sites.objects.keys()].some((k) => k.startsWith(previewFolder(t.storeA1, changed.previewRef)) && k.includes('assets/core/'))).toBe(false)
    expect(await draftRow(t.storeA1)).toEqual({ head_commit: changed.commit, preview_deploy_ref: changed.previewRef, changed_by: ownerA.userId })
    expect(bundles.length).toBeGreaterThanOrEqual(2)

    const undone = await runner.undo(changed.commit, ownerA.userId)
    expect(undone).toMatchObject({ outcome: 'changed' })
    if (undone.outcome !== 'changed') return
    expect((await draftRow(t.storeA1))?.head_commit).toBe(undone.commit)
    expect(undone.previewRef).not.toBe(changed.previewRef)
    const [run] = await db.sql<{ kind: string; billed_to: string; sandbox_ms: number; outcome: string }[]>`select kind, billed_to, sandbox_ms, outcome from ai_run where store_id = ${t.storeA1}`
    expect(run).toMatchObject({ kind: 'design', billed_to: 'plan', outcome: 'changed' })
    expect(run?.sandbox_ms).toBeGreaterThan(0)
  })

  it('is refused after three repairs with nothing changed, and records the three repairs on the platform', async () => {
    const { runner } = await runnerFor(t.storeA2)
    await runner.open()
    const before = { drafts: drafts.puts.length, sites: sites.objects.size }
    const { model, asks } = scripted([[refusedPage]])
    const refused = await runner.change({ request: 'Fetch something', userId: ownerA.userId, billedTo: 'own_key', model })
    expect(refused).toMatchObject({ outcome: 'refused', repairs: 3 })
    expect(asks).toEqual([{ problems: 0 }, { problems: 1 }, { problems: 1 }, { problems: 1 }])
    expect({ drafts: drafts.puts.length, sites: sites.objects.size }).toEqual(before)
    expect(await draftRow(t.storeA2)).toBeNull()
    const runs = await db.sql<{ kind: string; billed_to: string; parent_run_id: string | null; outcome: string; repair_attempts: number }[]>`
      select kind, billed_to, parent_run_id, outcome, repair_attempts from ai_run where store_id = ${t.storeA2} order by kind, created_at`
    expect(runs.map((r) => [r.kind, r.billed_to, r.outcome])).toEqual([
      ['design', 'own_key', 'refused'],
      ['repair', 'platform', 'refused'],
      ['repair', 'platform', 'refused'],
      ['repair', 'platform', 'refused'],
    ])
    expect(runs[0]?.repair_attempts).toBe(3)
    expect(new Set(runs.slice(1).map((r) => r.parent_run_id))).toEqual(new Set([refused.runId]))
  })

  it('takes a repair that passes the gate', async () => {
    const { runner } = await runnerFor(t.storeA2)
    const { model } = scripted([[refusedPage], [lead('Repaired on the second try.')]])
    expect(await runner.change({ request: 'A change needing one repair', userId: ownerA.userId, billedTo: 'plan', model })).toMatchObject({ outcome: 'changed', repairs: 1 })
    const runs = await db.sql<{ kind: string; outcome: string }[]>`select kind, outcome from ai_run where store_id = ${t.storeA2} order by kind`
    expect(runs).toEqual([
      { kind: 'design', outcome: 'changed' },
      { kind: 'repair', outcome: 'changed' },
    ])
  })
})

describe('a model that fails partway', () => {
  it('meters the asks already made as failed, and changes nothing', async () => {
    const { runner } = await runnerFor(t.storeA2)
    let asks = 0
    const flaky: DesignModel = {
      propose: async () => {
        asks += 1
        if (asks === 3) throw new Error('model unavailable')
        return { files: [refusedPage], model: 'test-model', tokensIn: 10, tokensOut: 5, costAmount: 1, costCurrency: 'USD' }
      },
    }
    await expect(runner.change({ request: 'Fails on the third ask', userId: ownerA.userId, billedTo: 'plan', model: flaky })).rejects.toThrow(/model unavailable/)
    const runs = await db.sql<{ kind: string; billed_to: string; outcome: string }[]>`select kind, billed_to, outcome from ai_run where store_id = ${t.storeA2} order by kind`
    expect(runs).toEqual([
      { kind: 'design', billed_to: 'plan', outcome: 'failed' },
      { kind: 'repair', billed_to: 'platform', outcome: 'refused' },
    ])
    expect(await draftRow(t.storeA2)).toBeNull()
  })
})

describe('a failed load', () => {
  it('stops the container it started and gives back its place', async () => {
    const empty = fakeSites()
    const { runner, host, released } = await runnerFor(t.storeA2, { sites: empty })
    await expect(runner.open()).rejects.toThrow(/missing/)
    expect(host.starts()).toBe(1)
    expect(host.running()).toBe(false)
    expect(released).toEqual([t.storeA2])
    expect(runner.loaded).toBe(false)
  })
})

describe('one change at a time', () => {
  it('runs two requests for one store one after the other, and two stores side by side', async () => {
    let releaseA: () => void = () => undefined
    const gateA = new Promise<void>((resolve) => (releaseA = resolve))
    const a = await runnerFor(t.storeA1)
    const b = await runnerFor(t.storeB1)
    const first = scripted([[lead('First of two.')]], gateA)
    const second = scripted([[lead('Second of two.')]])
    const one = a.runner.change({ request: 'First', userId: ownerA.userId, billedTo: 'plan', model: first.model })
    const two = a.runner.change({ request: 'Second', userId: ownerA.userId, billedTo: 'plan', model: second.model })
    const other = scripted([[lead('Another store.')]])
    // Store B finishes while store A's first change is still waiting on its model.
    expect(await b.runner.change({ request: 'Other store', userId: ownerA.userId, billedTo: 'plan', model: other.model })).toMatchObject({ outcome: 'changed' })
    await vi.waitFor(() => expect(first.asks).toHaveLength(1))
    expect(a.runner.pending).toBe(2)
    expect(second.asks).toHaveLength(0)
    releaseA()
    const [r1, r2] = await Promise.all([one, two])
    expect(r1).toMatchObject({ outcome: 'changed' })
    expect(r2).toMatchObject({ outcome: 'changed' })
    expect((await draftRow(t.storeA1))?.head_commit).toBe(r2.outcome === 'changed' ? r2.commit : '')
  })
})

describe('a crash mid-change', () => {
  it('restarts the sandbox from the saved draft and tries the change once more', async () => {
    const { runner, host } = await runnerFor(t.storeA1)
    const saved = await runner.change({ request: 'Saved first', userId: ownerA.userId, billedTo: 'plan', model: scripted([[lead('Saved before the crash.')]]).model })
    expect(saved.outcome).toBe('changed')
    const savedHead = (await draftRow(t.storeA1))?.head_commit
    const crashing: DesignModel = {
      propose: async () => {
        if (host.starts() === 1) host.kill()
        return { files: [lead('After the restart.')], model: 'test-model', tokensIn: 1, tokensOut: 1, costAmount: 0, costCurrency: 'USD' }
      },
    }
    const retried = await runner.change({ request: 'Crashes once', userId: ownerA.userId, billedTo: 'plan', model: crashing })
    expect(host.starts()).toBe(2)
    expect(retried).toMatchObject({ outcome: 'changed' })
    expect((await draftRow(t.storeA1))?.head_commit).not.toBe(savedHead)
  })

  it('leaves the draft at the last saved state when the sandbox dies twice', async () => {
    const { runner, host } = await runnerFor(t.storeA1)
    await runner.change({ request: 'Saved first', userId: ownerA.userId, billedTo: 'plan', model: scripted([[lead('The last saved state.')]]).model })
    const savedHead = (await draftRow(t.storeA1))?.head_commit
    const savedBundle = drafts.objects.get(draftBundle(t.storeA1))?.bytes
    const dying = scripted([[lead('Never saved.')]]).model
    // The container dies whenever a change reaches it, so the retry after the restart dies too.
    const killOnChange = { ...host, send: async (request: Request) => (request.url.endsWith('/changes') ? (host.kill(), host.send(request)) : host.send(request)) }
    const fragile = new StudioRunner({
      db: (work) => work(db.sql),
      storeId: t.storeA1,
      host: async () => killOnChange,
      drafts: drafts.bucket,
      sites,
      capacity: { acquire: async () => ({ granted: true }), release: async () => undefined },
      now: () => new Date(),
      newId: () => crypto.randomUUID(),
      onBundle: () => undefined,
    })
    await expect(fragile.change({ request: 'Dies twice', userId: ownerA.userId, billedTo: 'plan', model: dying })).rejects.toBeInstanceOf(StudioUnavailable)
    expect((await draftRow(t.storeA1))?.head_commit).toBe(savedHead)
    expect(drafts.objects.get(draftBundle(t.storeA1))?.bytes).toBe(savedBundle)
  })
})

describe('GitHub', () => {
  it('gets nothing from the studio: the repo’s head and pushes stay as they were', async () => {
    const [before] = await db.sql<{ repo_head: string | null }[]>`select repo_head from storefront where store_id = ${t.storeA1}`
    const { runner } = await runnerFor(t.storeA1)
    await runner.change({ request: 'A private change', userId: ownerA.userId, billedTo: 'plan', model: scripted([[lead('Private until published.')]]).model })
    const [after] = await db.sql<{ repo_head: string | null }[]>`select repo_head from storefront where store_id = ${t.storeA1}`
    expect(after?.repo_head).toBe(before?.repo_head)
    expect(await db.sql`select 1 from storefront_push where store_id = ${t.storeA1}`).toHaveLength(0)
  })
})

describe('the upgrade bot’s commit (storefront ARCHITECTURE §7.1, #485)', () => {
  const liveBuild = '0b8e4a52-5d7c-4c1e-9f3a-6f1d2e3c4b5a'
  const filesOf = (commit: string) => JSON.parse(new TextDecoder().decode(drafts.objects.get(upgradeFiles(t.storeA2, commit))?.bytes)) as { files: { path: string; content: string | null }[] }

  /** A draft whose bundle stands as the live build's source too, as after a design publish. */
  const seedLive = async () => {
    const { runner } = await runnerFor(t.storeA2)
    const changed = await runner.change({ request: 'A draft change', userId: ownerA.userId, billedTo: 'plan', model: scripted([[lead('The live words.')]]).model })
    expect(changed.outcome).toBe('changed')
    const saved = drafts.objects.get(draftBundle(t.storeA2))?.bytes
    drafts.objects.set(sourceBundle(t.storeA2, liveBuild), { bytes: saved ?? new ArrayBuffer(0) })
    await runner.stop()
    return saved
  }

  it('is made on the live build’s code in a sandbox of the new version, kept privately, and leaves the draft alone', async () => {
    const saved = await seedLive()
    const versions: string[] = []
    const { runner: bot } = await runnerFor(t.storeA2, { host: async (version) => (versions.push(version), (await sandboxProcess().then((h) => (processes.push(h), h)))) })
    const answer = await bot.prepareUpgrade({ from: core, to: '0.5.0', sourceBuildId: liveBuild, baseline: false })
    expect(answer.outcome).toBe('prepared')
    if (answer.outcome !== 'prepared') return
    expect(versions).toEqual(['0.5.0'])
    expect(drafts.objects.has(upgradeBundle(t.storeA2, answer.commit))).toBe(true)
    expect(JSON.parse(filesOf(answer.commit).files.find((f) => f.path === 'package.json')?.content ?? '{}')).toMatchObject({ dependencies: { '@dripfunnel/storefront-core': '0.5.0' } })
    expect(drafts.objects.get(draftBundle(t.storeA2))?.bytes).toBe(saved)
    expect(bot.loaded).toBe(false)
  })

  it('answers busy while the merchant’s studio is open', async () => {
    const { runner } = await runnerFor(t.storeA2)
    await runner.open()
    expect(await runner.prepareUpgrade({ from: core, to: '0.5.0', sourceBuildId: liveBuild, baseline: false })).toEqual({ outcome: 'busy' })
    await runner.stop()
  })

  it('writes the baseline theme with the store’s own words for a security fix’s fallback', async () => {
    const baseline = template.map((f) => (f.path === 'content/en/pages.json' ? { path: f.path, content: f.content.replace(/"lead": "[^"]*"/, '"lead": "Baseline lead"') } : f)).filter((f) => f.path !== 'src/theme/pages/AboutPage.tsx')
    await seedLive()
    await putText(sites, `templates/${core}/themes/baseline/source.json`, JSON.stringify({ files: baseline }))
    const { runner } = await runnerFor(t.storeA2)
    const answer = await runner.prepareUpgrade({ from: core, to: core, sourceBuildId: liveBuild, baseline: true })
    if (answer.outcome !== 'prepared') throw new Error('not prepared')
    const files = filesOf(answer.commit).files
    expect(files.find((f) => f.path === 'src/theme/pages/AboutPage.tsx')).toEqual({ path: 'src/theme/pages/AboutPage.tsx', content: null })
    expect(files.find((f) => f.path === 'content/en/pages.json')?.content ?? '').not.toContain('Baseline lead')
  })
})

describe('the migration agent and a draft’s rebase onto an upgrade (#485)', () => {
  const liveBuild = '5f0c9d1e-2b3a-4c5d-8e7f-0a1b2c3d4e5f'
  /** A draft whose bundle is also the live build's source, then the upgrade bot's commit on that live code. */
  const upgradeOfLive = async () => {
    const { runner } = await runnerFor(t.storeA2)
    expect((await runner.change({ request: 'The live change', userId: ownerA.userId, billedTo: 'plan', model: scripted([[lead('The live words.')]]).model })).outcome).toBe('changed')
    drafts.objects.set(sourceBundle(t.storeA2, liveBuild), { bytes: drafts.objects.get(draftBundle(t.storeA2))?.bytes ?? new ArrayBuffer(0) })
    await runner.stop()
    const { runner: bot } = await runnerFor(t.storeA2)
    const answer = await bot.prepareUpgrade({ from: core, to: '0.5.0', sourceBuildId: liveBuild, baseline: false })
    if (answer.outcome !== 'prepared') throw new Error('not prepared')
    return answer.commit
  }
  const runsOf = () => db.sql<{ kind: string; billed_to: string; requested_by: string | null; outcome: string; prompt: string; parent_run_id: string | null }[]>`select kind, billed_to, requested_by, outcome, prompt, parent_run_id from ai_run where store_id = ${t.storeA2} and kind in ('migration', 'repair') order by parent_run_id is not null, created_at`

  it('migrates the upgrade’s commit from its failing checks and the notes, on the platform’s bill', async () => {
    const upgrade = await upgradeOfLive()
    const { model, asks } = scripted([[lead('Migrated words.')]])
    const { runner } = await runnerFor(t.storeA2)
    const answer = await runner.migrate({ commit: upgrade, to: '0.5.0', failing: ['visual-diff: The home page looks different.'], notes: [{ version: '0.5.0', kind: 'minor', notes: 'Leads are shorter.' }], model })
    expect(answer.outcome).toBe('migrated')
    if (answer.outcome !== 'migrated') return
    expect(asks).toEqual([{ problems: 0 }])
    const files = (JSON.parse(new TextDecoder().decode(drafts.objects.get(upgradeFiles(t.storeA2, answer.commit))?.bytes)) as { files: { path: string; content: string | null }[] }).files
    expect(files.map((f) => f.path).sort()).toEqual(['content/en/pages.json', 'package.json'])
    expect(files.find((f) => f.path === 'content/en/pages.json')?.content).toContain('Migrated words.')
    expect(drafts.objects.has(upgradeBundle(t.storeA2, answer.commit))).toBe(true)
    const runs = await runsOf()
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ kind: 'migration', billed_to: 'platform', requested_by: null, outcome: 'changed', parent_run_id: null })
    expect(runs[0]?.prompt).toContain('storefront-core 0.5.0')
    expect(runs[0]?.prompt).toContain('Leads are shorter.')
  })

  it('gives up after three repairs the gate refuses, recording each on the platform', async () => {
    const upgrade = await upgradeOfLive()
    const { runner } = await runnerFor(t.storeA2)
    expect((await runner.migrate({ commit: upgrade, to: '0.5.0', failing: ['axe: x'], notes: [], model: scripted([[refusedPage]]).model })).outcome).toBe('refused')
    const runs = await runsOf()
    expect(runs.map((r) => [r.kind, r.outcome])).toEqual([['migration', 'refused'], ['repair', 'refused'], ['repair', 'refused'], ['repair', 'refused']])
    expect(runs.every((r) => r.billed_to === 'platform')).toBe(true)
  })

  it('opens a store served the baseline, with no draft, on its own theme and that theme’s core', async () => {
    await upgradeOfLive()
    drafts.objects.delete(draftBundle(t.storeA2))
    const run = async (kind: string, version: string) =>
      (await db.sql<{ id: string }[]>`insert into publish_run (store_id, kind, state, commit, template, core_version, started_by_kind) values (${t.storeA2}, ${kind}, 'live', ${'c'.repeat(40)}, 'baseline', ${version}, 'system') returning id`)[0]?.id ?? ''
    const own = await run('design', core)
    const baseline = await run('security', '0.5.0')
    drafts.objects.set(sourceBundle(t.storeA2, own), { bytes: drafts.objects.get(sourceBundle(t.storeA2, liveBuild))?.bytes ?? new ArrayBuffer(0) })
    // The baseline build's source isn't there: opening from it would fail.
    await db.sql`update storefront set live_build_id = ${baseline}, theme_mode = 'baseline', baseline_from_build_id = ${own} where store_id = ${t.storeA2}`
    const versions: string[] = []
    const { runner } = await runnerFor(t.storeA2, { host: async (version) => (versions.push(version), await sandboxProcess().then((h) => (processes.push(h), h))) })
    await runner.open()
    expect(versions).toEqual([core])
    await runner.stop()
    await db.sql`update storefront set live_build_id = null, theme_mode = 'own', baseline_from_build_id = null where store_id = ${t.storeA2}`
  })

  it('keeps a draft started before the upgrade, and moves it onto the upgrade at its next publish', async () => {
    const upgrade = await upgradeOfLive()
    // The merchant goes on designing after the live version; the upgrade bot never touches that draft.
    const { runner } = await runnerFor(t.storeA2)
    expect((await runner.change({ request: 'A later change', userId: ownerA.userId, billedTo: 'plan', model: scripted([[lead('The draft words.')]]).model })).outcome).toBe('changed')
    const draftBefore = (await draftRow(t.storeA2))?.head_commit
    await runner.stop()
    // The upgrade goes live: a build of its commit on 0.5.0, whose source bundle is the upgrade's.
    const [run] = await db.sql<{ id: string }[]>`
      insert into publish_run (store_id, kind, state, commit, template, core_version, started_by_kind, switched_at, finished_at)
      values (${t.storeA2}, 'upgrade', 'live', ${upgrade}, 'baseline', '0.5.0', 'system', now(), now()) returning id`
    drafts.objects.set(sourceBundle(t.storeA2, run?.id ?? ''), { bytes: drafts.objects.get(upgradeBundle(t.storeA2, upgrade))?.bytes ?? new ArrayBuffer(0) })
    await db.sql`update storefront set live_build_id = ${run?.id ?? ''} where store_id = ${t.storeA2}`
    const versions: string[] = []
    const { runner: studio } = await runnerFor(t.storeA2, { host: async (version) => (versions.push(version), await sandboxProcess().then((h) => (processes.push(h), h))) })
    const ready = await studio.prepareToPublish()
    expect(ready).toMatchObject({ rebased: true, coreVersion: '0.5.0', problems: [] })
    expect(ready.commit).not.toBe(draftBefore)
    expect(versions).toEqual([core, '0.5.0'])
    expect(await db.sql`select head_commit, core_version from design_draft where store_id = ${t.storeA2}`).toEqual([{ head_commit: ready.commit, core_version: '0.5.0' }])
    // The draft's own change is still there, on top of the upgrade's pin.
    const check = await sandboxProcess()
    processes.push(check)
    await check.start()
    const client = sandboxClient(check.send, 'rebase-check')
    await client.loadBundle(drafts.objects.get(draftBundle(t.storeA2))?.bytes ?? new ArrayBuffer(0))
    expect((await client.theme()).files.find((f) => f.path === 'content/en/pages.json')?.content).toContain('The draft words.')
    // Asked again, nothing is left to move onto.
    expect(await studio.prepareToPublish()).toMatchObject({ rebased: false, coreVersion: '0.5.0', commit: ready.commit })
    await db.sql`update storefront set live_build_id = null where store_id = ${t.storeA2}`
  })
})

describe('ai_run isolation (DATA-MODEL §7.8, §5.3)', () => {
  const as = (role: string, scope: string, store: string, seller: string, work: (tx: postgres.TransactionSql) => Promise<unknown>) =>
    db.sql.begin(async (tx: postgres.TransactionSql) => {
      await tx.unsafe(`set local role ${role}`)
      await tx`select set_config('app.scope', ${scope}, true)`
      await tx`select set_config('app.store_id', ${store}, true)`
      await tx`select set_config('app.partner_id', ${t.partnerA}, true)`
      await tx`select set_config('app.seller_id', ${seller}, true)`
      return work(tx)
    })
  const count = async (role: string, scope: string, store: string, seller = '') => ((await as(role, scope, store, seller, (tx) => tx`select count(*)::int as n from ai_run`)) as { n: number }[])[0]?.n

  it('is read by its own store’s merchant side only: never by another store, a supplier, a partner or staff', async () => {
    const { runner } = await runnerFor(t.storeA1)
    await runner.change({ request: 'A prompt only store A reads', userId: ownerA.userId, billedTo: 'plan', model: scripted([[lead('Metered for store A.')]]).model })
    expect(await count('app_request', 'store', t.storeA1)).toBe(1)
    expect(await count('app_request', 'store', t.storeB1)).toBe(0)
    expect(await count('app_request', 'store', t.storeA1, t.sellerA1First)).toBe(0)
    await expect(as('app_supplier', 'store', t.storeA1, t.sellerA1First, (tx) => tx`select prompt from ai_run`)).rejects.toThrow(/permission denied/)
    // No grant at all until the metering view (DATA-MODEL §5.3), so not even a count reaches a partner or staff.
    await expect(as('app_partner', 'partner', t.storeA1, '', (tx) => tx`select count(*) from ai_run`)).rejects.toThrow(/permission denied/)
    await expect(as('app_platform', 'platform', t.storeA1, '', (tx) => tx`select count(*) from ai_run`)).rejects.toThrow(/permission denied/)
    await expect(as('app_request', 'store', t.storeA1, '', (tx) => tx`insert into ai_run (store_id, kind, prompt, model, tokens_in, tokens_out, cost_amount, cost_currency, billed_to, outcome) values (${t.storeA1}, 'design', 'x', 'm', 0, 0, 0, 'USD', 'plan', 'changed')`)).rejects.toThrow(/permission denied/)
  })
})

describe('studio sessions (AI-STUDIO §8)', () => {
  it('lets the Owner change and a Manager view, and opens nothing for staff or a supplier', async () => {
    const now = new Date()
    const ctx = contextFor(t.storeA1, t.partnerA, ownerA.userId, ownerA.sessionHash)
    expect((await openStudioSession(db.sql, ctx, owner, now))?.access).toBe('change')
    expect((await openStudioSession(db.sql, ctx, manager, now))?.access).toBe('view')
    expect(await openStudioSession(db.sql, ctx, staff, now)).toBeNull()
    expect(await openStudioSession(db.sql, { ...ctx, sellerScope: { kind: 'seller', sellerId: t.sellerA1First } }, supplier, now)).toBeNull()
    expect(await openStudioSession(db.sql, { ...ctx, caller: { kind: 'support', supportSessionId: 's', partnerUserId: 'p', access: 'read' } }, owner, now)).toBeNull()
  })

  it('is bound to its store, kept only as a hash, and ends with its portal session or its time', async () => {
    const now = new Date()
    const user = await seedUser(t.storeA1, t.partnerA, 'owner', 'bound.a1@studio.example')
    const opened = await openStudioSession(db.sql, contextFor(t.storeA1, t.partnerA, user.userId, user.sessionHash), owner, now)
    const id = opened?.id ?? ''
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(await db.sql`select 1 from studio_session where id_hash = ${id}`).toHaveLength(0)
    expect(await liveStudioSession(db.sql, t.storeA1, id, now)).toEqual({ userId: user.userId, access: 'change' })
    // Store B's host, or any other store's, gets nothing for A's id.
    expect(await liveStudioSession(db.sql, t.storeB1, id, now)).toBeNull()
    expect(await liveStudioSession(db.sql, t.storeA2, id, now)).toBeNull()
    expect(await liveStudioSession(db.sql, t.storeA1, id, new Date(now.getTime() + 5 * 60 * 1000 + 1))).toBeNull()
    await db.sql`delete from user_session where id_hash = ${user.sessionHash}`
    expect(await liveStudioSession(db.sql, t.storeA1, id, now)).toBeNull()
  })

  it('ends with a portal session that is no longer fully signed in: idle past its bound, or sent back a step', async () => {
    const now = new Date()
    const user = await seedUser(t.storeA1, t.partnerA, 'owner', 'idle.a1@studio.example')
    const id = (await openStudioSession(db.sql, contextFor(t.storeA1, t.partnerA, user.userId, user.sessionHash), owner, now))?.id ?? ''
    expect(await liveStudioSession(db.sql, t.storeA1, id, now)).not.toBeNull()
    await db.sql`update user_session set last_seen_at = ${new Date(now.getTime() - 2 * 60 * 60 * 1000 - 1000)} where id_hash = ${user.sessionHash}`
    expect(await liveStudioSession(db.sql, t.storeA1, id, now)).toBeNull()
    await db.sql`update user_session set last_seen_at = ${now}, stage = 'enrol' where id_hash = ${user.sessionHash}`
    expect(await liveStudioSession(db.sql, t.storeA1, id, now)).toBeNull()
  })

  it('renews only with access still held, for the same user and portal session', async () => {
    const now = new Date()
    const user = await seedUser(t.storeA1, t.partnerA, 'owner', 'renew.a1@studio.example')
    const ctx = contextFor(t.storeA1, t.partnerA, user.userId, user.sessionHash)
    const id = (await openStudioSession(db.sql, ctx, owner, now))?.id ?? ''
    const later = new Date(now.getTime() + 4 * 60 * 1000)
    expect((await renewStudio(db.sql, ctx, owner, id, later))?.getTime()).toBe(later.getTime() + 5 * 60 * 1000)
    expect(await renewStudio(db.sql, { ...ctx, caller: { kind: 'person', userId: user.userId, sessionId: ownerA.sessionHash } }, owner, id, later)).toBeNull()
    expect(await renewStudio(db.sql, { ...ctx, storeId: t.storeA2 }, owner, id, later)).toBeNull()
    expect(await renewStudio(db.sql, ctx, manager, id, later)).not.toBeNull()
    expect(await liveStudioSession(db.sql, t.storeA1, id, later)).toMatchObject({ access: 'view' })
    // A seat taken away gets no renewal, and its session ends at once.
    expect(await renewStudio(db.sql, ctx, staff, id, later)).toBeNull()
    expect(await liveStudioSession(db.sql, t.storeA1, id, later)).toBeNull()
  })

  it('picks the store’s Durable Object from the TenantContext, never from anything the caller sent', () => {
    const named: string[] = []
    const namespace = { idFromName: (name: string) => (named.push(name), name), get: (id: string) => ({ id }) } as unknown as DurableObjectNamespace
    expect(studioOf(namespace, contextFor(t.storeA1, t.partnerA, ownerA.userId, ownerA.sessionHash))).toEqual({ id: t.storeA1 })
    expect(named).toEqual([t.storeA1])
  })
})
