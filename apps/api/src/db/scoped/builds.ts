import type { ScopedSql } from './index'

// A store build's calls from its repo's workflow (storefront LIVE-SHOP.md §4 steps 5–9; DATA-MODEL §7.8 `publish_run`),
// always in system scope: the caller is a GitHub Actions run, never a person.

export type BuildState = 'queued' | 'building' | 'checking' | 'deploying' | 'live' | 'failed' | 'rolled_back'

export interface BuildRow {
  id: string
  store_id: string
  partner_id: string
  kind: string
  commit: string
  core_version: string
  state: BuildState
  started_at: Date | null
  github_run_id: string | null
  gate: Record<string, unknown> | null
  gate_digest: string | null
  uploaded_at: Date | null
  /** Whether "uploaded" froze a manifest; false with `uploaded_at` set is a refused one. */
  manifest_ok: boolean
  verified_at: Date | null
  repo: string | null
  repo_id: string | null
  live_build_id: string | null
}

/** Locked to the end of the transaction, so two calls of one build see each other's writes in order. */
export const selectBuildForUpdate = async (tx: ScopedSql, buildId: string): Promise<BuildRow | null> =>
  (
    await tx<BuildRow[]>`
      select r.id, r.store_id, s.partner_id, r.kind, r.commit, r.core_version, r.state, r.started_at, r.github_run_id::text as github_run_id, r.gate, r.gate_digest,
        r.uploaded_at, r.upload_manifest is not null as manifest_ok, r.verified_at, f.repo, f.repo_id::text as repo_id, f.live_build_id
      from publish_run r join storefront f on f.store_id = r.store_id join store s on s.id = r.store_id
      where r.id = ${buildId} for update of r`
  )[0] ?? null

/** The first run to use the build id holds it from then on (LIVE-SHOP §9). */
export const bindBuildRun = async (tx: ScopedSql, buildId: string, runId: string): Promise<void> => {
  await tx`update publish_run set github_run_id = ${runId} where id = ${buildId} and github_run_id is null`
}

/** A pass goes on to deploying; a failure waits in checking for the publish run to decide (ARCHITECTURE §4.2 step 4). */
export const recordGate = async (tx: ScopedSql, b: { buildId: string; gate: Record<string, unknown>; digest: string; passed: boolean; at: Date }): Promise<void> => {
  await tx`
    update publish_run set gate = ${tx.json(b.gate as Parameters<typeof tx.json>[0])}, gate_digest = ${b.digest},
      state = ${b.passed ? 'deploying' : 'checking'},
      build_minutes = case when dispatched_at is null then null else greatest(0, ceil(extract(epoch from (${b.at}::timestamptz - dispatched_at)) / 60))::int end
    where id = ${b.buildId} and gate is null`
}

/** "Uploaded" (LIVE-SHOP §4 step 9): no credential from here on; the manifest as read then, or null when it was refused. */
export const markUploaded = async (tx: ScopedSql, buildId: string, manifest: Record<string, unknown> | null, at: Date): Promise<void> => {
  await tx`
    update publish_run set uploaded_at = ${at}, upload_manifest = ${manifest === null ? null : tx.json(manifest as Parameters<typeof tx.json>[0])}
    where id = ${buildId} and uploaded_at is null`
}

export interface UploadRow {
  state: BuildState
  gate_digest: string | null
  uploaded_at: Date | null
  upload_manifest: Record<string, unknown> | null
  verified_at: Date | null
}

export const selectUpload = async (tx: ScopedSql, storeId: string, buildId: string): Promise<UploadRow | null> =>
  (
    await tx<UploadRow[]>`
      select state, gate_digest, uploaded_at, upload_manifest, verified_at from publish_run where id = ${buildId} and store_id = ${storeId}`
  )[0] ?? null

export const markVerified = async (tx: ScopedSql, storeId: string, buildId: string, at: Date): Promise<void> => {
  await tx`update publish_run set verified_at = ${at} where id = ${buildId} and store_id = ${storeId} and upload_manifest is not null and verified_at is null`
}

export const isUploaded = async (tx: ScopedSql, storeId: string, buildId: string): Promise<boolean> =>
  (await tx<{ id: string }[]>`select id from publish_run where id = ${buildId} and store_id = ${storeId} and uploaded_at is not null`).length > 0

/** The switch's guard: only a build whose every file was verified and copied goes live (LIVE-SHOP §4 step 9). */
export const isVerified = async (tx: ScopedSql, storeId: string, buildId: string): Promise<boolean> =>
  (await tx<{ id: string }[]>`select id from publish_run where id = ${buildId} and store_id = ${storeId} and verified_at is not null`).length > 0
