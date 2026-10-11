import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry } from '#auth/activity'
import { failureCode, logEvent } from '#core/log'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import {
  confirmLive,
  failRun,
  hasActiveRun,
  insertQueuedRun,
  lockStorefront,
  moveLiveTo,
  recordChecks,
  rollBackRun,
  selectQueuedRun,
  selectRun,
  setQueuedRender,
  widenQueuedRun,
  selectStorefrontHost,
  selectVersion,
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
import { buildFolder, manifestName, stagingFolder } from './layout'
import { manifestSchema } from './manifest'
import { failedCheck, runPostDeployChecks, type CheckResult } from './postDeploy'
import { deletePrefix, type SitesBucket } from './templates'
import { copyInherited, inheritBatch, inheritPlan, maxRenderPages, mergeRender, sealRender, type RenderRequest } from './render'
import { uploadRefusals, verifyUpload } from './verify'

// The publish-storefront Workflow's steps (SAAS §9.1; storefront LIVE-SHOP.md §4 steps 1, 9 and 10): queued → deploying →
// live | failed | rolled_back. INF 4 (#483) puts building and checking before deploying.

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
    if (waiting.kind === 'page' && run.kind !== 'page') await widenQueuedRun(tx, waiting.id, run)
    return { ok: true, runId: waiting.id }
  }
  const runId = await insertQueuedRun(tx, run)
  if (!(await hasActiveRun(tx, run.storeId))) await queueRun(tx, run.storeId, storefront.partner_id, { id: runId, kind: run.kind })
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
      if (merged.pages.length + merged.drop.length <= maxRenderPages) await setQueuedRender(tx, waiting.id, merged)
      else await widenQueuedRun(tx, waiting.id, { kind: 'automatic', commit: live.commit, template: live.template, coreVersion: live.core_version, usesAllowance: false, startedBy: { kind: 'system', id: null } })
      return { ok: true, runId: waiting.id }
    }
    if (waiting) return { ok: true, runId: waiting.id }
    const started = await startPublish(tx, { storeId: request.storeId, kind: 'page', commit: live.commit, template: live.template, coreVersion: live.core_version, usesAllowance: false, startedBy: { kind: 'system', id: null }, at: now, render })
    return started.ok ? started : { ok: false, reason: 'NO_LIVE_BUILD' }
  })

export interface PublishDeps {
  sql: postgres.Sql
  sites: SitesBucket
  /** The public bucket the verified JS and CSS are copied into (LIVE-SHOP §4 step 9). */
  assets: SitesBucket
  now: () => Date
  /** The edge as a shopper reaches it, for the post-deploy checks (LIVE-SHOP §4 step 10). */
  probe: EdgeProbe
  wait: (ms: number) => Promise<void>
}

/** A Workflow's `step.do`: a step's answer is kept, so a replay skips what already finished. */
export interface PublishSteps {
  do: (name: string, work: () => Promise<string>) => Promise<string>
  /** `step.waitForEvent` for the build's "uploaded" (#517); throws once `timeoutMinutes` pass without it. */
  waitForUpload: (name: string, timeoutMinutes: number) => Promise<void>
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
    // A page run renders some pages; a waiting one a press widened is a full publish (LIVE-SHOP §7).
    const claimed = run.kind === 'page' ? 'claimed:page' : 'claimed'
    if (run.state !== 'queued') return run.state === 'deploying' ? claimed : 'stopped'
    // The partial unique index refuses a second running build anyway; this says why, and the Workflow tries again.
    if (await hasActiveRun(tx, p.storeId)) throw new Busy('another publish is running')
    await startRun(tx, run, deps.now())
    return claimed
  })

/** Every staged object hashed to the manifest whose digest the passing report sent, and copied (LIVE-SHOP §4 step 9). */
const verifyStep = async (deps: PublishDeps, p: PublishParams, seal: boolean): Promise<string> => {
  await verifyUpload(deps, p.storeId, p.runId, { seal })
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

const uploadedStep = (deps: PublishDeps, p: PublishParams): Promise<string> =>
  withSystemScope(deps.sql, async (tx) => ((await isUploaded(tx, p.storeId, p.runId)) ? 'uploaded' : 'waiting'))

const switchStep = (deps: PublishDeps, p: PublishParams): Promise<string> =>
  withSystemScope(deps.sql, async (tx) => {
    const storefront = await lockStorefront(tx, p.storeId)
    const run = await selectRun(tx, p.runId)
    if (!storefront || !run || run.store_id !== p.storeId || run.state !== 'deploying') return 'stopped'
    if (run.switched_at) return 'switched'
    // The pointer moves only to a build whose every file was verified, whoever runs this step (LIVE-SHOP §4 step 9).
    if (!(await isVerified(tx, run.store_id, run.id))) throw new BuildMissing('the build is not verified')
    await switchLive(tx, run, storefront.live_build_id, deps.now())
    await queueSideEffect(tx, { kind: 'cache.purge', idempotencyKey: `publish:${run.id}`, payload: { storeId: run.store_id, reason: 'publish' }, partnerId: run.partner_id, storeId: run.store_id })
    return 'switched'
  })

/** The build's own file list, written last by the copy, so the checks find its product and checkout pages. */
const buildFiles = async (deps: PublishDeps, p: PublishParams): Promise<string[]> => {
  const object = await deps.sites.get(`${buildFolder(p.storeId, p.runId)}${manifestName}`)
  const parsed = manifestSchema.safeParse(object ? JSON.parse(await object.text()) : null)
  if (!parsed.success) throw new BuildMissing('the build has no manifest')
  return parsed.data.files.map((f) => f.path)
}

/** Checks the switched build from the edge and keeps the results on the run; answers `passed` or the failed check's code. */
const checksStep = async (deps: PublishDeps, p: PublishParams): Promise<string> => {
  const host = await withSystemScope(deps.sql, (tx) => selectStorefrontHost(tx, p.storeId))
  const results: CheckResult[] = host
    ? await runPostDeployChecks(deps.probe, { host, buildId: p.runId, files: await buildFiles(deps, p) }, { wait: deps.wait, now: () => deps.now().getTime() })
    : [{ name: 'home', result: 'skipped', detail: 'The store has no address yet.' }]
  await withSystemScope(deps.sql, (tx) => recordChecks(tx, p.runId, results))
  return failedCheck(results) ?? 'passed'
}

const confirmStep = async (deps: PublishDeps, p: PublishParams): Promise<string> => {
  const confirmed = await withSystemScope(deps.sql, async (tx) => {
    if (!(await lockStorefront(tx, p.storeId))) return false
    const run = await selectRun(tx, p.runId)
    if (!run || run.store_id !== p.storeId || run.state !== 'deploying' || !run.switched_at) return false
    await confirmLive(tx, run, deps.now())
    const version = await versionOfBuild(tx, run.id)
    await queueSideEffect(tx, { kind: storefrontIndexNowKind, idempotencyKey: `indexnow:${run.id}`, payload: { storeId: run.store_id, buildId: run.id, previousBuildId: run.previous_build_id }, partnerId: run.partner_id, storeId: run.store_id })
    await activityLog.record(tx, systemEntry(run, 'storefront.published', 'success', [{ field: 'version', before: null, after: version === null ? null : String(version) }]))
    await queueNext(tx, run.store_id, run.partner_id)
    return true
  })
  if (confirmed) await deletePrefix(deps.sites, stagingFolder(p.storeId, p.runId))
  return confirmed ? 'live' : 'stopped'
}

/**
 * The automatic rollback (LIVE-SHOP §4 step 10): the pointer moves back to the build this run replaced. Idempotent: a
 * replay finds the run rolled back and changes nothing. The repair loop on the candidate is INF 4's (#483).
 */
const rollbackStep = (deps: PublishDeps, p: PublishParams, code: string): Promise<string> =>
  withSystemScope(deps.sql, async (tx) => {
    const storefront = await lockStorefront(tx, p.storeId)
    const run = await selectRun(tx, p.runId)
    if (!storefront || !run || run.store_id !== p.storeId) return 'stopped'
    if (run.state === 'rolled_back') return 'rolled_back'
    if (run.state !== 'deploying' || !run.switched_at || storefront.live_build_id !== run.id) return 'stopped'
    const versions = await rollBackRun(tx, run, code, deps.now())
    await queueSideEffect(tx, { kind: 'cache.purge', idempotencyKey: `rollback:${run.id}`, payload: { storeId: run.store_id, reason: 'rollback' }, partnerId: run.partner_id, storeId: run.store_id })
    await activityLog.record(tx, {
      ...systemEntry(run, 'storefront.rolled_back', 'failed', [{ field: 'version', before: versions.withdrawn === null ? null : String(versions.withdrawn), after: versions.back === null ? null : String(versions.back) }]),
      reason: code,
    })
    await queueNext(tx, run.store_id, run.partner_id)
    logEvent({ event: 'storefront_rolled_back', api: 'system', storeId: run.store_id, code })
    return 'rolled_back'
  })

/** The live build stays as it was; nothing became public (LIVE-SHOP §4 step 8). A run that already switched rolls back. */
const failStep = async (deps: PublishDeps, p: PublishParams, code: string): Promise<string> => {
  const switched = await withSystemScope(deps.sql, async (tx) => (await selectRun(tx, p.runId))?.switched_at ?? null)
  if (switched) return rollbackStep(deps, p, code)
  await withSystemScope(deps.sql, async (tx) => {
    if (!(await lockStorefront(tx, p.storeId))) return
    const run = await selectRun(tx, p.runId)
    if (!run || run.store_id !== p.storeId || run.switched_at || run.state === 'live' || run.state === 'failed' || run.state === 'rolled_back') return
    await failRun(tx, run, code, deps.now())
    await activityLog.record(tx, systemEntry(run, 'storefront.publish_failed', 'failed', [{ field: 'error', before: null, after: code }]))
    await queueNext(tx, run.store_id, run.partner_id)
  })
  await deletePrefix(deps.sites, stagingFolder(p.storeId, p.runId))
  return 'failed'
}

const errorCodes: Record<string, string> = { Busy: 'busy', BuildMissing: 'build_missing', UploadTimedOut: 'upload_timed_out' }
// A step's error may come back from the Workflow runtime as a plain Error, so a refused upload's code travels as its message.
const codeOf = (error: unknown): string => {
  if (!(error instanceof Error)) return 'deploy_failed'
  if (error.name === 'UploadRefused' || uploadRefusals.has(error.message)) return error.message
  return errorCodes[error.name] ?? 'deploy_failed'
}

class UploadTimedOut extends Error {
  override name = 'UploadTimedOut'
}

/** A publish of any kind; a page run completes its folder from the live build's before the switch (LIVE-SHOP §7). */
export const runPublish = async (deps: PublishDeps, p: PublishParams, steps: PublishSteps): Promise<'live' | 'failed' | 'rolled_back' | 'stopped'> => {
  try {
    const claimed = await steps.do('claim', () => claimStep(deps, p))
    if (claimed === 'stopped') return 'stopped'
    const render = claimed === 'claimed:page'
    // INF 4 (#483) dispatches the build here; its upload step's "uploaded" wakes this run (LIVE-SHOP §4 steps 4–9).
    if ((await steps.do('uploaded', () => uploadedStep(deps, p))) === 'waiting') {
      await steps.waitForUpload('upload', buildLifetimeMs / 60_000).catch(() => {
        throw new UploadTimedOut('no upload within the build id’s lifetime')
      })
    }
    await steps.do('verify', () => verifyStep(deps, p, !render))
    if (render) await inheritSteps(deps, p, steps)
    if ((await steps.do('switch', () => switchStep(deps, p))) === 'stopped') return 'stopped'
    const verdict = await steps.do('checks', () => checksStep(deps, p))
    if (verdict !== 'passed') return (await steps.do('rollback', () => rollbackStep(deps, p, verdict))) === 'rolled_back' ? 'rolled_back' : 'stopped'
    return (await steps.do('confirm', () => confirmStep(deps, p))) === 'live' ? 'live' : 'stopped'
  } catch (error) {
    const code = codeOf(error)
    logEvent({ event: 'storefront_publish_failed', api: 'system', storeId: p.storeId, code: `${code}:${failureCode(error)}` })
    return (await steps.do('fail', () => failStep(deps, p, code))) === 'rolled_back' ? 'rolled_back' : 'failed'
  }
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
