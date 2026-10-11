import type { JobState, ProvisioningStep } from '../schema/saas'
import { pgArray, type ScopedSql } from './index'

// A store's repo and the platform's pushes to it (DATA-MODEL §7.8, storefront_push), always in system scope: only
// jobs create repos and push.

export type RepoState = 'none' | 'creating' | 'ready' | 'failed'

export interface StoreRepoRow {
  repo: string | null
  repo_state: RepoState
  repo_head: string | null
}

export interface PushRow {
  parent_sha: string
  commit_sha: string | null
  state: 'pending' | 'done'
  created_at: Date
}

/** Locked to the end of the transaction, so two pushes for one store agree on the parent. */
export const selectStoreRepoForUpdate = async (tx: ScopedSql, storeId: string): Promise<StoreRepoRow | null> =>
  (await tx<StoreRepoRow[]>`select repo, repo_state, repo_head from storefront where store_id = ${storeId} for update`)[0] ?? null

export const selectPush = async (tx: ScopedSql, storeId: string, key: string): Promise<PushRow | null> =>
  (await tx<PushRow[]>`select parent_sha, commit_sha, state, created_at from storefront_push where store_id = ${storeId} and key = ${key}`)[0] ?? null

export const insertPush = async (tx: ScopedSql, storeId: string, key: string, parent: string, at: Date): Promise<PushRow> => {
  const [row] = await tx<PushRow[]>`
    insert into storefront_push (store_id, key, parent_sha, state, created_at) values (${storeId}, ${key}, ${parent}, 'pending', ${at})
    returning parent_sha, commit_sha, state, created_at`
  if (!row) throw new Error('storefront_push: insert returned nothing')
  return row
}

export const setPushCommit = async (tx: ScopedSql, storeId: string, key: string, commit: string): Promise<void> => {
  await tx`update storefront_push set commit_sha = ${commit} where store_id = ${storeId} and key = ${key} and state = 'pending'`
}

/** A refused push leaves no row, so the same key may try again from wherever `main` then is. */
export const deletePendingPush = async (tx: ScopedSql, storeId: string, key: string): Promise<void> => {
  await tx`delete from storefront_push where store_id = ${storeId} and key = ${key} and state = 'pending'`
}

/** `main` is at `commit` on GitHub: the store's record follows, unless another push already moved it on. */
export const finishPush = async (tx: ScopedSql, storeId: string, key: string, parent: string, commit: string, at: Date): Promise<void> => {
  await tx`update storefront set repo_head = ${commit} where store_id = ${storeId} and repo_head = ${parent}`
  await tx`update storefront_push set state = 'done', commit_sha = ${commit}, finished_at = ${at} where store_id = ${storeId} and key = ${key}`
}

/** What the create-storefront Workflow reads at each step (SAAS §5 steps 4–8). */
export interface CreationRow extends StoreRepoRow {
  partner_id: string
  storefront_kind: 'ai' | 'own'
  public_store_key: string
  job_state: JobState | null
}

export const selectCreation = async (tx: ScopedSql, storeId: string, jobId: string): Promise<CreationRow | null> =>
  (
    await tx<CreationRow[]>`
      select f.repo, f.repo_state, f.repo_head, f.public_store_key, s.partner_id, s.storefront_kind,
        (select state from job where id = ${jobId} and store_id = ${storeId} and kind = 'create-storefront') as job_state
      from storefront f join store s on s.id = f.store_id where f.store_id = ${storeId}`
  )[0] ?? null

/** Locked, so two first choices of a template start one job. */
export const selectStartForUpdate = async (tx: ScopedSql, storeId: string): Promise<(StoreRepoRow & { partner_id: string; storefront_kind: 'ai' | 'own' }) | null> =>
  (
    await tx<(StoreRepoRow & { partner_id: string; storefront_kind: 'ai' | 'own' })[]>`
      select f.repo, f.repo_state, f.repo_head, s.partner_id, s.storefront_kind
      from storefront f join store s on s.id = f.store_id where f.store_id = ${storeId} for update of f`
  )[0] ?? null

export const selectRunningCreation = async (tx: ScopedSql, storeId: string): Promise<string | null> =>
  (await tx<{ id: string }[]>`select id from job where store_id = ${storeId} and kind = 'create-storefront' and state in ('running', 'cleaning') order by started_at desc limit 1`)[0]?.id ?? null

export const beginStoreRepo = async (tx: ScopedSql, storeId: string, repo: string, steps: readonly ProvisioningStep[], at: Date): Promise<string> => {
  await tx`update storefront set repo = ${repo}, repo_state = 'creating', repo_head = null where store_id = ${storeId}`
  const [first] = steps
  const [row] = await tx<{ id: string }[]>`
    insert into job (store_id, kind, state, steps, step, step_started_at, started_at)
    values (${storeId}, 'create-storefront', 'running', ${pgArray(steps)}::text[], ${first ?? 'repo'}, ${at}, ${at}) returning id`
  if (!row) throw new Error('job: insert returned no row')
  return row.id
}

/** The commit `create` left on `main`, before the first push builds on it. */
export const setFirstRepoHead = async (tx: ScopedSql, storeId: string, head: string): Promise<void> => {
  await tx`update storefront set repo_head = ${head} where store_id = ${storeId} and repo_head is null`
}

export type Compensation =
  | { step: 'repo'; undo: 'deleteRepo'; repo: string }
  | { step: 'hostingTarget'; undo: 'deleteFolders'; prefix: string }
  | { step: 'firstBuild'; undo: 'deletePreview'; folder: string; ref: string }

/** Registered before its step acts (SAAS §5), once however often the step is retried. */
export const appendCompensation = async (tx: ScopedSql, jobId: string, entry: Compensation): Promise<void> => {
  await tx`
    insert into job_detail (job_id, compensation_log) values (${jobId}, ${tx.json([entry])})
    on conflict (job_id) do update set compensation_log = job_detail.compensation_log || excluded.compensation_log
    where not job_detail.compensation_log @> excluded.compensation_log`
}

export const selectCompensations = async (tx: ScopedSql, jobId: string): Promise<Compensation[]> =>
  (await tx<{ log: Compensation[] }[]>`select compensation_log as log from job_detail where job_id = ${jobId}`)[0]?.log ?? []

export const setJobState = async (tx: ScopedSql, jobId: string, state: 'cleaning'): Promise<void> => {
  await tx`update job set state = ${state} where id = ${jobId}`
}

export const upsertDesignDraft = async (tx: ScopedSql, d: { storeId: string; headCommit: string; template: string; coreVersion: string; previewRef: string; at: Date }): Promise<void> => {
  await tx`
    insert into design_draft (store_id, head_commit, template, core_version, changed_at, preview_deploy_ref)
    values (${d.storeId}, ${d.headCommit}, ${d.template}, ${d.coreVersion}, ${d.at}, ${d.previewRef})
    on conflict (store_id) do update set head_commit = excluded.head_commit, template = excluded.template,
      core_version = excluded.core_version, changed_at = excluded.changed_at, preview_deploy_ref = excluded.preview_deploy_ref`
}

export const deleteDesignDraft = async (tx: ScopedSql, storeId: string, previewRef: string): Promise<void> => {
  await tx`delete from design_draft where store_id = ${storeId} and preview_deploy_ref = ${previewRef}`
}

/** Step 8: the repo is ready, its template and core recorded, the job done (SAAS §5). */
export const finishStoreRepo = async (tx: ScopedSql, d: { storeId: string; jobId: string; template: string; coreVersion: string; at: Date }): Promise<void> => {
  await tx`update storefront set template = ${d.template}, repo_state = 'ready' where store_id = ${d.storeId}`
  await tx`update store set core_version = ${d.coreVersion} where id = ${d.storeId}`
  await tx`update job set state = 'done', finished_at = ${d.at} where id = ${d.jobId}`
}

/** Everything the job made is gone: no repo, no pushes, the store free to try again. */
export const failStoreRepo = async (tx: ScopedSql, d: { storeId: string; jobId: string; error: string; at: Date }): Promise<void> => {
  await tx`update storefront set repo = null, repo_head = null, repo_state = 'failed' where store_id = ${d.storeId}`
  await tx`delete from storefront_push where store_id = ${d.storeId}`
  await tx`update job set state = 'failed', last_error = ${d.error}, finished_at = ${d.at} where id = ${d.jobId}`
}
