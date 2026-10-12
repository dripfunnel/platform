import { pgArray, type ScopedSql } from './index'

// core_rollout and core_rollout_store (DATA-MODEL §7.8 "Platform scope", SAAS §10): staff start and steer a rollout in
// platform scope; the cron's tick and each store's upgrade Workflow move it in system scope.

export type RolloutState = 'canary' | 'waves' | 'paused' | 'done' | 'rolled_back'
export type StoreUpgradeState = 'pending' | 'running' | 'passed' | 'migrated' | 'pinned' | 'baseline' | 'live' | 'reverted'

export const hasActiveRollout = async (tx: ScopedSql): Promise<boolean> =>
  (await tx`select 1 from core_rollout where state in ('canary', 'waves', 'paused')`).length > 0

export const insertRollout = async (tx: ScopedSql, r: { version: string; security: boolean; by: string | null; reason: string; at: Date }): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into core_rollout (version, security, started_by, reason, started_at) values (${r.version}, ${r.security}, ${r.by}, ${r.reason}, ${r.at}) returning id`
  if (!row) throw new Error('core_rollout: insert returned nothing')
  return row.id
}

/**
 * Every store live on an older core joins the rollout (SAAS §10): the first `canaries` by a hash of the store and the
 * rollout at position 0, every other at a position from 1 to 100 that the waves' percent reaches.
 */
export const enrolStores = async (tx: ScopedSql, rollout: { id: string; version: string }, canaries: number, at: Date): Promise<number> => {
  const rows = await tx`
    insert into core_rollout_store (rollout_id, store_id, position, from_version)
    select ${rollout.id}, e.store_id, case when e.rank <= ${canaries} then 0 else 1 + mod(abs(hashtext(e.store_id::text || ${rollout.id}::text)), 100) end, e.core_version
    from (
      select f.store_id, r.core_version, row_number() over (order by md5(f.store_id::text || ${rollout.id}::text)) as rank
      from storefront f join publish_run r on r.id = f.live_build_id join store s on s.id = f.store_id
      where s.status <> 'closed'
        and string_to_array(r.core_version, '.')::int[] < string_to_array(${rollout.version}, '.')::int[]
        and (f.core_upgrade_version is null or string_to_array(f.core_upgrade_version, '.')::int[] < string_to_array(${rollout.version}, '.')::int[])
    ) e
    returning store_id`
  await tx`update core_rollout set enrolled_at = ${at} where id = ${rollout.id}`
  return rows.count
}

/** Marks up to `limit` waiting stores within `upTo` running, lowest position first; their ids to queue. */
export const startStores = (tx: ScopedSql, rolloutId: string, upTo: number, limit: number, at: Date): Promise<{ id: string; store_id: string; partner_id: string }[]> =>
  tx<{ id: string; store_id: string; partner_id: string }[]>`
    update core_rollout_store u set state = 'running', started_at = ${at}
    from (
      select s.id from core_rollout_store s where s.rollout_id = ${rolloutId} and s.state = 'pending' and s.position <= ${upTo}
      order by s.position, s.store_id limit ${limit} for update skip locked
    ) due, store st
    where u.id = due.id and st.id = u.store_id
    returning u.id, u.store_id, st.partner_id`

export interface StoreUpgradeRow {
  id: string
  rollout_id: string
  store_id: string
  partner_id: string
  state: StoreUpgradeState
  from_version: string
  version: string
  security: boolean
  release_kind: 'major' | 'minor' | 'patch'
  rollout_state: RolloutState
  publish_run_id: string | null
}

export const selectStoreUpgrade = async (tx: ScopedSql, id: string): Promise<StoreUpgradeRow | null> =>
  (
    await tx<StoreUpgradeRow[]>`
      select s.id, s.rollout_id, s.store_id, st.partner_id, s.state, s.from_version, r.version, r.security or c.security as security, c.kind as release_kind,
        r.state as rollout_state, s.publish_run_id
      from core_rollout_store s join core_rollout r on r.id = s.rollout_id join core_release c on c.version = r.version join store st on st.id = s.store_id
      where s.id = ${id} for update of s`
  )[0] ?? null

/** The run an upgrade is building now, and the commit it builds. */
export const setStoreUpgradeRun = async (tx: ScopedSql, id: string, run: { commit: string; runId: string }): Promise<void> => {
  await tx`update core_rollout_store set commit = ${run.commit}, publish_run_id = ${run.runId} where id = ${id}`
}

/** How a store's upgrade ended, with its last build's report (CONSOLE-DESIGN L2). */
export const finishStoreUpgrade = async (tx: ScopedSql, id: string, end: { state: StoreUpgradeState; error: string | null; at: Date }): Promise<void> => {
  await tx`
    update core_rollout_store s set state = ${end.state}, error = ${end.error}, finished_at = ${end.at},
      gate = (select r.gate from publish_run r where r.id = s.publish_run_id)
    where s.id = ${id} and s.state = 'running'`
}

/** A store's own code: its live build, or the build of its own theme the baseline replaced (ARCHITECTURE §7). */
export const selectUpgradeSource = async (tx: ScopedSql, storeId: string): Promise<{ build_id: string; commit: string; template: string; core_version: string } | null> =>
  (
    await tx<{ build_id: string; commit: string; template: string; core_version: string }[]>`
      select r.id as build_id, r.commit, r.template, r.core_version
      from storefront f join publish_run r on r.id = case when f.theme_mode = 'baseline' and f.baseline_from_build_id is not null then f.baseline_from_build_id else f.live_build_id end
      where f.store_id = ${storeId}`
  )[0] ?? null

export const setCorePinned = async (tx: ScopedSql, storeId: string, reason: string | null): Promise<void> => {
  await tx`update storefront set core_pinned_reason = ${reason} where store_id = ${storeId}`
}

/** The baseline theme is served (ARCHITECTURE §7): why, and the build of the store's own theme it replaced. */
export const setBaseline = async (tx: ScopedSql, storeId: string, b: { reason: string; fromBuildId: string }): Promise<void> => {
  await tx`update storefront set theme_mode = 'baseline', baseline_reason = ${b.reason}, baseline_from_build_id = ${b.fromBuildId} where store_id = ${storeId}`
}

export const clearBaseline = async (tx: ScopedSql, storeId: string): Promise<void> => {
  await tx`update storefront set theme_mode = 'own', baseline_reason = null, baseline_from_build_id = null where store_id = ${storeId}`
}

/** A major's passed upgrade, which the merchant's next publish takes (ARCHITECTURE §7). */
export const setPendingUpgrade = async (tx: ScopedSql, storeId: string, pending: { version: string; commit: string } | null): Promise<void> => {
  await tx`update storefront set core_upgrade_version = ${pending?.version ?? null}, core_upgrade_commit = ${pending?.commit ?? null} where store_id = ${storeId}`
}
export interface RolloutRow {
  id: string
  version: string
  security: boolean
  state: RolloutState
  paused_state: 'canary' | 'waves' | null
  percent: number
  reason: string
  started_by: string | null
  started_at: Date
  finished_at: Date | null
  enrolled_at: Date | null
}

const rolloutColumns = 'id, version, security, state, paused_state, percent, reason, started_by, started_at, finished_at, enrolled_at'

export const selectRollout = async (tx: ScopedSql, id: string, lock = false): Promise<RolloutRow | null> =>
  (await tx<RolloutRow[]>`select ${tx.unsafe(rolloutColumns)} from core_rollout where id = ${id} ${lock ? tx`for update` : tx``}`)[0] ?? null

/** The rollouts the tick moves: the one in canary or waves, and any rolled back with stores still to put back. */
export const selectRolloutsToTick = (tx: ScopedSql): Promise<RolloutRow[]> =>
  tx<RolloutRow[]>`
    select ${tx.unsafe(rolloutColumns)} from core_rollout r
    where state in ('canary', 'waves')
      or (state = 'rolled_back' and exists (select 1 from core_rollout_store s where s.rollout_id = r.id and s.state in ('live', 'migrated', 'passed') and s.error is null))
    order by started_at
    for update`

export const selectRollouts = (tx: ScopedSql, page: { after?: { at: Date; id: string } | undefined; limit: number }): Promise<RolloutRow[]> =>
  tx<RolloutRow[]>`
    select ${tx.unsafe(rolloutColumns)} from core_rollout
    where ${page.after ? tx`(started_at, id) < (${page.after.at}, ${page.after.id})` : tx`true`}
    order by started_at desc, id desc limit ${page.limit + 1}`

export const selectReleaseForRollout = async (tx: ScopedSql, version: string): Promise<{ version: string; security: boolean } | null> =>
  (await tx<{ version: string; security: boolean }[]>`select version, security from core_release where version = ${version}`)[0] ?? null

export const setRolloutState = async (tx: ScopedSql, id: string, change: { state: RolloutState; pausedState?: 'canary' | 'waves' | null; percent?: number; finishedAt?: Date | null }): Promise<void> => {
  await tx`
    update core_rollout set state = ${change.state}, paused_state = ${change.pausedState ?? null},
      percent = coalesce(${change.percent ?? null}::int, percent), finished_at = coalesce(finished_at, ${change.finishedAt ?? null}::timestamptz)
    where id = ${id}`
}

/** Upgrades running across every rollout: each holds one of the org's Actions jobs at most (LIVE-SHOP §10). */
export const countRunning = async (tx: ScopedSql): Promise<number> =>
  Number((await tx<{ n: string }[]>`select count(*)::text as n from core_rollout_store where state = 'running'`)[0]?.n ?? 0)

export interface PhaseCounts {
  pending: number
  running: number
  failed: number
}

/** Within `upTo` (0 for the canaries): still to start, running, and ended pinned or on the baseline. */
export const phaseCounts = async (tx: ScopedSql, rolloutId: string, upTo: number): Promise<PhaseCounts> => {
  const [row] = await tx<{ pending: string; running: string; failed: string }[]>`
    select count(*) filter (where state = 'pending')::text as pending, count(*) filter (where state = 'running')::text as running,
      count(*) filter (where state in ('pinned', 'baseline'))::text as failed
    from core_rollout_store where rollout_id = ${rolloutId} and position <= ${upTo}`
  return { pending: Number(row?.pending ?? 0), running: Number(row?.running ?? 0), failed: Number(row?.failed ?? 0) }
}

/** A rolled-back rollout's stores still on its version, a batch at a time. */
export const selectToRevert = (tx: ScopedSql, rolloutId: string, limit: number): Promise<{ id: string; store_id: string; state: StoreUpgradeState; publish_run_id: string | null }[]> =>
  tx<{ id: string; store_id: string; state: StoreUpgradeState; publish_run_id: string | null }[]>`
    select id, store_id, state, publish_run_id from core_rollout_store
    where rollout_id = ${rolloutId} and state in ('live', 'migrated', 'passed') and error is null
    order by position, store_id limit ${limit}`

/** Put back, or left as it is with why: `moved_on` when the store published since. */
export const markReverted = async (tx: ScopedSql, id: string, outcome: { reverted: true } | { reverted: false; error: string }, at: Date): Promise<void> => {
  if (outcome.reverted) await tx`update core_rollout_store set state = 'reverted', finished_at = ${at} where id = ${id}`
  else await tx`update core_rollout_store set error = ${outcome.error} where id = ${id}`
}

/** The stores of each rollout counted by state, in one query for a page of them. */
export const countStoresByState = (tx: ScopedSql, rolloutIds: readonly string[]): Promise<{ rollout_id: string; state: StoreUpgradeState; n: number }[]> =>
  tx<{ rollout_id: string; state: StoreUpgradeState; n: number }[]>`
    select rollout_id, state, count(*)::int as n from core_rollout_store
    where rollout_id = any(${pgArray(rolloutIds)}::uuid[]) group by rollout_id, state order by rollout_id, state`

