import type postgres from 'postgres'
import type { JWTVerifyGetKey } from 'jose'
import { z } from 'zod'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { bindBuildRun, recordGate, selectBuildForUpdate, type BuildRow } from '#db/scoped/builds'
import { acceptRun, TokenRefused, verifyActionsToken, type TokenRefusal } from '#integrations/github/oidc'
import type { StorefrontR2 } from '#integrations/cloudflare/r2'
import type { SitesBucket } from '#saas/storefronts/index'
import { activityLog } from '#saas/activity/index'
import { buildFolder, manifestName, snapshotFile, sourceBundle, stagingFolder } from '#saas/storefronts/layout'
import { manifestSchema } from './manifest'

// The build endpoints' rules (storefront LIVE-SHOP.md §4 steps 5–8, §9): each call proves its run by OIDC, names its
// build id, and finds that build in the one state its step belongs to. Anything else is refused the same way.

/** The run has this long from its dispatch: the job's 30 minutes plus a wait for a runner (decided on #517). */
export const buildLifetimeMs = 2 * 60 * 60 * 1000
/** Every link and credential a run is given lasts 15 minutes (LIVE-SHOP §4 steps 3 and 8). */
export const handoutSeconds = 15 * 60

export type BuildRefusal = TokenRefusal | 'unknown_build' | 'no_repo' | 'expired_build' | 'other_run' | 'wrong_state' | 'bad_report'

export class BuildRefused extends Error {
  override name = 'BuildRefused'
  constructor(readonly reason: BuildRefusal) {
    super(reason)
  }
}

/** GitHub's keys, Cloudflare or the bucket didn't answer: the run may try again. */
export class BuildUnavailable extends Error {
  override name = 'BuildUnavailable'
}

export interface BuildDeps {
  sql: postgres.Sql
  keys: JWTVerifyGetKey
  /** The audience every build token must name: this environment's hooks host. */
  audience: string
  org: string
  r2: StorefrontR2
  buckets: { sites: string; drafts: string }
  sites: SitesBucket
  now: () => Date
}

export interface BoundBuild extends BuildRow {
  runId: string
}

const actor = (runId: string) => ({ actorKind: 'provider' as const, actorId: `github-actions:${runId}`, actorLabel: 'GitHub Actions' })

/** Staff only: a partner never learns which check failed in a merchant's theme (DATA-MODEL §5.3). */
const record = (tx: ScopedSql, build: Pick<BuildRow, 'id' | 'store_id' | 'partner_id'>, runId: string, action: string, result: 'success' | 'failed' | 'denied', reason: string | null) =>
  activityLog.record(tx, {
    category: result === 'denied' ? 'security' : 'system',
    action,
    result,
    ...actor(runId),
    partnerId: build.partner_id,
    storeId: build.store_id,
    target: { type: 'publish_run', id: build.id, label: `Build ${build.id.slice(0, 8)}` },
    reason,
    api: 'system',
    requestId: null,
    ip: null,
    userAgent: null,
    visibility: 'staff',
  })

/** A refusal whose run proved itself and named a real build: recorded on that store, after the work's rollback. */
class RefusedFor extends Error {
  constructor(
    readonly build: BuildRow,
    readonly runId: string,
    readonly reason: BuildRefusal,
  ) {
    super(reason)
  }
}

/**
 * The token first (no database for a forgery), then the build: unexpired, its store's repo, and bound to the first run
 * that uses it. Runs `work` in the same transaction, with the build locked.
 */
export const withBuild = async <T>(deps: Pick<BuildDeps, 'sql' | 'keys' | 'audience' | 'org' | 'now'>, token: string, buildId: string, work: (tx: ScopedSql, build: BoundBuild) => Promise<T>): Promise<T> => {
  let run
  try {
    run = await verifyActionsToken(token, deps.keys, deps.audience, deps.now())
  } catch (error) {
    if (error instanceof TokenRefused && error.reason === 'keys_unavailable') throw new BuildUnavailable('keys_unavailable')
    throw new BuildRefused(error instanceof TokenRefused ? error.reason : 'bad_token')
  }
  const { runId } = run
  try {
    return await withSystemScope(deps.sql, async (tx) => {
      const row = await selectBuildForUpdate(tx, buildId)
      if (!row) throw new BuildRefused('unknown_build')
      const refuse = (reason: BuildRefusal) => new RefusedFor(row, runId, reason)
      if (!row.repo || !row.repo_id) throw refuse('no_repo')
      const refusal = acceptRun(run, { org: deps.org, repo: row.repo, repoId: row.repo_id })
      if (refusal) throw refuse(refusal)
      if (!row.started_at || deps.now().getTime() - row.started_at.getTime() > buildLifetimeMs) throw refuse('expired_build')
      if (row.github_run_id !== null && row.github_run_id !== runId) throw refuse('other_run')
      if (row.github_run_id === null) await bindBuildRun(tx, row.id, runId)
      try {
        return await work(tx, { ...row, github_run_id: runId, runId })
      } catch (error) {
        throw error instanceof BuildRefused ? refuse(error.reason) : error
      }
    })
  } catch (error) {
    if (!(error instanceof RefusedFor)) throw error
    await withSystemScope(deps.sql, (tx) => record(tx, error.build, error.runId, 'storefront.build_refused', 'denied', error.reason))
    throw new BuildRefused(error.reason)
  }
}

const expiresAt = (now: Date) => new Date(now.getTime() + handoutSeconds * 1000).toISOString()

export interface StartAnswer {
  source: string
  snapshot: string
  /** The live build's files for the visual diff, by path; null before the store's first publish. */
  live: { path: string; url: string }[] | null
  expiresAt: string
}

/** Step `fetch` (LIVE-SHOP §4 step 5): 15-minute links to this build's frozen input, and only to its own. */
export const startBuild = (deps: BuildDeps, token: string, buildId: string): Promise<StartAnswer> =>
  withBuild(deps, token, buildId, async (tx, build) => {
    if (build.state !== 'building' || build.gate !== null) throw new BuildRefused('wrong_state')
    const now = deps.now()
    const link = (bucket: string, key: string) => deps.r2.readLink(bucket, key, handoutSeconds, now)
    let live: StartAnswer['live'] = null
    if (build.live_build_id) {
      const folder = buildFolder(build.store_id, build.live_build_id)
      const files = await liveFiles(deps.sites, `${folder}${manifestName}`)
      live = await Promise.all(files.map(async (path) => ({ path, url: await link(deps.buckets.sites, `${folder}${path}`) })))
    }
    const answer = {
      source: await link(deps.buckets.drafts, sourceBundle(build.store_id, build.id)),
      snapshot: await link(deps.buckets.drafts, snapshotFile(build.store_id, build.id)),
      live,
      expiresAt: expiresAt(now),
    }
    await record(tx, build, build.runId, 'storefront.build_started', 'success', null)
    return answer
  })

const liveFiles = async (sites: SitesBucket, key: string): Promise<string[]> => {
  const object = await sites.get(key)
  const parsed = object ? manifestSchema.safeParse(JSON.parse(await object.text())) : null
  // The live build's manifest is the API's own copy (§4 step 9): missing or unreadable is ours to fix, not the run's.
  if (!parsed?.success) throw new BuildUnavailable('live_manifest')
  return parsed.data.files.map((f) => f.path)
}

const checkName = /^[a-z0-9][a-z0-9_.-]{0,63}$/

export const gateReport = z
  .strictObject({
    build: z.guid(),
    passed: z.boolean(),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    checks: z.array(z.strictObject({ name: z.string().regex(checkName), passed: z.boolean(), detail: z.string().max(500).optional() })).min(1).max(100),
  })
  .refine((r) => r.passed === r.checks.every((c) => c.passed), 'passed must agree with the checks')
export type GateReport = z.infer<typeof gateReport>

// jsonb keeps no key order, so a stored report is compared field by field.
const checksOf = (gate: Record<string, unknown>) => JSON.stringify((Array.isArray(gate['checks']) ? (gate['checks'] as Record<string, unknown>[]) : []).map((c) => [c['name'], c['passed'], c['detail'] ?? null]))
const sameGate = (stored: Record<string, unknown>, sent: Record<string, unknown>) => stored['passed'] === sent['passed'] && checksOf(stored) === checksOf(sent)

/** Step `check` (LIVE-SHOP §4 step 7): the report, once; a retry of the same report is answered as the first was. */
export const reportBuild = (deps: BuildDeps, token: string, report: GateReport): Promise<{ passed: boolean }> =>
  withBuild(deps, token, report.build, async (tx, build) => {
    const gate = { passed: report.passed, checks: report.checks }
    if (build.gate !== null) {
      if (build.gate_digest === report.digest && sameGate(build.gate, gate)) return { passed: report.passed }
      throw new BuildRefused('wrong_state')
    }
    if (build.state !== 'building' && build.state !== 'checking') throw new BuildRefused('wrong_state')
    await recordGate(tx, { buildId: build.id, gate, digest: report.digest, passed: report.passed, at: deps.now() })
    const failed = report.checks.filter((c) => !c.passed).map((c) => c.name)
    await record(tx, build, build.runId, report.passed ? 'storefront.build_passed' : 'storefront.build_failed', report.passed ? 'success' : 'failed', failed.length > 0 ? failed.join(', ') : null)
    return { passed: report.passed }
  })

export interface UploadCredential {
  endpoint: string
  bucket: string
  prefix: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  expiresAt: string
}

/**
 * Step `upload` (LIVE-SHOP §4 step 8): only after a passing report and before "uploaded", a credential for this build's
 * staging folder in the private bucket, for 15 minutes. It never names a build folder or the public bucket.
 */
export const issueCredentials = (deps: BuildDeps, token: string, buildId: string): Promise<UploadCredential> =>
  withBuild(deps, token, buildId, async (tx, build) => {
    if (build.state !== 'deploying' || build.gate?.['passed'] !== true || build.uploaded_at !== null) throw new BuildRefused('wrong_state')
    const prefix = stagingFolder(build.store_id, build.id)
    const credential = await deps.r2.mintPrefix(deps.buckets.sites, prefix, handoutSeconds).catch(() => {
      throw new BuildUnavailable('r2_unavailable')
    })
    await record(tx, build, build.runId, 'storefront.build_credentials_issued', 'success', null)
    return { endpoint: deps.r2.endpoint, bucket: deps.buckets.sites, prefix, ...credential, expiresAt: expiresAt(deps.now()) }
  })
