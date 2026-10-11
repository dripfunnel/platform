import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry } from '#auth/activity'
import { failureCode, logEvent } from '#core/log'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import {
  failRun,
  hasActiveRun,
  insertQueuedRun,
  lockStorefront,
  moveLiveTo,
  failAttempt,
  failOpenAttempts,
  finishRepaired,
  insertAttempt,
  selectBisectedRun,
  selectDraftCommits,
  selectFailingChecks,
  selectGateVerdict,
  selectQueuedRun,
  selectStartedAt,
  setBisectCommit,
  setRepairAttempts,
  selectRun,
  selectVersion,
  startRun,
  switchLive,
  type NewRun,
  type RunRow,
} from '#db/scoped/publishing'
import { isUploaded, isVerified } from '#db/scoped/builds'
import { activityLog } from '#saas/activity/index'
import { queueSideEffect } from '#saas/outbox/index'
import { buildLifetimeMs } from './builds'
import { maxRepairs } from '#saas/studio/model'
import { dispatchBuild, freezeBuild, freezeRefusals, type FreezeDeps } from './freeze'
import { stagingFolder } from './layout'
import { deletePrefix, type SitesBucket } from './templates'
import { uploadRefusals, verifyUpload } from './verify'

// The publish-storefront Workflow (SAAS §9.1; storefront LIVE-SHOP.md §4): queued → building (frozen, dispatched) →
// deploying on a passing report (uploaded, verified, switched) → live; a failing report → checking → failed.

export const storefrontPublishKind = 'storefront.publish'
export const publishParams = z.strictObject({ runId: z.uuid(), storeId: z.uuid() })
export type PublishParams = z.infer<typeof publishParams>

const queueRun = (tx: ScopedSql, storeId: string, partnerId: string, runId: string) =>
  queueSideEffect(tx, { kind: storefrontPublishKind, idempotencyKey: `publish:${runId}`, payload: { runId, storeId }, partnerId, storeId })

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
  if (waiting) return { ok: true, runId: waiting }
  const runId = await insertQueuedRun(tx, run)
  if (!(await hasActiveRun(tx, run.storeId))) await queueRun(tx, run.storeId, storefront.partner_id, runId)
  return { ok: true, runId }
}

export interface PublishDeps extends FreezeDeps {
  /** Absent until the designer's model reaches the Workflow (#318): a failing design publish then goes straight to bisect. */
  repair?: PublishRepair
  sites: SitesBucket
  /** The public bucket the verified JS and CSS are copied into (LIVE-SHOP §4 step 9). */
  assets: SitesBucket
}

/** The studio's change loop asked to fix the failing checks (AI-STUDIO §6); the draft's new commit, or null. */
/**
 * `key` is the publish and the try (`{run}:{n}`): asked again with the same key, as a retried step does, it answers the
 * change it already made instead of making a second one.
 */
export type PublishRepair = (storeId: string, failing: string[], key: string) => Promise<string | null>

/** What the build's calls wake its publish run with (`step.waitForEvent` types, LIVE-SHOP §4 "The build calls"). */
export type BuildEvent = 'reported' | 'uploaded'

/** A Workflow's `step.do`: a step's answer is kept, so a replay skips what already finished. */
export interface PublishSteps {
  do: (name: string, work: () => Promise<string>) => Promise<string>
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
    if (!(await lockStorefront(tx, p.storeId))) return 'stopped'
    const run = await selectRun(tx, p.runId)
    if (!run || run.store_id !== p.storeId) return 'stopped'
    if (run.state !== 'queued') return run.state === 'building' || run.state === 'checking' || run.state === 'deploying' ? 'claimed' : 'stopped'
    // The partial unique index refuses a second running build anyway; this says why, and the Workflow tries again.
    if (await hasActiveRun(tx, p.storeId)) throw new Busy('another publish is running')
    await startRun(tx, run, deps.now())
    return 'claimed'
  })

/** Every staged object hashed to the manifest whose digest the passing report sent, and copied (LIVE-SHOP §4 step 9). */
const verifyStep = async (deps: PublishDeps, storeId: string, buildId: string): Promise<string> => {
  await verifyUpload(deps, storeId, buildId)
  return 'verified'
}

/** The report's verdict once it came (LIVE-SHOP §4 step 7). */
const reportedStep = (deps: PublishDeps, storeId: string, buildId: string): Promise<string> =>
  withSystemScope(deps.sql, async (tx) => {
    const passed = await selectGateVerdict(tx, storeId, buildId)
    return passed === null ? 'waiting' : passed ? 'passed' : 'failed'
  })

const uploadedStep = (deps: PublishDeps, storeId: string, buildId: string): Promise<string> =>
  withSystemScope(deps.sql, async (tx) => ((await isUploaded(tx, storeId, buildId)) ? 'uploaded' : 'waiting'))

/** The pointer moves to `buildId`, the publish's own build or its repair's, which then ends the publish too. */
const switchStep = async (deps: PublishDeps, p: PublishParams, buildId: string): Promise<string> => {
  const switched = await withSystemScope(deps.sql, async (tx) => {
    const storefront = await lockStorefront(tx, p.storeId)
    const run = await selectRun(tx, buildId)
    if (!storefront || !run || run.store_id !== p.storeId || run.state !== 'deploying') return null
    // The pointer moves only to a build whose every file was verified, whoever runs this step (LIVE-SHOP §4 step 9).
    if (!(await isVerified(tx, run.store_id, run.id))) throw new BuildMissing('the build is not verified')
    const at = deps.now()
    const version = await switchLive(tx, run, storefront.live_build_id, at)
    if (buildId !== p.runId) await finishRepaired(tx, p.storeId, p.runId, at)
    await queueSideEffect(tx, { kind: 'cache.purge', idempotencyKey: `publish:${run.id}`, payload: { storeId: run.store_id, reason: 'publish' }, partnerId: run.partner_id, storeId: run.store_id })
    await activityLog.record(tx, systemEntry(run, 'storefront.published', 'success', [{ field: 'version', before: null, after: String(version) }]))
    await queueNext(tx, run.store_id, run.partner_id)
    return version
  })
  if (switched === null) return 'stopped'
  await deletePrefix(deps.sites, stagingFolder(p.storeId, buildId))
  return `live:${switched}`
}

/** The live build stays as it was; nothing became public (LIVE-SHOP §4 step 8). */
const failStep = async (deps: PublishDeps, p: PublishParams, code: string): Promise<string> => {
  const attempts = await withSystemScope(deps.sql, async (tx) => {
    if (!(await lockStorefront(tx, p.storeId))) return []
    const run = await selectRun(tx, p.runId)
    if (!run || run.store_id !== p.storeId || run.state === 'live' || run.state === 'failed' || run.state === 'rolled_back') return []
    const ended = await failOpenAttempts(tx, p.storeId, p.runId, code, deps.now())
    await failRun(tx, run, code, deps.now())
    await activityLog.record(tx, systemEntry(run, 'storefront.publish_failed', 'failed', [{ field: 'error', before: null, after: code }]))
    await queueNext(tx, run.store_id, run.partner_id)
    return ended
  })
  for (const id of [p.runId, ...attempts]) await deletePrefix(deps.sites, stagingFolder(p.storeId, id))
  return 'failed'
}

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

export const runPublish = async (deps: PublishDeps, p: PublishParams, steps: PublishSteps): Promise<'live' | 'failed' | 'stopped'> => {
  try {
    if ((await steps.do('claim', () => claimStep(deps, p))) === 'stopped') return 'stopped'
    let liveId = p.runId
    if (!(await gateBuild(deps, steps, p.storeId, p.runId, ''))) {
      const kind = await steps.do('kind', () => withSystemScope(deps.sql, async (tx) => (await selectRun(tx, p.runId))?.kind ?? 'gone'))
      if (kind !== 'design') throw new GateFailed('the gate refused the build')
      const repaired = await repairs(deps, steps, p)
      if (!repaired) throw (await bisect(deps, steps, p)) ? new Bisected('publish everything before this change') : new GateFailed('the gate refused the build')
      liveId = repaired
    }
    if ((await steps.do('uploaded', () => uploadedStep(deps, p.storeId, liveId))) === 'waiting') {
      const deadline = await steps.do('upload-deadline', () => deadlineOf(deps, p.storeId, liveId))
      await steps.waitFor('upload', 'uploaded', minutesBefore(deps, deadline)).catch(() => {
        throw new UploadTimedOut('no upload within the build id’s lifetime')
      })
    }
    await steps.do('verify', () => verifyStep(deps, p.storeId, liveId))
    return (await steps.do('switch', () => switchStep(deps, p, liveId))) === 'stopped' ? 'stopped' : 'live'
  } catch (error) {
    const code = codeOf(error)
    logEvent({ event: 'storefront_publish_failed', api: 'system', storeId: p.storeId, code: `${code}:${failureCode(error)}` })
    await steps.do('fail', () => failStep(deps, p, code))
    return 'failed'
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
