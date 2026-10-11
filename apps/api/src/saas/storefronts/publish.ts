import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry } from '#auth/activity'
import { failureCode, logEvent } from '#core/log'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import {
  confirmLive,
  failAttempt,
  failOpenAttempts,
  failRun,
  finishChecked,
  finishRepaired,
  hasActiveRun,
  insertAttempt,
  insertQueuedRun,
  lockStorefront,
  moveLiveTo,
  recordChecks,
  rollBackRun,
  selectBisectedRun,
  selectDraftCommits,
  selectFailingChecks,
  selectGateVerdict,
  selectQueuedRun,
  selectRun,
  buildFilesKept,
  followLiveBuild,
  setQueuedRender,
  widenQueuedRun,
  selectStartedAt,
  selectStorefrontHost,
  selectVersion,
  setBisectCommit,
  setRepairAttempts,
  startRun,
  switchLive,
  versionOfBuild,
  type NewRun,
  type QueuedRun,
  type RunRow,
} from '#db/scoped/publishing'
import { isUploaded, isVerified } from '#db/scoped/builds'
import type { EdgeProbe } from '#integrations/http/edgeProbe'
import { activityLog } from '#saas/activity/index'
import { queueSideEffect } from '#saas/outbox/index'
import { buildLifetimeMs } from './builds'
import { maxRepairs } from '#saas/studio/index'
import { dispatchBuild, freezeBuild, freezeRefusals, type FreezeDeps } from './freeze'
import { buildFolder, manifestName, stagingFolder } from './layout'
import { manifestSchema } from './manifest'
import { failedCheck, runPostDeployChecks, type CheckResult } from './postDeploy'
import { deletePrefix, type SitesBucket } from './templates'
import { copyInherited, inheritBatch, inheritPlan, maxRenderPages, mergeRender, sealRender, type RenderRequest } from './render'
import { uploadRefusals, verifyUpload } from './verify'

// The publish-storefront Workflow (SAAS §9.1; storefront LIVE-SHOP.md §4): queued → building (frozen, dispatched) →
// deploying on a passing report (uploaded, verified, switched, checked from the edge: §4 step 10) → live | rolled_back;
// a failing report → checking → failed.

export const storefrontPublishKind = 'storefront.publish'
/** A page run's own Workflow (`jobs/workflows/render-page.ts`), started the same way. */
export const storefrontRenderPageKind = 'storefront.render_page'
/** IndexNow for a build that stayed live (ARCHITECTURE §8), delivered by `jobs/queues/deliverers/indexNow.ts`. */
export const storefrontIndexNowKind = 'storefront.indexnow'
export const publishParams = z.strictObject({ runId: z.uuid(), storeId: z.uuid() })
export type PublishParams = z.infer<typeof publishParams>

const queueRun = (tx: ScopedSql, storeId: string, partnerId: string, run: Pick<QueuedRun, 'id' | 'kind'>) =>
  queueSideEffect(tx, { kind: run.kind === 'page' ? storefrontRenderPageKind : storefrontPublishKind, idempotencyKey: `publish:${run.id}`, payload: { runId: run.id, storeId }, partnerId, storeId })

/** The next waiting run, once the running one has finished (one build at a time per store, SAAS §9.1). */
const queueNext = async (tx: ScopedSql, storeId: string, partnerId: string): Promise<void> => {
  const next = await selectQueuedRun(tx, storeId)
  if (next) await queueRun(tx, storeId, partnerId, next)
}

/**
 * Starts a publish in the caller's transaction: a run starts at once when none is running, else waits behind it; a second
 * press while one already waits is that run (SAAS §9.1). Called by #318's Publish now and design publish, and the cron.
 */
export const startPublish = async (tx: ScopedSql, run: Omit<NewRun, 'storeId'> & { storeId: string }): Promise<{ ok: true; runId: string } | { ok: false; reason: 'NO_STOREFRONT' }> => {
  const storefront = await lockStorefront(tx, run.storeId)
  if (!storefront) return { ok: false, reason: 'NO_STOREFRONT' }
  const waiting = await selectQueuedRun(tx, run.storeId)
  if (waiting) {
    if (waiting.kind === 'page' && run.kind !== 'page') await widenQueuedRun(tx, run.storeId, waiting.id, run)
    return { ok: true, runId: waiting.id }
  }
  const runId = await insertQueuedRun(tx, run)
  if (!(await hasActiveRun(tx, run.storeId))) await queueRun(tx, run.storeId, storefront.partner_id, { id: runId, kind: run.kind })
  return { ok: true, runId }
}

export type UpgradeStart = { ok: true; runId: string } | { ok: false; reason: 'BUSY' | 'NO_STOREFRONT' }

/**
 * The upgrade bot's publish (LIVE-SHOP §8): it never merges into a waiting run, so it starts only when the store has none
 * running or waiting; otherwise the bot tries again later.
 */
export const startUpgradePublish = async (tx: ScopedSql, run: Omit<NewRun, 'usesAllowance' | 'startedBy'> & { kind: 'upgrade' | 'security' }): Promise<UpgradeStart> => {
  const storefront = await lockStorefront(tx, run.storeId)
  if (!storefront) return { ok: false, reason: 'NO_STOREFRONT' }
  if ((await selectQueuedRun(tx, run.storeId)) || (await hasActiveRun(tx, run.storeId))) return { ok: false, reason: 'BUSY' }
  const runId = await insertQueuedRun(tx, { ...run, usesAllowance: false, startedBy: { kind: 'system', id: null } })
  await queueRun(tx, run.storeId, storefront.partner_id, { id: runId, kind: run.kind })
  return { ok: true, runId }
}

export type RenderResult = { ok: true; runId: string } | { ok: false; reason: 'NO_LIVE_BUILD' }

/**
 * A single-page render (LIVE-SHOP §7): a page run of the live commit, with no allowance. A waiting page run takes the
 * addresses too, up to `maxRenderPages`, past which it becomes an automatic full publish; a waiting full publish covers them.
 */
export const requestPageRender = (sql: postgres.Sql, request: RenderRequest, now: Date): Promise<RenderResult> =>
  withSystemScope(sql, async (tx) => {
    const storefront = await lockStorefront(tx, request.storeId)
    const live = storefront?.live_build_id ? await selectRun(tx, storefront.live_build_id) : null
    if (!storefront || !live) return { ok: false, reason: 'NO_LIVE_BUILD' }
    const render = { pages: request.pages, drop: request.drop.filter((d) => !request.pages.includes(d)) }
    const waiting = await selectQueuedRun(tx, request.storeId)
    if (waiting?.kind === 'page' && waiting.render) {
      const merged = mergeRender(waiting.render, render)
      if (merged.pages.length + merged.drop.length <= maxRenderPages) await setQueuedRender(tx, request.storeId, waiting.id, merged)
      else await widenQueuedRun(tx, request.storeId, waiting.id, { kind: 'automatic', commit: live.commit, template: live.template, coreVersion: live.core_version, usesAllowance: false, startedBy: { kind: 'system', id: null } })
      return { ok: true, runId: waiting.id }
    }
    if (waiting) return { ok: true, runId: waiting.id }
    const started = await startPublish(tx, { storeId: request.storeId, kind: 'page', commit: live.commit, template: live.template, coreVersion: live.core_version, usesAllowance: false, startedBy: { kind: 'system', id: null }, at: now, render })
    return started.ok ? started : { ok: false, reason: 'NO_LIVE_BUILD' }
  })

export interface PublishDeps extends FreezeDeps {
  /** Absent until the designer's model reaches the Workflow (#318): a failing design publish then goes straight to bisect. */
  repair?: PublishRepair
  sites: SitesBucket
  /** The public bucket the verified JS and CSS are copied into (LIVE-SHOP §4 step 9). */
  assets: SitesBucket
  /** The edge as a shopper reaches it, for the post-deploy checks (LIVE-SHOP §4 step 10). */
  probe: EdgeProbe
  /** `sf-assets.<EDGE_ZONE>` (LIVE-SHOP §2): with the store's own host, the only one whose scripts the checks load. */
  assetHost: string
  wait: (ms: number) => Promise<void>
}

/**
 * The studio's change loop asked to fix the failing checks (AI-STUDIO §6): the draft's new commit, or null. `key` is
 * `{run}:{n}`, so a retried step gets the change already made, never a second one.
 */
export type PublishRepair = (storeId: string, failing: string[], key: string) => Promise<string | null>

/** What the build's calls wake its publish run with (`step.waitForEvent` types, LIVE-SHOP §4 "The build calls"). */
export type BuildEvent = 'reported' | 'uploaded'

/** A Workflow's `step.do`: a step's answer is kept, so a replay skips what already finished. */
export interface PublishSteps {
  /** `long` is the post-deploy checks' step, bounded by `checksLimitMs` rather than the usual five minutes. */
  do: (name: string, work: () => Promise<string>, long?: 'long') => Promise<string>
  /** `step.waitForEvent` for the build's report or upload; throws once `timeoutMinutes` pass without it. */
  waitFor: (name: string, event: BuildEvent, timeoutMinutes: number) => Promise<void>
}

class Busy extends Error {
  override name = 'Busy'
}
class BuildMissing extends Error {
  override name = 'BuildMissing'
}

const systemEntry = (run: RunRow, action: string, result: 'success' | 'failed', changes: NonNullable<ActivityEntry['changes']>): ActivityEntry => ({
  category: 'system',
  action,
  result,
  actorKind: 'job',
  actorId: 'publish-storefront',
  actorLabel: 'Publishing',
  partnerId: run.partner_id,
  storeId: run.store_id,
  target: { type: 'storefront', id: run.store_id, label: 'storefront' },
  changes,
  reason: null,
  api: 'system',
  requestId: null,
  ip: null,
  userAgent: null,
  visibility: 'partner',
})

const claimStep = (deps: PublishDeps, p: PublishParams): Promise<string> =>
  withSystemScope(deps.sql, async (tx) => {
    const storefront = await lockStorefront(tx, p.storeId)
    if (!storefront) return 'stopped'
    const run = await selectRun(tx, p.runId)
    if (!run || run.store_id !== p.storeId) return 'stopped'
    // A page run renders some pages; a waiting one a press widened is a full publish (LIVE-SHOP §7).
    const claimed = run.kind === 'page' ? 'claimed:page' : 'claimed'
    if (run.state !== 'queued') return run.state === 'building' || run.state === 'checking' || run.state === 'deploying' ? claimed : 'stopped'
    // The partial unique index refuses a second running build anyway; this says why, and the Workflow tries again.
    if (await hasActiveRun(tx, p.storeId)) throw new Busy('another publish is running')
    // A publish may have gone live while this page run waited: it renders beside that build, with its code and core.
    const live = run.kind === 'page' && storefront.live_build_id ? await selectRun(tx, storefront.live_build_id) : null
    if (live) await followLiveBuild(tx, p.storeId, run.id, live)
    await startRun(tx, live ? { ...run, commit: live.commit, template: live.template, core_version: live.core_version } : run, deps.now())
    return claimed
  })

/** Every staged object hashed to the manifest whose digest the passing report sent, and copied (LIVE-SHOP §4 step 9). */
const verifyStep = async (deps: PublishDeps, storeId: string, buildId: string, seal = true): Promise<string> => {
  await verifyUpload(deps, storeId, buildId, { seal })
  return 'verified'
}

/** A page run's folder completed from the live build's, a batch per step, then sealed (LIVE-SHOP §7). */
const inheritSteps = async (deps: PublishDeps, p: PublishParams, steps: PublishSteps): Promise<void> => {
  const count = Number(await steps.do('inherit', async () => String((await inheritPlan(deps, p.storeId, p.runId)).files.length)))
  for (let batch = 0; batch * inheritBatch < count; batch++) {
    await steps.do(`inherit:${batch}`, async () => {
      await copyInherited(deps, p.storeId, p.runId, await inheritPlan(deps, p.storeId, p.runId), batch)
      return 'copied'
    })
  }
  await steps.do('seal', async () => {
    await sealRender(deps, p.storeId, p.runId, await inheritPlan(deps, p.storeId, p.runId))
    return 'sealed'
  })
}

/** A major's upgrade passed its gate and stops there: nothing goes live until the merchant's next publish (ARCHITECTURE §7). */
const checkedStep = (deps: PublishDeps, p: PublishParams): Promise<string> =>
  withSystemScope(deps.sql, async (tx) => {
    const run = await selectRun(tx, p.runId)
    if (!run || run.store_id !== p.storeId || run.state !== 'checked') return 'go'
    await finishChecked(tx, run, deps.now())
    await queueNext(tx, run.store_id, run.partner_id)
    return 'checked'
  })

/** The report's verdict once it came (LIVE-SHOP §4 step 7). */
const reportedStep = (deps: PublishDeps, storeId: string, buildId: string): Promise<string> =>
  withSystemScope(deps.sql, async (tx) => {
    const passed = await selectGateVerdict(tx, storeId, buildId)
    return passed === null ? 'waiting' : passed ? 'passed' : 'failed'
  })

const uploadedStep = (deps: PublishDeps, storeId: string, buildId: string): Promise<string> =>
  withSystemScope(deps.sql, async (tx) => ((await isUploaded(tx, storeId, buildId)) ? 'uploaded' : 'waiting'))

/** The pointer moves to `buildId`, the publish's own build or its repair's; the run stays deploying until its checks end. */
const switchStep = (deps: PublishDeps, p: PublishParams, buildId: string): Promise<string> =>
  withSystemScope(deps.sql, async (tx) => {
    const storefront = await lockStorefront(tx, p.storeId)
    const run = await selectRun(tx, buildId)
    if (!storefront || !run || run.store_id !== p.storeId || run.state !== 'deploying') return 'stopped'
    if (run.switched_at) return 'switched'
    // The pointer moves only to a build whose every file was verified, whoever runs this step (LIVE-SHOP §4 step 9).
    if (!(await isVerified(tx, run.store_id, run.id))) throw new BuildMissing('the build is not verified')
    await switchLive(tx, run, storefront.live_build_id, deps.now())
    await queueSideEffect(tx, { kind: 'cache.purge', idempotencyKey: `publish:${run.id}`, payload: { storeId: run.store_id, reason: 'publish' }, partnerId: run.partner_id, storeId: run.store_id })
    return 'switched'
  })

/** The build's own file list, written last by the copy, so the checks find its product and checkout pages. */
const buildFiles = async (deps: PublishDeps, storeId: string, buildId: string): Promise<string[]> => {
  const object = await deps.sites.get(`${buildFolder(storeId, buildId)}${manifestName}`)
  const parsed = manifestSchema.safeParse(object ? JSON.parse(await object.text()) : null)
  if (!parsed.success) throw new BuildMissing('the build has no manifest')
  return parsed.data.files.map((f) => f.path)
}

/** Checks the switched build from the edge and keeps the results on the run; answers `passed` or the failed check's code. */
const checksStep = async (deps: PublishDeps, storeId: string, buildId: string): Promise<string> => {
  const host = await withSystemScope(deps.sql, (tx) => selectStorefrontHost(tx, storeId))
  const results: CheckResult[] = host
    ? await runPostDeployChecks(deps.probe, { host, assetHost: deps.assetHost, buildId, files: await buildFiles(deps, storeId, buildId) }, { wait: deps.wait, now: () => deps.now().getTime() })
    : [{ name: 'home', result: 'skipped', detail: 'The store has no address yet.' }]
  await withSystemScope(deps.sql, (tx) => recordChecks(tx, buildId, results))
  return failedCheck(results) ?? 'passed'
}

/** The build stayed live: it, and a repaired publish with it, read live (SAAS §9.1). */
const confirmStep = async (deps: PublishDeps, p: PublishParams, buildId: string): Promise<string> => {
  const confirmed = await withSystemScope(deps.sql, async (tx) => {
    if (!(await lockStorefront(tx, p.storeId))) return false
    const run = await selectRun(tx, buildId)
    if (!run || run.store_id !== p.storeId || run.state !== 'deploying' || !run.switched_at) return false
    const at = deps.now()
    await confirmLive(tx, run, at)
    if (buildId !== p.runId) await finishRepaired(tx, p.storeId, p.runId, at)
    const version = await versionOfBuild(tx, run.id)
    await queueSideEffect(tx, { kind: storefrontIndexNowKind, idempotencyKey: `indexnow:${run.id}`, payload: { storeId: run.store_id, buildId: run.id, previousBuildId: run.previous_build_id }, partnerId: run.partner_id, storeId: run.store_id })
    await activityLog.record(tx, systemEntry(run, 'storefront.published', 'success', [{ field: 'version', before: null, after: version === null ? null : String(version) }]))
    await queueNext(tx, run.store_id, run.partner_id)
    return true
  })
  if (confirmed) await deletePrefix(deps.sites, stagingFolder(p.storeId, buildId))
  return confirmed ? 'live' : 'stopped'
}

/**
 * The automatic rollback (LIVE-SHOP §4 step 10): the pointer moves back to the build `buildId` replaced; a repaired
 * publish fails with it. Idempotent: a replay finds the build rolled back and changes nothing.
 */
const rollbackStep = (deps: PublishDeps, p: PublishParams, buildId: string, code: string): Promise<string> =>
  withSystemScope(deps.sql, async (tx) => {
    const storefront = await lockStorefront(tx, p.storeId)
    const run = await selectRun(tx, buildId)
    if (!storefront || !run || run.store_id !== p.storeId) return 'stopped'
    if (run.state === 'rolled_back') return 'rolled_back'
    if (run.state !== 'deploying' || !run.switched_at || storefront.live_build_id !== run.id) return 'stopped'
    const at = deps.now()
    const versions = await rollBackRun(tx, run, code, at)
    const root = buildId !== p.runId ? await selectRun(tx, p.runId) : null
    if (root) await failRun(tx, root, code, at)
    await queueSideEffect(tx, { kind: 'cache.purge', idempotencyKey: `rollback:${run.id}`, payload: { storeId: run.store_id, reason: 'rollback' }, partnerId: run.partner_id, storeId: run.store_id })
    await activityLog.record(tx, {
      ...systemEntry(run, 'storefront.rolled_back', 'failed', [{ field: 'version', before: versions.withdrawn === null ? null : String(versions.withdrawn), after: versions.back === null ? null : String(versions.back) }]),
      reason: code,
    })
    await queueNext(tx, run.store_id, run.partner_id)
    logEvent({ event: 'storefront_rolled_back', api: 'system', storeId: run.store_id, code })
    return 'rolled_back'
  })

/** The live build stays as it was; nothing became public (LIVE-SHOP §4 step 8). A build that already switched rolls back. */
const failStep = async (deps: PublishDeps, p: PublishParams, code: string, buildId: string): Promise<string> => {
  const switched = await withSystemScope(deps.sql, async (tx) => (await selectRun(tx, buildId))?.switched_at ?? null)
  if (switched) return rollbackStep(deps, p, buildId, code)
  const attempts = await withSystemScope(deps.sql, async (tx) => {
    if (!(await lockStorefront(tx, p.storeId))) return []
    const run = await selectRun(tx, p.runId)
    if (!run || run.store_id !== p.storeId || run.switched_at || run.state === 'live' || run.state === 'failed' || run.state === 'rolled_back') return []
    const ended = await failOpenAttempts(tx, p.storeId, p.runId, code, deps.now())
    await failRun(tx, run, code, deps.now())
    await activityLog.record(tx, systemEntry(run, 'storefront.publish_failed', 'failed', [{ field: 'error', before: null, after: code }]))
    await queueNext(tx, run.store_id, run.partner_id)
    return ended
  })
  for (const id of [p.runId, ...attempts]) await deletePrefix(deps.sites, stagingFolder(p.storeId, id))
  return 'failed'
}

/**
 * The regression rule's rollback of a build already live (ARCHITECTURE §9): the same pointer move back, refused while a
 * publish runs, once the build moved on, or when clean-up removed the build before it.
 */
export const rollBackLiveBuild = (sql: postgres.Sql, input: { storeId: string; runId: string; code: string; now: Date }): Promise<'rolled_back' | 'busy' | 'refused'> =>
  withSystemScope(sql, async (tx) => {
    const storefront = await lockStorefront(tx, input.storeId)
    const run = await selectRun(tx, input.runId)
    if (!storefront || !run || run.store_id !== input.storeId || run.state !== 'live' || storefront.live_build_id !== run.id || !run.previous_build_id) return 'refused'
    if (await hasActiveRun(tx, input.storeId)) return 'busy'
    if (!(await buildFilesKept(tx, run.previous_build_id))) return 'refused'
    const versions = await rollBackRun(tx, run, input.code, input.now)
    await queueSideEffect(tx, { kind: 'cache.purge', idempotencyKey: `rollback:${run.id}`, payload: { storeId: run.store_id, reason: 'rollback' }, partnerId: run.partner_id, storeId: run.store_id })
    await activityLog.record(tx, {
      ...systemEntry(run, 'storefront.rolled_back', 'failed', [{ field: 'version', before: versions.withdrawn === null ? null : String(versions.withdrawn), after: versions.back === null ? null : String(versions.back) }]),
      reason: input.code,
    })
    return 'rolled_back'
  })

const errorCodes: Record<string, string> = { Busy: 'busy', BuildMissing: 'build_missing', UploadTimedOut: 'upload_timed_out', ReportTimedOut: 'report_timed_out', GateFailed: 'gate_failed', Bisected: 'bisected' }
// A step's error may come back from the Workflow runtime as a plain Error, so a refusal's code travels as its message.
const codeOf = (error: unknown): string => {
  if (!(error instanceof Error)) return 'deploy_failed'
  if (uploadRefusals.has(error.message) || freezeRefusals.has(error.message)) return error.message
  return errorCodes[error.name] ?? 'deploy_failed'
}

class UploadTimedOut extends Error {
  override name = 'UploadTimedOut'
}
class ReportTimedOut extends Error {
  override name = 'ReportTimedOut'
}
class GateFailed extends Error {
  override name = 'GateFailed'
}
/** The gate refused the publish, and bisect found the change that broke it: "publish everything before this change". */
class Bisected extends Error {
  override name = 'Bisected'
}

/** One deadline per build: the build id's 2 hours from its claim, which its report and its upload share (LIVE-SHOP §9). */
const deadlineOf = (deps: PublishDeps, storeId: string, buildId: string): Promise<string> =>
  withSystemScope(deps.sql, async (tx) => new Date(((await selectStartedAt(tx, storeId, buildId)) ?? deps.now()).getTime() + buildLifetimeMs).toISOString())

const minutesBefore = (deps: PublishDeps, deadline: string) => Math.max(1, Math.ceil((new Date(deadline).getTime() - deps.now().getTime()) / 60_000))

/** One build through the gate: frozen, dispatched, then its report; `label` keeps each build's steps apart. */
const gateBuild = async (deps: PublishDeps, steps: PublishSteps, storeId: string, buildId: string, label: string): Promise<boolean> => {
  await steps.do(`${label}freeze`, () => freezeBuild(deps, storeId, buildId))
  await steps.do(`${label}dispatch`, () => dispatchBuild(deps, storeId, buildId))
  const deadline = await steps.do(`${label}deadline`, () => deadlineOf(deps, storeId, buildId))
  // The build's "report" and "uploaded" calls wake this run; a DB check comes first, so one that came early isn't missed.
  if ((await steps.do(`${label}reported`, () => reportedStep(deps, storeId, buildId))) === 'waiting') {
    await steps.waitFor(`${label}report`, 'reported', minutesBefore(deps, deadline)).catch(() => {
      throw new ReportTimedOut('no report within the build id’s lifetime')
    })
  }
  return (await steps.do(`${label}verdict`, () => reportedStep(deps, storeId, buildId))) === 'passed'
}

/** A repair's or a bisect's build of `commit`, gated as the publish's own was; a failing one ends at once. */
const attemptBuild = async (deps: PublishDeps, steps: PublishSteps, p: PublishParams, attempt: 'repair' | 'bisect', commit: string, label: string): Promise<{ id: string; passed: boolean }> => {
  const id = await steps.do(`${label}start`, () =>
    withSystemScope(deps.sql, async (tx) => {
      const root = await selectRun(tx, p.runId)
      if (!root) throw new GateFailed('the publish is gone')
      return insertAttempt(tx, root, attempt, commit, deps.now())
    }),
  )
  const passed = await gateBuild(deps, steps, p.storeId, id, label)
  if (!passed) await steps.do(`${label}end`, async () => withSystemScope(deps.sql, (tx) => failAttempt(tx, p.storeId, id, deps.now())).then(() => 'failed'))
  return { id, passed }
}

/** ARCHITECTURE §4.2 step 4, a design publish only: the AI repairs its own code from the report, at most three times. */
const repairs = async (deps: PublishDeps, steps: PublishSteps, p: PublishParams): Promise<string | null> => {
  const repair = deps.repair
  if (!repair) return null
  // Each try is told what the last build failed: the publish's own first, then the previous repair's.
  let failed = p.runId
  for (let n = 1; n <= maxRepairs; n += 1) {
    const from = failed
    await steps.do(`repair-${n}:count`, () => withSystemScope(deps.sql, (tx) => setRepairAttempts(tx, p.storeId, p.runId, n)).then(() => String(n)))
    const commit = await steps.do(`repair-${n}`, async () => {
      const failing = await withSystemScope(deps.sql, (tx) => selectFailingChecks(tx, p.storeId, from))
      return (await repair(p.storeId, failing, `${p.runId}:${n}`)) ?? 'none'
    })
    if (commit === 'none') return null
    const built = await attemptBuild(deps, steps, p, 'repair', commit, `repair-${n}:`)
    if (built.passed) return built.id
    failed = built.id
  }
  return null
}

/**
 * Then bisect the draft's changes up to the publish's commit, the live version's commit standing as good, to the first
 * that fails the gate; each probe is a build of its own that is checked, never uploaded.
 */
const bisect = async (deps: PublishDeps, steps: PublishSteps, p: PublishParams): Promise<string | null> => {
  const chain = JSON.parse(
    await steps.do('bisect-commits', async () =>
      withSystemScope(deps.sql, async (tx) => {
        const root = await selectRun(tx, p.runId)
        const commits = await selectDraftCommits(tx, p.storeId)
        const at = root ? commits.indexOf(root.commit) : -1
        return JSON.stringify(at < 0 ? [] : commits.slice(0, at + 1))
      }),
    ),
  ) as string[]
  if (chain.length === 0) return null
  let good = -1
  let bad = chain.length - 1
  while (bad - good > 1) {
    const mid = Math.floor((good + bad) / 2)
    const commit = chain[mid] ?? ''
    if ((await attemptBuild(deps, steps, p, 'bisect', commit, `bisect-${commit}:`)).passed) good = mid
    else bad = mid
  }
  const first = chain[bad] ?? ''
  await steps.do('bisect-found', () => withSystemScope(deps.sql, (tx) => setBisectCommit(tx, p.storeId, p.runId, first)).then(() => first))
  return bad > 0 ? first : null
}

/** A publish of any kind; a page run completes its folder from the live build's before the switch (LIVE-SHOP §7). */
export const runPublish = async (deps: PublishDeps, p: PublishParams, steps: PublishSteps): Promise<'live' | 'checked' | 'failed' | 'rolled_back' | 'stopped'> => {
  let liveId = p.runId
  try {
    const claimed = await steps.do('claim', () => claimStep(deps, p))
    if (claimed === 'stopped') return 'stopped'
    const render = claimed === 'claimed:page'
    if (!(await gateBuild(deps, steps, p.storeId, p.runId, ''))) {
      const kind = await steps.do('kind', () => withSystemScope(deps.sql, async (tx) => (await selectRun(tx, p.runId))?.kind ?? 'gone'))
      if (kind !== 'design') throw new GateFailed('the gate refused the build')
      const repaired = await repairs(deps, steps, p)
      if (!repaired) throw (await bisect(deps, steps, p)) ? new Bisected('publish everything before this change') : new GateFailed('the gate refused the build')
      liveId = repaired
    } else if ((await steps.do('checked', () => checkedStep(deps, p))) === 'checked') return 'checked'
    if ((await steps.do('uploaded', () => uploadedStep(deps, p.storeId, liveId))) === 'waiting') {
      const deadline = await steps.do('upload-deadline', () => deadlineOf(deps, p.storeId, liveId))
      await steps.waitFor('upload', 'uploaded', minutesBefore(deps, deadline)).catch(() => {
        throw new UploadTimedOut('no upload within the build id’s lifetime')
      })
    }
    await steps.do('verify', () => verifyStep(deps, p.storeId, liveId, !render))
    if (render) await inheritSteps(deps, p, steps)
    if ((await steps.do('switch', () => switchStep(deps, p, liveId))) === 'stopped') return 'stopped'
    const verdict = await steps.do('checks', () => checksStep(deps, p.storeId, liveId), 'long')
    if (verdict !== 'passed') return (await steps.do('rollback', () => rollbackStep(deps, p, liveId, verdict))) === 'rolled_back' ? 'rolled_back' : 'stopped'
    return (await steps.do('confirm', () => confirmStep(deps, p, liveId))) === 'live' ? 'live' : 'stopped'
  } catch (error) {
    const code = codeOf(error)
    logEvent({ event: 'storefront_publish_failed', api: 'system', storeId: p.storeId, code: `${code}:${failureCode(error)}` })
    return (await steps.do('fail', () => failStep(deps, p, code, liveId))) === 'rolled_back' ? 'rolled_back' : 'failed'
  }
}

export type PublishBeforeResult = { ok: true; runId: string } | { ok: false; reason: 'NOT_BISECTED' | 'NOTHING_BEFORE' | 'NO_STOREFRONT' }

/**
 * "Publish everything before this change" (ARCHITECTURE §4.2 step 4), which SAPI 17's Store API offers with the change's
 * commit: a design publish of the draft's change just before the one bisect found, using no allowance.
 */
export const publishBefore = async (tx: ScopedSql, input: { storeId: string; commit: string; by: string | null; at: Date }): Promise<PublishBeforeResult> => {
  const bisected = await selectBisectedRun(tx, input.storeId, input.commit)
  if (!bisected) return { ok: false, reason: 'NOT_BISECTED' }
  const commits = await selectDraftCommits(tx, input.storeId)
  const before = commits[commits.indexOf(input.commit) - 1]
  if (!before) return { ok: false, reason: 'NOTHING_BEFORE' }
  return startPublish(tx, { storeId: input.storeId, kind: 'design', commit: before, template: bisected.template, coreVersion: bisected.core_version, usesAllowance: false, startedBy: { kind: input.by ? 'user' : 'system', id: input.by }, at: input.at })
}

export type GoBackResult = { ok: true } | { ok: false; reason: 'NOT_FOUND' | 'ALREADY_LIVE' | 'PUBLISH_RUNNING' | 'BUILD_GONE' }

/** Who asked, as the Store API knows them (#318 calls this); the entry's action and target are filled in here. */
export type GoBackActor = Pick<ActivityEntry, 'actorKind' | 'actorId' | 'actorLabel' | 'onBehalfOf' | 'access' | 'api' | 'host' | 'requestId' | 'ip' | 'userAgent'>

/**
 * Go back to a kept version (SAAS §9.2): the pointer moves to its build, with no build of its own, and the edge serves it
 * within the lookup's 60 seconds (LIVE-SHOP §5 step 1). A version whose build clean-up removed needs a rebuild (#318).
 */
export const goBack = (sql: postgres.Sql, input: { storeId: string; versionId: string; by: string | null; actor: GoBackActor; now: Date }): Promise<GoBackResult> =>
  withSystemScope(sql, async (tx) => {
    const storefront = await lockStorefront(tx, input.storeId)
    if (!storefront) return { ok: false, reason: 'NOT_FOUND' }
    const version = await selectVersion(tx, input.storeId, input.versionId)
    if (!version) return { ok: false, reason: 'NOT_FOUND' }
    if (version.state === 'live') return { ok: false, reason: 'ALREADY_LIVE' }
    if (await hasActiveRun(tx, input.storeId)) return { ok: false, reason: 'PUBLISH_RUNNING' }
    if (version.files_deleted) return { ok: false, reason: 'BUILD_GONE' }
    await moveLiveTo(tx, input.storeId, version, input.by, input.now)
    await queueSideEffect(tx, { kind: 'cache.purge', idempotencyKey: `go-back:${input.storeId}:${input.now.toISOString()}`, payload: { storeId: input.storeId, reason: 'go-back' }, partnerId: storefront.partner_id, storeId: input.storeId })
    await activityLog.record(tx, {
      ...input.actor,
      category: 'write',
      action: 'storefront.reverted',
      result: 'success',
      partnerId: storefront.partner_id,
      storeId: input.storeId,
      target: { type: 'storefront', id: input.storeId, label: 'storefront' },
      changes: [{ field: 'version', before: null, after: String(version.number) }],
      reason: null,
      visibility: 'store',
    })
    return { ok: true }
  })
