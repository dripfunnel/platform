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
  /** Set once the pointer moved to this build; the run stays deploying until its post-deploy checks pass (LIVE-SHOP §4 step 10). */
  switched_at: Date | null
  previous_build_id: string | null
  /** A page run's input (LIVE-SHOP §7): the addresses it renders and those whose files it leaves out. */
  render: PageRender | null
}

export interface PageRender {
  pages: string[]
  drop: string[]
}

export interface QueuedRun {
  id: string
  kind: PublishKind
  render: PageRender | null
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
  render?: PageRender | undefined
}

/** The store's storefront row, locked, so two publishes or a publish and a go back take turns. */
export const lockStorefront = async (tx: ScopedSql, storeId: string): Promise<{ live_build_id: string | null; partner_id: string } | null> =>
  (
    await tx<{ live_build_id: string | null; partner_id: string }[]>`
      select f.live_build_id, s.partner_id from storefront f join store s on s.id = f.store_id where f.store_id = ${storeId} for update of f`
  )[0] ?? null

/** The run waiting behind the running one, if there is one: a second press during a run is the same run (SAAS §9.1). */
export const selectQueuedRun = async (tx: ScopedSql, storeId: string): Promise<QueuedRun | null> =>
  (await tx<QueuedRun[]>`select id, kind, render from publish_run where store_id = ${storeId} and state = 'queued'`)[0] ?? null

/** A waiting page run takes more addresses (one render for a burst of saves, SAAS §9.1). */
export const setQueuedRender = async (tx: ScopedSql, runId: string, render: PageRender): Promise<void> => {
  await tx`update publish_run set render = ${tx.json({ pages: render.pages, drop: render.drop })} where id = ${runId} and state = 'queued' and kind = 'page'`
}

/** A waiting page run becomes the full publish pressed behind it, which renders every page anyway. */
export const widenQueuedRun = async (tx: ScopedSql, runId: string, run: Omit<NewRun, 'storeId' | 'at' | 'render'>): Promise<void> => {
  await tx`
    update publish_run set kind = ${run.kind}, render = null, commit = ${run.commit}, template = ${run.template}, core_version = ${run.coreVersion},
      uses_allowance = ${run.usesAllowance}, started_by_kind = ${run.startedBy.kind}, started_by_id = ${run.startedBy.id}
    where id = ${runId} and state = 'queued' and kind = 'page'`
}

export const hasActiveRun = async (tx: ScopedSql, storeId: string): Promise<boolean> =>
  (await tx<{ id: string }[]>`select id from publish_run where store_id = ${storeId} and state in ('building', 'checking', 'deploying')`).length > 0

export const insertQueuedRun = async (tx: ScopedSql, run: NewRun): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into publish_run (store_id, kind, commit, template, core_version, uses_allowance, started_by_kind, started_by_id, created_at, render)
    values (${run.storeId}, ${run.kind}, ${run.commit}, ${run.template}, ${run.coreVersion}, ${run.usesAllowance}, ${run.startedBy.kind}, ${run.startedBy.id}, ${run.at},
      ${run.render ? tx.json({ pages: run.render.pages, drop: run.render.drop }) : null})
    returning id`
  if (!row) throw new Error('publish_run: insert returned nothing')
  return row.id
}

export const selectRun = async (tx: ScopedSql, runId: string): Promise<RunRow | null> =>
  (
    await tx<RunRow[]>`
      select r.id, r.store_id, s.partner_id, r.kind, r.state, r.commit, r.template, r.core_version, r.started_by_kind, r.started_by_id,
        r.switched_at, r.previous_build_id, r.render
      from publish_run r join store s on s.id = r.store_id where r.id = ${runId}`
  )[0] ?? null

/** Queued → deploying, and the console's mirror to building (DATA-MODEL §7.8). */
export const startRun = async (tx: ScopedSql, run: RunRow, at: Date): Promise<void> => {
  await tx`update publish_run set state = 'deploying', started_at = ${at} where id = ${run.id} and state = 'queued'`
  await tx`update store set build_state = 'building', last_build_at = ${at} where id = ${run.store_id}`
}

/**
 * The switch (LIVE-SHOP §4 step 9 item 3): the pointer and the new version in one transaction; the run stays deploying
 * until its post-deploy checks pass (`confirmLive`) or fail (`rollBackRun`). Returns the version's number.
 */
export const switchLive = async (tx: ScopedSql, run: RunRow, previous: string | null, at: Date): Promise<number> => {
  await tx`update storefront set live_build_id = ${run.id} where store_id = ${run.store_id}`
  await tx`update publish_run set switched_at = ${at}, previous_build_id = ${previous} where id = ${run.id}`
  // A page render is the live version's own build again, not a version of its own (LIVE-SHOP §7).
  if (run.kind === 'page') {
    const [kept] = await tx<{ number: number }[]>`update design_version set build_id = ${run.id} where store_id = ${run.store_id} and state = 'live' returning number`
    if (!kept) throw new Error('design_version: a page render with no live version')
    return kept.number
  }
  await tx`update design_version set state = 'kept' where store_id = ${run.store_id} and state = 'live'`
  const [version] = await tx<{ number: number }[]>`
    insert into design_version (store_id, number, commit, template, core_version, build_id, published_by, published_at, state)
    select ${run.store_id}, coalesce(max(number), 0) + 1, ${run.commit}, ${run.template}, ${run.core_version}, ${run.id},
      ${run.started_by_kind === 'user' ? run.started_by_id : null}, ${at}, 'live'
    from design_version where store_id = ${run.store_id}
    returning number`
  if (!version) throw new Error('design_version: insert returned nothing')
  return version.number
}

/** The switched build passed its post-deploy checks: the run and the console's mirror say live. */
export const confirmLive = async (tx: ScopedSql, run: RunRow, at: Date): Promise<void> => {
  await tx`update publish_run set state = 'live', finished_at = ${at} where id = ${run.id} and state = 'deploying'`
  await tx`update store set build_state = 'live', last_publish_at = ${at}, core_version = ${run.core_version} where id = ${run.store_id}`
}

/** The build whose asset folder a new build's pages load from: the live build's own, or the one it inherited. */
export const selectAssetsBuild = async (tx: ScopedSql, buildId: string): Promise<string | null> =>
  (await tx<{ id: string }[]>`select coalesce(assets_build_id, id) as id from publish_run where id = ${buildId}`)[0]?.id ?? null

export const setAssetsBuild = async (tx: ScopedSql, runId: string, assetsBuildId: string): Promise<void> => {
  await tx`update publish_run set assets_build_id = ${assetsBuildId} where id = ${runId}`
}

/** The store's live build, the pointer itself (LIVE-SHOP §4 step 9), unlocked. */
export const selectLiveBuildId = async (tx: ScopedSql, storeId: string): Promise<string | null> =>
  (await tx<{ live_build_id: string | null }[]>`select live_build_id from storefront where store_id = ${storeId}`)[0]?.live_build_id ?? null

/** The store's IndexNow key, which its hosts serve at /{key}.txt (ARCHITECTURE §8). */
export const selectIndexNowKey = async (tx: ScopedSql, storeId: string): Promise<string | null> =>
  (await tx<{ indexnow_key: string }[]>`select indexnow_key from storefront where store_id = ${storeId}`)[0]?.indexnow_key ?? null

/** The number of the version a build is, if it is one. */
export const versionOfBuild = async (tx: ScopedSql, buildId: string): Promise<number | null> =>
  (await tx<{ number: number }[]>`select number from design_version where build_id = ${buildId} order by number desc limit 1`)[0]?.number ?? null

export const recordChecks = async (tx: ScopedSql, runId: string, checks: readonly { name: string; result: string; detail: string }[]): Promise<void> => {
  await tx`update publish_run set checks = ${tx.json(checks.map((c) => ({ name: c.name, result: c.result, detail: c.detail })))} where id = ${runId}`
}

/**
 * The automatic rollback (LIVE-SHOP §4 step 10): the pointer moves back to the build this run replaced, with no rebuild;
 * the run's version is withdrawn and the one before it is live again. Returns both versions' numbers, where there are any.
 */
export const rollBackRun = async (tx: ScopedSql, run: RunRow, error: string, at: Date): Promise<{ withdrawn: number | null; back: number | null }> => {
  const previous = run.previous_build_id
  const withdrawn = await versionOfBuild(tx, run.id)
  await tx`update storefront set live_build_id = ${previous} where store_id = ${run.store_id}`
  await tx`update publish_run set state = 'rolled_back', error = ${error}, rolled_back_at = ${at}, finished_at = ${at} where id = ${run.id}`
  if (run.kind === 'page' && previous) {
    await tx`update design_version set build_id = ${previous} where build_id = ${run.id}`
    return { withdrawn: null, back: withdrawn }
  }
  await tx`update design_draft set base_version_id = null where base_version_id in (select id from design_version where build_id = ${run.id})`
  await tx`delete from design_version where build_id = ${run.id}`
  const [back] = previous
    ? await tx<{ number: number }[]>`
        update design_version set state = 'live'
        where id = (select id from design_version where store_id = ${run.store_id} and build_id = ${previous} order by number desc limit 1)
        returning number`
    : []
  await tx`
    update store set build_state = case when ${previous}::uuid is null then 'failed' else 'live' end,
      core_version = coalesce((select core_version from publish_run where id = ${previous}), core_version)
    where id = ${run.store_id}`
  return { withdrawn, back: back?.number ?? null }
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

/** The store's own address a shopper reaches it on: its oldest live custom domain, else its shops host (SAAS §8). */
export const selectStorefrontHost = async (tx: ScopedSql, storeId: string): Promise<string | null> => {
  const [row] = await tx<{ host: string | null }[]>`
    select coalesce(
      (select lower(c.host) from custom_domain c where c.store_id = s.id and c.status = 'live' order by c.created_at, c.id limit 1),
      (select s.code || substr(lower(d.host), 2) from partner_domain d
        where d.partner_id = s.partner_id and d.kind = 'shops' and d.status not in ('waiting', 'failed') limit 1)
    ) as host
    from store s where s.id = ${storeId}`
  return row?.host ?? null
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
        -- A page render's pages load this build's JS and CSS (LIVE-SHOP §7).
        and not exists (select 1 from publish_run x where x.assets_build_id = r.id and x.id <> r.id and x.files_deleted_at is null)
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
