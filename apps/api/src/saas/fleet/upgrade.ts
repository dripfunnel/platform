import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry } from '#auth/activity'
import { logEvent } from '#core/log'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { clearBaseline, finishStoreUpgrade, selectStoreUpgrade, selectUpgradeSource, setBaseline, setCorePinned, setPendingUpgrade, setStoreUpgradeRun, type StoreUpgradeRow, type StoreUpgradeState } from '#db/scoped/coreRollouts'
import { selectFailingChecks, selectRunOutcome } from '#db/scoped/publishing'
import { activityLog } from '#saas/activity/index'
import { queueSideEffect } from '#saas/outbox/index'
import { failUnswitchedRun, startUpgradePublish, upgradeBundle, upgradeFiles, type SitesBucket } from '#saas/storefronts/index'

// One store's upgrade in a rollout (SAAS §10; storefront ARCHITECTURE §7, LIVE-SHOP §8): the upgrade's commit on the
// store's own live code, made in its sandbox, then the publish pipeline with the new build image, and the push to the
// repo's main only once that build is live. A store ends live, passed (a major), or pinned; never broken live.

export const storefrontUpgradeKind = 'storefront.upgrade'
export const storefrontUpgradePushKind = 'storefront.upgrade_push'
/** The merchant's one notice that the baseline theme is served (ARCHITECTURE §7). */
export const baselineTemplateEmail = 'storefront-baseline'
export const upgradeParams = z.strictObject({ upgradeId: z.uuid(), rolloutId: z.uuid(), storeId: z.uuid() })
export type UpgradeParams = z.infer<typeof upgradeParams>

/** What the store's sandbox is asked for (ARCHITECTURE §7.1): the codemods from `from` to `to` on `sourceBuildId`'s code. */
export type PrepareInput = { from: string; to: string; sourceBuildId: string; baseline: boolean }
export type Prepared = { commit: string; notes: { version: string; kind: string; notes: string }[] }

/** What the migration agent is given (ARCHITECTURE §7): the upgrade's commit, what its build failed, the notes. */
export type MigrateInput = { commit: string; to: string; failing: string[]; notes: Prepared['notes'] }

export interface UpgradeDeps {
  sql: postgres.Sql
  /** The store's StudioSession: its sandbox of version `to`, or `busy` while the merchant's studio is open. */
  prepare: (storeId: string, input: PrepareInput) => Promise<Prepared | 'busy'>
  /** The migration agent's new commit, or null when it couldn't; absent until a model reaches the Workflow (#318, #275). */
  migrate?: ((storeId: string, input: MigrateInput) => Promise<string | 'busy' | null>) | undefined
  drafts: SitesBucket
  now: () => Date
}

/** A Workflow's `step.do` and `step.sleep`: a finished step's answer is kept, so a replay skips it. */
export interface UpgradeSteps {
  do: (name: string, work: () => Promise<string>) => Promise<string>
  sleep: (name: string, ms: number) => Promise<void>
}

// The studio idles out after 10 minutes (AI-STUDIO §7), a build takes minutes; these bound the waits in between.
export const upgradeWaits = { studioMs: 10 * 60_000, studioTries: 12, storeMs: 5 * 60_000, storeTries: 72, buildMs: 5 * 60_000, buildTries: 48, checksTries: 6 } as const

type Claim = { from: string; to: string; template: string; sourceBuildId: string; major: boolean; security: boolean }
type Outcome = { state: string; error: string | null; runId: string | null }

const systemEntry = (row: Pick<StoreUpgradeRow, 'store_id' | 'partner_id'>, action: string, version: string, reason: string | null): ActivityEntry => ({
  category: 'system',
  action,
  result: 'failed',
  actorKind: 'job',
  actorId: 'core-upgrade',
  actorLabel: 'Core upgrade',
  partnerId: row.partner_id,
  storeId: row.store_id,
  target: { type: 'storefront', id: row.store_id, label: 'storefront' },
  changes: [{ field: 'core_version', before: null, after: version }],
  reason,
  api: 'system',
  requestId: null,
  ip: null,
  userAgent: null,
  visibility: 'partner',
})

const finish = (deps: UpgradeDeps, p: UpgradeParams, state: StoreUpgradeState, error: string | null, then?: (tx: ScopedSql, row: StoreUpgradeRow) => Promise<void>): Promise<string> =>
  withSystemScope(deps.sql, async (tx) => {
    const row = await selectStoreUpgrade(tx, p.upgradeId)
    if (!row || row.state !== 'running') return 'stopped'
    await finishStoreUpgrade(tx, row.id, { state, error, at: deps.now() })
    await then?.(tx, row)
    return state
  })

/** The row the tick marked running, and the store's own code to build on; `stopped` once there's nothing to do. */
const claim = (deps: UpgradeDeps, p: UpgradeParams): Promise<string> =>
  withSystemScope(deps.sql, async (tx) => {
    const row = await selectStoreUpgrade(tx, p.upgradeId)
    if (!row || row.store_id !== p.storeId || row.rollout_id !== p.rolloutId || row.state !== 'running') return 'stopped'
    const source = await selectUpgradeSource(tx, row.store_id)
    const at = deps.now()
    if (!source) {
      await finishStoreUpgrade(tx, row.id, { state: 'pinned', error: 'no_live_build', at })
      return 'stopped'
    }
    const claimed: Claim = { from: source.core_version, to: row.version, template: source.template, sourceBuildId: source.build_id, major: row.release_kind === 'major' && !row.security, security: row.security }
    return JSON.stringify(claimed)
  })

/** The upgrade's commit from the store's sandbox, waiting out an open studio. */
const prepareCommit = async (deps: UpgradeDeps, steps: UpgradeSteps, p: UpgradeParams, c: Claim, baseline: boolean, label: string): Promise<Prepared | null> => {
  for (let n = 0; n < upgradeWaits.studioTries; n += 1) {
    const answer = await steps.do(`${label}:${n}`, async () => {
      const made = await deps.prepare(p.storeId, { from: c.from, to: c.to, sourceBuildId: c.sourceBuildId, baseline })
      return made === 'busy' ? 'busy' : JSON.stringify(made)
    })
    if (answer !== 'busy') return JSON.parse(answer) as Prepared
    await steps.sleep(`${label}:wait:${n}`, upgradeWaits.studioMs)
  }
  return null
}

/** One build of `commit` through the publish pipeline, once the store's own publishes leave room; its final state. */
const buildCommit = async (deps: UpgradeDeps, steps: UpgradeSteps, p: UpgradeParams, c: Claim, commit: string, build: { baseline: boolean }, label: string): Promise<Outcome> => {
  let runId: string | null = null
  for (let n = 0; n < upgradeWaits.storeTries && runId === null; n += 1) {
    const started = await steps.do(`${label}:start:${n}`, () =>
      withSystemScope(deps.sql, async (tx) => {
        const at = deps.now()
        const kind = c.security ? 'security' : 'upgrade'
        const run = await startUpgradePublish(tx, { storeId: p.storeId, kind, commit, template: c.template, coreVersion: c.to, checkOnly: c.major && !build.baseline, baseline: build.baseline, at })
        if (run.ok) await setStoreUpgradeRun(tx, p.upgradeId, { commit, runId: run.runId })
        return run.ok ? run.runId : 'busy'
      }),
    )
    if (started !== 'busy') runId = started
    else await steps.sleep(`${label}:start-wait:${n}`, upgradeWaits.storeMs)
  }
  if (runId === null) return { state: 'failed', error: 'store_busy', runId: null }
  const id = runId
  for (let n = 0; n < upgradeWaits.buildTries; n += 1) {
    const outcome = JSON.parse(await steps.do(`${label}:poll:${n}`, async () => JSON.stringify(await withSystemScope(deps.sql, (tx) => selectRunOutcome(tx, p.storeId, id))))) as Omit<Outcome, 'runId'> | null
    if (outcome && ['live', 'checked', 'failed', 'rolled_back'].includes(outcome.state)) return { ...outcome, runId: id }
    await steps.sleep(`${label}:wait:${n}`, upgradeWaits.buildMs)
  }
  // Past the wait the run is failed, so it can't go live later; a switched one has its checks' few minutes to end.
  const stopped = await steps.do(`${label}:timeout`, () => withSystemScope(deps.sql, (tx) => failUnswitchedRun(tx, { storeId: p.storeId, runId: id, code: 'build_timed_out', at: deps.now() })))
  for (let n = 0; n < (stopped === 'switched' ? upgradeWaits.checksTries : 1); n += 1) {
    const outcome = JSON.parse(await steps.do(`${label}:last:${n}`, async () => JSON.stringify(await withSystemScope(deps.sql, (tx) => selectRunOutcome(tx, p.storeId, id))))) as Omit<Outcome, 'runId'> | null
    if (outcome && ['live', 'checked', 'failed', 'rolled_back'].includes(outcome.state)) return { ...outcome, runId: id }
    await steps.sleep(`${label}:last-wait:${n}`, upgradeWaits.buildMs)
  }
  return { state: 'deploying', error: 'build_timed_out', runId: id }
}

const pinned = (deps: UpgradeDeps, p: UpgradeParams, version: string, error: string) =>
  finish(deps, p, 'pinned', error, async (tx, row) => {
    await setCorePinned(tx, row.store_id, error)
    await activityLog.record(tx, systemEntry(row, 'storefront.core_pinned', version, error))
    logEvent({ event: 'core_upgrade_pinned', api: 'system', partnerId: row.partner_id, storeId: row.store_id, code: error })
  })

/** Live on the new core: the commit reaches the repo's main through the push API, retried by the outbox (LIVE-SHOP §8). */
const wentLive = (deps: UpgradeDeps, p: UpgradeParams, c: Claim, commit: string, state: 'live' | 'migrated') =>
  finish(deps, p, state, null, async (tx, row) => {
    await setCorePinned(tx, row.store_id, null)
    // The store's own theme, upgraded, is live again: a baseline it was on is over (ARCHITECTURE §7).
    await clearBaseline(tx, row.store_id)
    await queueSideEffect(tx, { kind: storefrontUpgradePushKind, idempotencyKey: `upgrade-push:${row.id}:${commit}`, payload: { storeId: row.store_id, commit, version: c.to, key: `upgrade:${row.id}` }, partnerId: row.partner_id, storeId: row.store_id })
  })

/** A major passed: recorded, and its commit waits for the merchant's next publish (ARCHITECTURE §7, the #337 rule). */
const passed = (deps: UpgradeDeps, p: UpgradeParams, c: Claim, commit: string, state: 'passed' | 'migrated') =>
  finish(deps, p, state, null, async (tx, row) => {
    await setCorePinned(tx, row.store_id, null)
    await setPendingUpgrade(tx, row.store_id, { version: c.to, commit })
  })

/**
 * A security fix its own theme can't take: the baseline theme with its own words and tokens is live (ARCHITECTURE §7),
 * never pushed to the repo, and the merchant is told once.
 */
const servedBaseline = (deps: UpgradeDeps, p: UpgradeParams, c: Claim, reason: string) =>
  finish(deps, p, 'baseline', reason, async (tx, row) => {
    await setCorePinned(tx, row.store_id, null)
    await setBaseline(tx, row.store_id, { reason, fromBuildId: c.sourceBuildId })
    await activityLog.record(tx, systemEntry(row, 'storefront.baseline_served', c.to, reason))
    await queueSideEffect(tx, { kind: 'email', idempotencyKey: `baseline:${row.id}`, payload: { template: baselineTemplateEmail, storeId: row.store_id }, partnerId: row.partner_id, storeId: row.store_id })
  })

/** The migration agent's commit, waiting out an open studio like the upgrade's own (SAAS §10). */
const migrateCommit = async (deps: UpgradeDeps, steps: UpgradeSteps, p: UpgradeParams, c: Claim, input: MigrateInput): Promise<string | null> => {
  const migrate = deps.migrate
  if (!migrate) return null
  for (let n = 0; n < upgradeWaits.studioTries; n += 1) {
    const answer = await steps.do(`migrate:${n}`, async () => (await migrate(p.storeId, input)) ?? 'none')
    if (answer !== 'busy') return answer === 'none' ? null : answer
    await steps.sleep(`migrate:wait:${n}`, upgradeWaits.studioMs)
  }
  return null
}

/** Removes an upgrade's private commit once nothing will build or push it. */
const forget = async (deps: UpgradeDeps, storeId: string, commit: string) => deps.drafts.delete([upgradeBundle(storeId, commit), upgradeFiles(storeId, commit)])

export const runStoreUpgrade = async (deps: UpgradeDeps, p: UpgradeParams, steps: UpgradeSteps): Promise<string> => {
  const claimed = await steps.do('claim', () => claim(deps, p))
  if (claimed === 'stopped') return 'stopped'
  const c = JSON.parse(claimed) as Claim
  if (c.from === c.to) return steps.do('already', () => finish(deps, p, 'live', null))
  const prepared = await prepareCommit(deps, steps, p, c, false, 'prepare')
  if (!prepared) return steps.do('pin', () => pinned(deps, p, c.to, 'studio_busy'))
  let commit = prepared.commit
  let outcome = await buildCommit(deps, steps, p, c, commit, { baseline: false }, 'build')
  const reason = outcome.error ?? 'upgrade_failed'
  let migrated = false
  // The migration agent repairs what the gate refused; a build the edge rolled back or that never ran is pinned as it is.
  const failedRun = outcome.runId
  if (outcome.state === 'failed' && outcome.error === 'gate_failed' && failedRun) {
    const failing = JSON.parse(await steps.do('failing', async () => JSON.stringify(await withSystemScope(deps.sql, (tx) => selectFailingChecks(tx, p.storeId, failedRun))))) as string[]
    const agent = await migrateCommit(deps, steps, p, c, { commit, to: c.to, failing, notes: prepared.notes })
    if (agent) {
      const before = commit
      await steps.do('forget-unmigrated', () => forget(deps, p.storeId, before).then(() => 'forgotten'))
      commit = agent
      migrated = true
      outcome = await buildCommit(deps, steps, p, c, commit, { baseline: false }, 'migrated')
    }
  }
  const done = commit
  if (outcome.state === 'live') return steps.do('live', () => wentLive(deps, p, c, done, migrated ? 'migrated' : 'live'))
  if (outcome.state === 'checked') return steps.do('passed', () => passed(deps, p, c, done, migrated ? 'migrated' : 'passed'))
  // A build still deciding keeps its commit, in case its checks keep it live.
  if (outcome.state === 'deploying') return steps.do('pin', () => pinned(deps, p, c.to, reason))
  await steps.do('forget', () => forget(deps, p.storeId, done).then(() => 'forgotten'))
  if (c.security) {
    const baseline = await prepareCommit(deps, steps, p, c, true, 'baseline')
    if (baseline) {
      const served = await buildCommit(deps, steps, p, c, baseline.commit, { baseline: true }, 'baseline-build')
      await steps.do('forget-baseline', () => forget(deps, p.storeId, baseline.commit).then(() => 'forgotten'))
      if (served.state === 'live') return steps.do('baseline', () => servedBaseline(deps, p, c, reason))
    }
  }
  return steps.do('pin', () => pinned(deps, p, c.to, reason))
}
