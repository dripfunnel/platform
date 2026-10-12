import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { withSystemScope } from '#db/scoped/index'
import { recordGate } from '#db/scoped/builds'
import { clearBaseline, setBaseline } from '#db/scoped/coreRollouts'
import { rebaseDraft } from '#db/scoped/studio'
import { recordCoreRelease } from '#db/scoped/coreReleases'
import { enrolStores, insertRollout, startStores } from '#db/scoped/coreRollouts'
import { createGitHubApp, storeRepos } from '#integrations/github/index'
import { localGitHub } from '#integrations/local/github'
import { pushUpgrade, runStoreUpgrade, type MigrateInput, type Prepared, type PrepareInput, type UpgradeDeps, type UpgradeSteps } from '#saas/fleet/index'
import { prepareEmail } from '#saas/email/index'
import { digestOf, runPublish, startPublish, upgradeBundle, upgradeFiles, type PublishDeps } from '#saas/storefronts/index'
import { draftBundle, sourceBundle, stagingFolder } from '#saas/storefronts/layout'
import { testProbe } from './support/edgeProbe'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { fakeSites, putText, type FakeSites } from './support/sites'

// Card #485 part 2: one store's upgrade (SAAS §10; storefront ARCHITECTURE §7, LIVE-SHOP §8). The upgrade's commit, built
// through the real publish pipeline with the test playing the store's workflow; a store ends live, passed or pinned.

let db: TestDatabase
let t: Tenants
let sites: FakeSites
let assets: FakeSites
let drafts: FakeSites
let dispatched: string[]
let made: number
const commit = (n: number) => n.toString(16).padStart(40, '0')
const hex = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('')
const image = (c: string) => `registry.cloudflare.com/acct123/storefront-build@sha256:${c.repeat(64)}`

const publishDeps = (): PublishDeps => ({
  sql: db.sql,
  sites,
  assets,
  drafts,
  assetOrigin: null,
  dispatch: async (_repo, buildId) => {
    dispatched.push(buildId)
    return true
  },
  now: () => new Date(),
  probe: testProbe(db.sql, { sites, assets }),
  assetHost: 'sf-assets.dripfunnel.com',
  wait: async () => undefined,
})

const buildOf = async (id: string) => (await db.sql<{ commit: string; kind: string; state: string; core_version: string; check_only: boolean; uploaded_at: Date | null }[]>`select commit, kind, state, core_version, check_only, uploaded_at from publish_run where id = ${id}`)[0]

/** The store's workflow, played by the test: a build of a commit in `bad` fails its report, any other passes, then uploads. */
const workflow = (bad: ReadonlySet<string>) => ({
  do: (_: string, work: () => Promise<string>) => work(),
  waitFor: async (_: string, event: string) => {
    const id = dispatched.at(-1) ?? ''
    const build = await buildOf(id)
    if (!build) throw new Error('nothing was dispatched')
    if (event === 'reported') {
      const passed = !bad.has(build.commit)
      await withSystemScope(db.sql, (tx) => recordGate(tx, { buildId: id, gate: { passed, checks: [{ name: 'visual-diff', passed, detail: passed ? undefined : 'The home page looks different at 390 px.' }] }, digest: 'd'.repeat(64), passed, at: new Date() }))
      return
    }
    const [run] = await db.sql<{ store_id: string }[]>`select store_id from publish_run where id = ${id}`
    const html = `<h1>${id}</h1>`
    const files = await Promise.all(['index.html', 'checkout/index.html'].map(async (path) => ({ path, sha256: await putText(sites, `${stagingFolder(run?.store_id ?? '', id)}${path}`, html), size: html.length })))
    await db.sql`update publish_run set gate_digest = ${await digestOf(files)}, uploaded_at = now(), upload_manifest = ${db.sql.json({ files })} where id = ${id}`
  },
})

/** Each waiting publish of the store runs to its end, as the publish-storefront Workflow would between the bot's looks. */
const runQueued = async (storeId: string, bad: ReadonlySet<string>) => {
  for (const run of await db.sql<{ id: string }[]>`select id from publish_run where store_id = ${storeId} and state = 'queued' order by created_at`) {
    await runPublish(publishDeps(), { runId: run.id, storeId }, workflow(bad))
  }
}

const steps = (storeId: string, bad: ReadonlySet<string> = new Set(), onSleep?: (name: string) => Promise<void>): UpgradeSteps & { sleeps: string[] } => {
  const sleeps: string[] = []
  return {
    sleeps,
    do: (_name, work) => work(),
    sleep: async (name) => {
      sleeps.push(name)
      await onSleep?.(name)
      await runQueued(storeId, bad)
    },
  }
}

/** The store's sandbox, played by the test: each upgrade is a new commit, kept privately with the files it changed. */
const sandbox = (answers: ('busy' | 'commit')[] = ['commit']) => {
  const asks: PrepareInput[] = []
  let n = 0
  const prepare = async (storeId: string, ask: PrepareInput): Promise<Prepared | 'busy'> => {
    asks.push(ask)
    const answer = answers[Math.min(n, answers.length - 1)]
    n += 1
    if (answer === 'busy') return 'busy'
    const c = commit(9000 + (made += 1))
    await putText(drafts, upgradeBundle(storeId, c), `upgrade ${c}`)
    await putText(drafts, upgradeFiles(storeId, c), JSON.stringify({ files: [{ path: 'package.json', content: `{"dependencies":{"@dripfunnel/storefront-core":"${ask.to}"}}` }, { path: 'src/theme/pages/OldPage.tsx', content: null }] }))
    return { commit: c, notes: [] }
  }
  return { prepare, asks }
}

const upgradeDeps = (prepare: UpgradeDeps['prepare']): UpgradeDeps => ({ sql: db.sql, drafts, prepare, now: () => new Date() })

const live = async (storeId: string) => (await db.sql<{ live_build_id: string | null }[]>`select live_build_id from storefront where store_id = ${storeId}`)[0]?.live_build_id ?? null

/** A design publish that went live on core 1.0.0, so the store has a live build and its source bundle. */
const publishLive = async (storeId: string, head: string) => {
  await drafts.put(draftBundle(storeId), new TextEncoder().encode(`draft ${head}`).buffer, { sha256: await hex(`draft ${head}`) })
  const runId = await withSystemScope(db.sql, (tx) => startPublish(tx, { storeId, kind: 'design', commit: head, template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: new Date() })).then((r) => (r.ok ? r.runId : ''))
  expect(await runPublish(publishDeps(), { runId, storeId }, workflow(new Set()))).toBe('live')
  return runId
}

/** A rollout of `version` over the fleet, its stores enrolled and every one marked running; the store's upgrade id. */
const rolloutOf = async (version: string, storeId: string, security = false) =>
  withSystemScope(db.sql, async (tx) => {
    await tx`update core_rollout set state = 'done', paused_state = null where state in ('canary', 'waves', 'paused')`
    const id = await insertRollout(tx, { version, security, by: null, reason: 'Test rollout', at: new Date() })
    await enrolStores(tx, { id, version }, 100, new Date())
    const started = await startStores(tx, id, 100, 100, new Date())
    const row = started.find((s) => s.store_id === storeId)
    if (!row) throw new Error('the store was not enrolled')
    return { upgradeId: row.id, rolloutId: id, storeId }
  })

const rowOf = async (upgradeId: string) =>
  (await db.sql<{ state: string; error: string | null; commit: string | null; publish_run_id: string | null; gate: { passed: boolean } | null }[]>`select state, error, commit, publish_run_id, gate from core_rollout_store where id = ${upgradeId}`)[0]
const storefrontOf = async (storeId: string) =>
  (await db.sql<{ core_pinned_reason: string | null; core_upgrade_version: string | null; core_upgrade_commit: string | null }[]>`select core_pinned_reason, core_upgrade_version, core_upgrade_commit from storefront where store_id = ${storeId}`)[0]

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set status = 'active' where id in (${t.storeA1}, ${t.storeA2})`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x')`
  await db.sql`update storefront set repo = 'sf-u1u1u1u1u1', repo_id = 9301 where store_id = ${t.storeA1}`
  await db.sql`update storefront set repo = 'sf-u2u2u2u2u2', repo_id = 9302 where store_id = ${t.storeA2}`
  await db.sql`update store set status = 'closed', closed_at = now() where id = ${t.storeB1}`
  await withSystemScope(db.sql, async (tx) => {
    await recordCoreRelease(tx, '1.0.0', image('a'))
    await recordCoreRelease(tx, '1.1.0', image('b'))
    await recordCoreRelease(tx, '2.0.0', image('c'))
  })
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

beforeEach(async () => {
  sites = fakeSites()
  assets = fakeSites()
  drafts = fakeSites()
  dispatched = []
  made = 0
  await publishLive(t.storeA1, commit(1))
  await publishLive(t.storeA2, commit(2))
  await db.sql`update storefront set core_pinned_reason = null, core_upgrade_version = null, core_upgrade_commit = null, theme_mode = 'own', baseline_reason = null, baseline_from_build_id = null`
})

describe('a patch or minor upgrade', () => {
  it('builds the upgrade’s commit with the new core on the store’s live code, goes live, and pushes once live', async () => {
    const before = await live(t.storeA1)
    const p = await rolloutOf('1.1.0', t.storeA1)
    const box = sandbox()
    expect(await runStoreUpgrade(upgradeDeps(box.prepare), p, steps(t.storeA1))).toBe('live')
    expect(box.asks).toEqual([{ from: '1.0.0', to: '1.1.0', sourceBuildId: before, baseline: false }])
    const row = await rowOf(p.upgradeId)
    expect(row).toMatchObject({ state: 'live', error: null, gate: { passed: true } })
    const build = await buildOf(row?.publish_run_id ?? '')
    expect(build).toMatchObject({ kind: 'upgrade', state: 'live', core_version: '1.1.0', commit: row?.commit, check_only: false })
    expect(await live(t.storeA1)).toBe(row?.publish_run_id)
    expect((await db.sql<{ core_version: string }[]>`select core_version from store where id = ${t.storeA1}`)[0]?.core_version).toBe('1.1.0')
    // The build's source is the upgrade bot's private commit, never the live build's own (LIVE-SHOP §8).
    expect(await (await drafts.get(sourceBundle(t.storeA1, row?.publish_run_id ?? '')))?.text()).toBe(`upgrade ${row?.commit ?? ''}`)
    const [push] = await db.sql<{ payload: { commit: string; version: string } }[]>`select payload from outbox where kind = 'storefront.upgrade_push' and store_id = ${t.storeA1}`
    expect(push?.payload).toMatchObject({ commit: row?.commit, version: '1.1.0' })
  })

  it('pins a store whose upgrade fails the gate, keeps its live build, and alerts once', async () => {
    const before = await live(t.storeA2)
    const p = await rolloutOf('1.1.0', t.storeA2)
    const box = sandbox()
    const failing = new Set([commit(9001)])
    expect(await runStoreUpgrade(upgradeDeps(box.prepare), p, steps(t.storeA2, failing))).toBe('pinned')
    expect(await rowOf(p.upgradeId)).toMatchObject({ state: 'pinned', error: 'gate_failed', gate: { passed: false } })
    expect(await live(t.storeA2)).toBe(before)
    expect((await storefrontOf(t.storeA2))?.core_pinned_reason).toBe('gate_failed')
    const alerts = await db.sql<{ reason: string }[]>`select reason from activity_log where action = 'storefront.core_pinned' and store_id = ${t.storeA2}`
    expect(alerts.map((a) => a.reason)).toEqual(['gate_failed'])
    // Nothing will build or push the refused commit, so its private copy is gone.
    expect(drafts.keys(`upgrades/${t.storeA2}/`)).toEqual([])
    expect(await db.sql`select 1 from outbox where kind = 'storefront.upgrade_push' and store_id = ${t.storeA2}`).toHaveLength(0)
  })

  it('waits while the merchant’s studio is open, and pins the store only once the wait runs out', async () => {
    const p = await rolloutOf('1.1.0', t.storeA1)
    const opened = sandbox(['busy', 'commit'])
    const play = steps(t.storeA1)
    expect(await runStoreUpgrade(upgradeDeps(opened.prepare), p, play)).toBe('live')
    expect(play.sleeps[0]).toBe('prepare:wait:0')

    const q = await rolloutOf('1.1.0', t.storeA2)
    expect(await runStoreUpgrade(upgradeDeps(sandbox(['busy']).prepare), q, steps(t.storeA2))).toBe('pinned')
    expect(await rowOf(q.upgradeId)).toMatchObject({ state: 'pinned', error: 'studio_busy' })
  })

  it('never merges into the store’s own waiting publish: it starts after it', async () => {
    const p = await rolloutOf('1.1.0', t.storeA1)
    const own = await withSystemScope(db.sql, (tx) => startPublish(tx, { storeId: t.storeA1, kind: 'automatic', commit: commit(1), template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: new Date() })).then((r) => (r.ok ? r.runId : ''))
    await drafts.put(sourceBundle(t.storeA1, (await live(t.storeA1)) ?? ''), new TextEncoder().encode('live').buffer, { sha256: await hex('live') })
    const play = steps(t.storeA1)
    expect(await runStoreUpgrade(upgradeDeps(sandbox().prepare), p, play)).toBe('live')
    expect(play.sleeps[0]).toBe('build:start-wait:0')
    expect((await buildOf(own))?.kind).toBe('automatic')
    expect((await rowOf(p.upgradeId))?.publish_run_id).not.toBe(own)
  })

  it('fails a build it stopped waiting for before pinning, so the build can’t go live behind the row', async () => {
    const p = await rolloutOf('1.1.0', t.storeA2)
    const silent: UpgradeSteps = { do: (_name, work) => work(), sleep: async () => undefined }
    expect(await runStoreUpgrade(upgradeDeps(sandbox().prepare), p, silent)).toBe('pinned')
    const row = await rowOf(p.upgradeId)
    expect(row).toMatchObject({ state: 'pinned', error: 'build_timed_out' })
    expect(await buildOf(row?.publish_run_id ?? '')).toMatchObject({ state: 'failed' })
    // The publish Workflow starting late finds nothing to build.
    expect(await runPublish(publishDeps(), { runId: row?.publish_run_id ?? '', storeId: t.storeA2 }, workflow(new Set()))).toBe('stopped')
    expect(await db.sql`select 1 from publish_run where store_id = ${t.storeA2} and state = 'queued'`).toHaveLength(0)
  })

  it('stops for a row that isn’t running, and leaves a store already on the version as it is', async () => {
    const p = await rolloutOf('1.1.0', t.storeA1)
    await db.sql`update core_rollout_store set state = 'reverted' where id = ${p.upgradeId}`
    expect(await runStoreUpgrade(upgradeDeps(sandbox().prepare), p, steps(t.storeA1))).toBe('stopped')
    expect(await runStoreUpgrade(upgradeDeps(sandbox().prepare), { ...p, storeId: t.storeA2 }, steps(t.storeA2))).toBe('stopped')
  })
})

describe('a store whose theme fails the upgrade', () => {
  /** The migration agent, played by the test: a new commit on the upgrade's, kept privately like it. */
  const agent = (answer: 'commit' | null) => {
    const asked: MigrateInput[] = []
    const migrate = async (storeId: string, input: MigrateInput) => {
      asked.push(input)
      if (answer === null) return null
      const c = commit(9500 + (made += 1))
      await putText(drafts, upgradeBundle(storeId, c), `migrated ${c}`)
      await putText(drafts, upgradeFiles(storeId, c), JSON.stringify({ files: [{ path: 'package.json', content: '{}' }] }))
      return c
    }
    return { migrate, asked }
  }

  it('is migrated by the agent from its failing checks, and the migrated commit goes live and is pushed', async () => {
    const p = await rolloutOf('1.1.0', t.storeA1)
    const ai = agent('commit')
    expect(await runStoreUpgrade({ ...upgradeDeps(sandbox().prepare), migrate: ai.migrate }, p, steps(t.storeA1, new Set([commit(9001)])))).toBe('migrated')
    expect(ai.asked).toEqual([{ commit: commit(9001), to: '1.1.0', failing: ['visual-diff: The home page looks different at 390 px.'], notes: [] }])
    const row = await rowOf(p.upgradeId)
    expect(row).toMatchObject({ state: 'migrated', commit: commit(9502) })
    expect(await live(t.storeA1)).toBe(row?.publish_run_id)
    expect(drafts.keys(upgradeBundle(t.storeA1, commit(9001)))).toEqual([])
    const [push] = await db.sql<{ payload: { commit: string } }[]>`select payload from outbox where kind = 'storefront.upgrade_push' and store_id = ${t.storeA1} order by created_at desc limit 1`
    expect(push?.payload.commit).toBe(commit(9502))
  })

  it('is pinned when the agent can’t fix it either, never left broken live', async () => {
    const before = await live(t.storeA2)
    const p = await rolloutOf('1.1.0', t.storeA2)
    expect(await runStoreUpgrade({ ...upgradeDeps(sandbox().prepare), migrate: agent(null).migrate }, p, steps(t.storeA2, new Set([commit(9001)])))).toBe('pinned')
    expect(await rowOf(p.upgradeId)).toMatchObject({ state: 'pinned', error: 'gate_failed' })
    expect(await live(t.storeA2)).toBe(before)
  })
})

describe('a forced security fix', () => {
  it('serves the baseline theme to a store whose own theme can’t build, and tells the merchant once', async () => {
    const own = await live(t.storeA1)
    const p = await rolloutOf('1.1.0', t.storeA1, true)
    const box = sandbox()
    expect(await runStoreUpgrade(upgradeDeps(box.prepare), p, steps(t.storeA1, new Set([commit(9001)])))).toBe('baseline')
    expect(box.asks.map((a) => a.baseline)).toEqual([false, true])
    const row = await rowOf(p.upgradeId)
    expect(row).toMatchObject({ state: 'baseline', error: 'gate_failed', commit: commit(9002) })
    const served = await db.sql<{ kind: string; baseline: boolean; core_version: string }[]>`select kind, baseline, core_version from publish_run where id = ${row?.publish_run_id ?? ''}`
    expect(served).toEqual([{ kind: 'security', baseline: true, core_version: '1.1.0' }])
    expect(await live(t.storeA1)).toBe(row?.publish_run_id)
    expect(await db.sql`select theme_mode, baseline_reason, baseline_from_build_id from storefront where store_id = ${t.storeA1}`).toEqual([{ theme_mode: 'baseline', baseline_reason: 'gate_failed', baseline_from_build_id: own }])
    const notices = await db.sql<{ payload: { template: string } }[]>`select payload from outbox where kind = 'email' and store_id = ${t.storeA1} and payload->>'template' = 'storefront-baseline'`
    expect(notices).toHaveLength(1)
    // Replayed, the step finds the store's upgrade already ended and tells no one again.
    expect(await runStoreUpgrade(upgradeDeps(box.prepare), p, steps(t.storeA1))).toBe('stopped')
    expect(await db.sql`select 1 from outbox where kind = 'email' and store_id = ${t.storeA1} and payload->>'template' = 'storefront-baseline'`).toHaveLength(1)
    const [entry] = await db.sql<{ reason: string }[]>`select reason from activity_log where store_id = ${t.storeA1} and action = 'storefront.baseline_served'`
    expect(entry?.reason).toBe('gate_failed')
    // The baseline is never pushed, and it is in plain words for the merchant.
    expect(await db.sql`select 1 from outbox where kind = 'storefront.upgrade_push' and payload->>'commit' = ${commit(9002)}`).toHaveLength(0)
    const [owner] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, 'owner.baseline@example.com', 'Owner', 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${owner?.id ?? ''}, ${t.storeA1}, 'owner', 'active')`
    const [email] = await db.sql<{ payload: unknown; partner_id: string | null }[]>`select payload, partner_id from outbox where kind = 'email' and store_id = ${t.storeA1}`
    const prepared = await withSystemScope(db.sql, (tx) => prepareEmail(tx, { payload: email?.payload, partnerId: email?.partner_id ?? null, storeId: t.storeA1 }, { adminHost: 'admin.localhost', platformHost: 'platform.localhost' }, new Date()))
    expect(prepared.send ? prepared.content.subject : prepared.reason).toMatch(/simpler design/)
  })

  it('gives the store its own theme back when the merchant republishes', async () => {
    await db.sql`update storefront set theme_mode = 'baseline', baseline_reason = 'gate_failed' where store_id = ${t.storeA2}`
    await publishLive(t.storeA2, commit(3))
    expect(await db.sql`select theme_mode, baseline_reason from storefront where store_id = ${t.storeA2}`).toEqual([{ theme_mode: 'own', baseline_reason: null }])
  })

  it('pins a store whose baseline build fails too', async () => {
    const before = await live(t.storeA2)
    const p = await rolloutOf('1.1.0', t.storeA2, true)
    expect(await runStoreUpgrade(upgradeDeps(sandbox().prepare), p, steps(t.storeA2, new Set([commit(9001), commit(9002)])))).toBe('pinned')
    expect(await live(t.storeA2)).toBe(before)
    expect(await db.sql`select theme_mode from storefront where store_id = ${t.storeA2}`).toEqual([{ theme_mode: 'own' }])
  })
})

describe('the baseline and the draft’s writes, store by store', () => {
  const storefronts = () => db.sql`select store_id, theme_mode, baseline_reason, baseline_from_build_id, core_upgrade_version, core_upgrade_commit from storefront order by store_id`
  const otherThan = async (storeId: string) => (await storefronts()).filter((r) => r['store_id'] !== storeId)

  it('serve, clear and rebase only their own store, and a design publish gives back only its own store’s theme', async () => {
    await db.sql`insert into design_draft (store_id, head_commit, template, core_version) values (${t.storeA1}, ${commit(71)}, 'linen', '1.0.0'), (${t.storeA2}, ${commit(72)}, 'linen', '1.0.0') on conflict (store_id) do update set head_commit = excluded.head_commit, core_version = excluded.core_version`
    const before = await otherThan(t.storeA1)
    const draftsBefore = await db.sql`select store_id, head_commit, core_version from design_draft where store_id <> ${t.storeA1} order by store_id`
    await withSystemScope(db.sql, async (tx) => {
      await setBaseline(tx, t.storeA1, { reason: 'gate_failed', fromBuildId: (await live(t.storeA1)) ?? '' })
      await rebaseDraft(tx, { storeId: t.storeA1, head: commit(73), coreVersion: '1.1.0', at: new Date() })
    })
    expect(await otherThan(t.storeA1)).toEqual(before)
    expect(await db.sql`select store_id, head_commit, core_version from design_draft where store_id <> ${t.storeA1} order by store_id`).toEqual(draftsBefore)
    expect(await db.sql`select head_commit, core_version from design_draft where store_id = ${t.storeA1}`).toEqual([{ head_commit: commit(73), core_version: '1.1.0' }])
    // Store A2's merchant republishes: store A1 stays on its baseline.
    await db.sql`update storefront set theme_mode = 'baseline', baseline_reason = 'gate_failed' where store_id = ${t.storeA2}`
    await publishLive(t.storeA2, commit(74))
    expect(await db.sql`select store_id, theme_mode from storefront where store_id in (${t.storeA1}, ${t.storeA2}) order by store_id`).toEqual(
      [{ store_id: t.storeA1, theme_mode: 'baseline' }, { store_id: t.storeA2, theme_mode: 'own' }].sort((a, b) => a.store_id.localeCompare(b.store_id)),
    )
    const aside = await otherThan(t.storeA1)
    await withSystemScope(db.sql, (tx) => clearBaseline(tx, t.storeA1))
    expect(await otherThan(t.storeA1)).toEqual(aside)
    await db.sql`delete from design_draft where store_id in (${t.storeA1}, ${t.storeA2})`
  })
})

describe('a major upgrade', () => {
  it('is built and checked, never uploaded or switched, and waits for the merchant’s next publish', async () => {
    const before = await live(t.storeA1)
    const p = await rolloutOf('2.0.0', t.storeA1)
    expect(await runStoreUpgrade(upgradeDeps(sandbox().prepare), p, steps(t.storeA1))).toBe('passed')
    const row = await rowOf(p.upgradeId)
    expect(row).toMatchObject({ state: 'passed', gate: { passed: true } })
    expect(await buildOf(row?.publish_run_id ?? '')).toMatchObject({ kind: 'upgrade', state: 'checked', check_only: true, uploaded_at: null })
    expect(await live(t.storeA1)).toBe(before)
    expect(await storefrontOf(t.storeA1)).toMatchObject({ core_upgrade_version: '2.0.0', core_upgrade_commit: row?.commit })
    expect(drafts.keys(upgradeBundle(t.storeA1, row?.commit ?? ''))).toHaveLength(1)
    // A store with a passed major waiting isn't enrolled again for that version.
    const again = await withSystemScope(db.sql, async (tx) => {
      await tx`update core_rollout set state = 'done'`
      const id = await insertRollout(tx, { version: '2.0.0', security: false, by: null, reason: 'Again', at: new Date() })
      await enrolStores(tx, { id, version: '2.0.0' }, 5, new Date())
      return tx<{ store_id: string }[]>`select store_id from core_rollout_store where rollout_id = ${id}`
    })
    expect(again.map((r) => r.store_id)).not.toContain(t.storeA1)
    expect(again.map((r) => r.store_id)).not.toContain(t.storeB1)
  })
})

describe('the push once live', () => {
  it('writes the upgrade’s files to main as one platform commit, and forgets the private copy', async () => {
    const github = localGitHub({ org: 'dripfunnel', installationId: '42', appId: '7' })
    const { privateKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey))))}\n-----END PRIVATE KEY-----`
    const repos = storeRepos(createGitHubApp({ appId: '7', installationId: '42', privateKey: pem, fetchImpl: github.fetch, sleep: async () => undefined }).session(), 'dripfunnel')
    await repos.create('sf-u1u1u1u1u1')
    const first = (await repos.head('sf-u1u1u1u1u1')) ?? ''
    const tree = await repos.writeTree('sf-u1u1u1u1u1', null, [
      { path: 'package.json', content: '{"dependencies":{"@dripfunnel/storefront-core":"1.0.0"}}' },
      { path: '.github/workflows/build.yml', content: 'on: workflow_dispatch\n' },
      { path: 'src/theme/pages/OldPage.tsx', content: 'export const OldPage = () => null' },
    ])
    const head = await repos.commit('sf-u1u1u1u1u1', { tree, parent: first, message: 'Start', at: new Date() })
    await repos.advance('sf-u1u1u1u1u1', head)
    await db.sql`update storefront set repo_state = 'ready', repo_head = ${head} where store_id = ${t.storeA1}`
    const c = commit(9999)
    await putText(drafts, upgradeBundle(t.storeA1, c), 'bundle')
    await putText(drafts, upgradeFiles(t.storeA1, c), JSON.stringify({ files: [{ path: 'package.json', content: '{"dependencies":{"@dripfunnel/storefront-core":"1.1.0"}}' }, { path: 'src/theme/pages/OldPage.tsx', content: null }] }))
    const pushed = await pushUpgrade({ sql: db.sql, repos, drafts, now: () => new Date() }, { storeId: t.storeA1, commit: c, version: '1.1.0', key: 'upgrade:test' })
    expect(pushed.ok).toBe(true)
    const paths = await repos.paths('sf-u1u1u1u1u1', await repos.treeOf('sf-u1u1u1u1u1', (await repos.head('sf-u1u1u1u1u1')) ?? ''))
    expect(paths).toContain('package.json')
    expect(paths).not.toContain('src/theme/pages/OldPage.tsx')
    expect(paths).toContain('.github/workflows/build.yml')
    expect(drafts.keys(`upgrades/${t.storeA1}/`)).toEqual([])
    expect(await pushUpgrade({ sql: db.sql, repos, drafts, now: () => new Date() }, { storeId: t.storeA1, commit: commit(9998), version: '1.1.0', key: 'upgrade:none' })).toEqual({ ok: false, code: 'NO_FILES' })
  })
})

describe('core_rollout_store isolation (DATA-MODEL §7.8, §7.11)', () => {
  const as = (role: string, scope: string, partnerId: string, work: (tx: postgres.TransactionSql) => Promise<unknown>) =>
    db.sql.begin(async (tx: postgres.TransactionSql) => {
      await tx.unsafe(`set local role ${role}`)
      await tx`select set_config('app.scope', ${scope}, true)`
      await tx`select set_config('app.partner_id', ${partnerId}, true)`
      await tx`select set_config('app.store_id', ${t.storeA1}, true)`
      await tx`select set_config('app.seller_id', '', true)`
      return work(tx)
    })

  it('lets a partner read only its own stores’ state, never the report or the commit; staff read all; a merchant nothing', async () => {
    const p = await rolloutOf('1.1.0', t.storeA1)
    await db.sql`insert into core_rollout_store (rollout_id, store_id, position, from_version) values (${p.rolloutId}, ${t.storeB1}, 3, '1.0.0')`
    const ids = (rows: unknown) => (rows as { store_id: string }[]).map((r) => r.store_id).sort()
    expect(ids(await as('app_partner', 'partner', t.partnerA, (tx) => tx`select store_id, state from core_rollout_store where rollout_id = ${p.rolloutId}`))).toEqual([t.storeA1, t.storeA2].sort())
    expect(ids(await as('app_partner', 'partner', t.partnerB, (tx) => tx`select store_id, state from core_rollout_store where rollout_id = ${p.rolloutId}`))).toEqual([t.storeB1])
    await expect(as('app_partner', 'partner', t.partnerA, (tx) => tx`select gate from core_rollout_store`)).rejects.toThrow(/permission denied/)
    await expect(as('app_partner', 'partner', t.partnerA, (tx) => tx`select commit from core_rollout_store`)).rejects.toThrow(/permission denied/)
    await expect(as('app_partner', 'partner', t.partnerA, (tx) => tx`select id from core_rollout`)).rejects.toThrow(/permission denied/)
    await expect(as('app_partner', 'partner', t.partnerA, (tx) => tx`update core_rollout_store set state = 'live'`)).rejects.toThrow(/permission denied/)
    expect(ids(await as('app_platform', 'platform', t.partnerA, (tx) => tx`select store_id from core_rollout_store where rollout_id = ${p.rolloutId}`))).toHaveLength(3)
    await expect(as('app_platform', 'platform', t.partnerA, (tx) => tx`update core_rollout_store set state = 'live'`)).rejects.toThrow(/permission denied/)
    await expect(as('app_request', 'store', t.partnerA, (tx) => tx`select store_id from core_rollout_store`)).rejects.toThrow(/permission denied/)
  })
})
