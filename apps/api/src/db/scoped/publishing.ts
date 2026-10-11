import type { ScopedSql } from './index'

// Publish runs, the live pointer and the versions (DATA-MODEL §7.8, storefront LIVE-SHOP.md §4), always in system scope:
// only the publish-storefront Workflow and the jobs around it write them.

export type PublishKind = 'manual' | 'automatic' | 'staff' | 'design' | 'page' | 'upgrade' | 'security' | 'rollback'
export type RunState = 'queued' | 'building' | 'checking' | 'deploying' | 'live' | 'failed' | 'rolled_back'
export const activeStates = ['building', 'checking', 'deploying'] as const satisfies readonly RunState[]

export interface RunRow {
  id: string
  store_id: string
  partner_id: string
  kind: PublishKind
  state: RunState
  commit: string
  template: string
  core_version: string
  started_by_kind: 'user' | 'staff' | 'system'
  started_by_id: string | null
}

export interface NewRun {
  storeId: string
  kind: PublishKind
  commit: string
  template: string
  coreVersion: string
  usesAllowance: boolean
  startedBy: { kind: 'user' | 'staff' | 'system'; id: string | null }
  at: Date
}

/** The store's storefront row, locked, so two publishes or a publish and a go back take turns. */
export const lockStorefront = async (tx: ScopedSql, storeId: string): Promise<{ live_build_id: string | null; partner_id: string } | null> =>
  (
    await tx<{ live_build_id: string | null; partner_id: string }[]>`
      select f.live_build_id, s.partner_id from storefront f join store s on s.id = f.store_id where f.store_id = ${storeId} for update of f`
  )[0] ?? null

/** The run waiting behind the running one, if there is one: a second press during a run is the same run (SAAS §9.1). */
export const selectQueuedRun = async (tx: ScopedSql, storeId: string): Promise<string | null> =>
  (await tx<{ id: string }[]>`select id from publish_run where store_id = ${storeId} and state = 'queued'`)[0]?.id ?? null

export const hasActiveRun = async (tx: ScopedSql, storeId: string): Promise<boolean> =>
  (await tx<{ id: string }[]>`select id from publish_run where store_id = ${storeId} and state in ('building', 'checking', 'deploying')`).length > 0

export const insertQueuedRun = async (tx: ScopedSql, run: NewRun): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into publish_run (store_id, kind, commit, template, core_version, uses_allowance, started_by_kind, started_by_id, created_at)
    values (${run.storeId}, ${run.kind}, ${run.commit}, ${run.template}, ${run.coreVersion}, ${run.usesAllowance}, ${run.startedBy.kind}, ${run.startedBy.id}, ${run.at})
    returning id`
  if (!row) throw new Error('publish_run: insert returned nothing')
  return row.id
}

export const selectRun = async (tx: ScopedSql, runId: string): Promise<RunRow | null> =>
  (
    await tx<RunRow[]>`
      select r.id, r.store_id, s.partner_id, r.kind, r.state, r.commit, r.template, r.core_version, r.started_by_kind, r.started_by_id
      from publish_run r join store s on s.id = r.store_id where r.id = ${runId}`
  )[0] ?? null

/** Queued → building, and the console's mirror with it (DATA-MODEL §7.8); the build id's 2 hours start here. */
export const startRun = async (tx: ScopedSql, run: RunRow, at: Date): Promise<void> => {
  await tx`update publish_run set state = 'building', started_at = ${at} where id = ${run.id} and state = 'queued'`
  await tx`update store set build_state = 'building', last_build_at = ${at} where id = ${run.store_id}`
}

/**
 * The switch (LIVE-SHOP §4 step 9 item 3): the pointer, the run, the new version and the mirror in one transaction.
 * Returns the version's number.
 */
export const switchLive = async (tx: ScopedSql, run: RunRow, previous: string | null, at: Date): Promise<number> => {
  await tx`update storefront set live_build_id = ${run.id} where store_id = ${run.store_id}`
  await tx`update publish_run set state = 'live', finished_at = ${at}, previous_build_id = ${previous} where id = ${run.id}`
  await tx`update design_version set state = 'kept' where store_id = ${run.store_id} and state = 'live'`
  const [version] = await tx<{ number: number }[]>`
    insert into design_version (store_id, number, commit, template, core_version, build_id, published_by, published_at, state)
    select ${run.store_id}, coalesce(max(number), 0) + 1, ${run.commit}, ${run.template}, ${run.core_version}, ${run.id},
      ${run.started_by_kind === 'user' ? run.started_by_id : null}, ${at}, 'live'
    from design_version where store_id = ${run.store_id}
    returning number`
  if (!version) throw new Error('design_version: insert returned nothing')
  await tx`update store set build_state = 'live', last_publish_at = ${at}, core_version = ${run.core_version} where id = ${run.store_id}`
  return version.number
}

/** A failed run leaves the live build as it was; the mirror says live again when there is one (SAAS §9.1). */
export const failRun = async (tx: ScopedSql, run: RunRow, error: string, at: Date): Promise<void> => {
  await tx`update publish_run set state = 'failed', error = ${error}, finished_at = ${at} where id = ${run.id} and state not in ('live', 'failed', 'rolled_back')`
  // While another run builds, the mirror keeps saying so.
  await tx`
    update store set build_state = case when (select live_build_id from storefront where store_id = ${run.store_id}) is null then 'failed' else 'live' end
    where id = ${run.store_id}
      and not exists (select 1 from publish_run where store_id = ${run.store_id} and id <> ${run.id} and state in ('building', 'checking', 'deploying'))`
}

export interface VersionRow {
  id: string
  number: number
  commit: string
  core_version: string
  build_id: string
  state: 'live' | 'kept'
  files_deleted: boolean
}

export const selectVersion = async (tx: ScopedSql, storeId: string, versionId: string): Promise<VersionRow | null> =>
  (
    await tx<VersionRow[]>`
      select v.id, v.number, v.commit, v.core_version, v.build_id, v.state, r.files_deleted_at is not null as files_deleted
      from design_version v join publish_run r on r.id = v.build_id
      where v.store_id = ${storeId} and v.id = ${versionId}`
  )[0] ?? null

/** Go back (SAAS §9.2): the pointer moves to a kept build, which becomes the live version, and the draft starts from it. */
export const moveLiveTo = async (tx: ScopedSql, storeId: string, version: VersionRow, by: string | null, at: Date): Promise<void> => {
  await tx`update storefront set live_build_id = ${version.build_id} where store_id = ${storeId}`
  await tx`update design_version set state = 'kept' where store_id = ${storeId} and state = 'live'`
  await tx`update design_version set state = 'live' where id = ${version.id}`
  await tx`update design_draft set head_commit = ${version.commit}, base_version_id = ${version.id}, changed_at = ${at}, changed_by = ${by} where store_id = ${storeId}`
  await tx`update store set build_state = 'live', last_publish_at = ${at}, core_version = ${version.core_version} where id = ${storeId}`
}

/** Builds whose folders clean-up deletes: past the newest `keep` that went live, never live, never a version's (LIVE-SHOP §4 step 11). */
export const selectExpiredBuilds = async (tx: ScopedSql, keep: number, limit: number): Promise<{ id: string; store_id: string }[]> =>
  tx<{ id: string; store_id: string }[]>`
    select id, store_id from (
      select r.id, r.store_id, r.created_at from (
        select id, store_id, created_at, files_deleted_at,
          row_number() over (partition by store_id order by finished_at desc nulls last, created_at desc) as rank
        from publish_run where state in ('live', 'rolled_back')
      ) r
      where r.rank > ${keep} and r.files_deleted_at is null
        and not exists (select 1 from storefront f where f.live_build_id = r.id)
        and not exists (select 1 from design_version v where v.build_id = r.id)
      union all
      select id, store_id, created_at from publish_run where state = 'failed' and files_deleted_at is null
    ) due
    order by created_at, id
    limit ${limit}`

export const markFilesDeleted = async (tx: ScopedSql, runId: string, at: Date): Promise<void> => {
  await tx`update publish_run set files_deleted_at = ${at} where id = ${runId}`
}

/** Stores with a live publish their preview folders haven't been tidied against yet, the longest waiting first. */
export const selectPreviewCleanups = async (tx: ScopedSql, limit: number): Promise<{ store_id: string; current: string | null; published_at: Date }[]> =>
  tx<{ store_id: string; current: string | null; published_at: Date }[]>`
    select store_id, current, published_at from (
      select f.store_id, d.preview_deploy_ref as current, f.previews_tidied_at,
        (select max(r.finished_at) from publish_run r where r.store_id = f.store_id and r.state = 'live') as published_at
      from storefront f left join design_draft d on d.store_id = f.store_id
    ) s
    where published_at is not null and (previews_tidied_at is null or previews_tidied_at < published_at)
    order by published_at, store_id
    limit ${limit}`

export const markPreviewsTidied = async (tx: ScopedSql, storeId: string, publishedAt: Date): Promise<void> => {
  await tx`update storefront set previews_tidied_at = ${publishedAt} where store_id = ${storeId}`
}

/** Stores closed for longer than SAAS §4.2's 90 days whose files are still in the buckets. */
export const selectClosedStoresToErase = async (tx: ScopedSql, closedBefore: Date, limit: number): Promise<string[]> =>
  (
    await tx<{ id: string }[]>`
      select s.id from store s join storefront f on f.store_id = s.id
      where s.status = 'closed' and s.closed_at < ${closedBefore} and f.files_deleted_at is null
      order by s.closed_at limit ${limit}`
  ).map((r) => r.id)

export const markStoreFilesDeleted = async (tx: ScopedSql, storeId: string, at: Date): Promise<void> => {
  await tx`update storefront set files_deleted_at = ${at} where store_id = ${storeId}`
  await tx`update publish_run set files_deleted_at = ${at} where store_id = ${storeId} and files_deleted_at is null`
}

export interface BuildInputRow {
  kind: PublishKind
  commit: string
  core_version: string
  repo: string | null
  live_build_id: string | null
  dispatched_at: Date | null
  reported: boolean
}

/** What freezing and dispatching a build need (storefront LIVE-SHOP §4 steps 3–4). */
export const selectBuildInput = async (tx: ScopedSql, storeId: string, runId: string): Promise<BuildInputRow | null> =>
  (
    await tx<BuildInputRow[]>`
      select r.kind, r.commit, r.core_version, f.repo, f.live_build_id, r.dispatched_at, r.gate is not null as reported
      from publish_run r join storefront f on f.store_id = r.store_id where r.id = ${runId} and r.store_id = ${storeId}`
  )[0] ?? null

/** Claims the build's one dispatch; false when another attempt already holds it. */
export const markDispatched = async (tx: ScopedSql, storeId: string, runId: string, at: Date): Promise<boolean> =>
  (await tx`update publish_run set dispatched_at = ${at} where id = ${runId} and store_id = ${storeId} and dispatched_at is null`).count === 1

/** GitHub refused the dispatch, so no run started and the next attempt may ask again. */
export const unmarkDispatched = async (tx: ScopedSql, storeId: string, runId: string): Promise<void> => {
  await tx`update publish_run set dispatched_at = null where id = ${runId} and store_id = ${storeId} and gate is null`
}

/** The report's verdict, or null before one came (LIVE-SHOP §4 step 7). */
export const selectGateVerdict = async (tx: ScopedSql, storeId: string, runId: string): Promise<boolean | null> =>
  (await tx<{ passed: boolean | null }[]>`select (gate->>'passed')::boolean as passed from publish_run where id = ${runId} and store_id = ${storeId}`)[0]?.passed ?? null

export interface SnapshotSourceRow {
  code: string
  shops_host: string | null
  powered_by: string | null
}

/** The store's address and its partner's "Powered by" brand, beside the Shop API's own store read. */
export const selectSnapshotSource = async (tx: ScopedSql, storeId: string): Promise<SnapshotSourceRow | null> =>
  (
    await tx<SnapshotSourceRow[]>`
      select s.code, d.host as shops_host, case when p.powered_by = 'off' then null else p.product_name end as powered_by
      from store s join partner p on p.id = s.partner_id
        left join partner_domain d on d.partner_id = s.partner_id and d.kind = 'shops' and d.status = 'live'
      where s.id = ${storeId}`
  )[0] ?? null

/** "Publish now" presses that went live since `since`; a refused or failed one never counts (SAAS §9.1). */
export const allowanceUsed = async (tx: ScopedSql, storeId: string, since: Date): Promise<number> =>
  (
    await tx<{ used: number }[]>`
      select count(*)::int as used from publish_run
      where store_id = ${storeId} and uses_allowance and state in ('live', 'rolled_back') and created_at >= ${since}`
  )[0]?.used ?? 0

/** When the build id's lifetime started (its claim), which every wait for the build counts down from. */
export const selectStartedAt = async (tx: ScopedSql, storeId: string, runId: string): Promise<Date | null> =>
  (await tx<{ started_at: Date | null }[]>`select started_at from publish_run where id = ${runId} and store_id = ${storeId}`)[0]?.started_at ?? null
