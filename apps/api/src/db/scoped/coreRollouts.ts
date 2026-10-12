import type { ScopedSql } from './index'

// core_rollout and core_rollout_store (DATA-MODEL §7.8 "Platform scope", SAAS §10): staff start and steer a rollout in
// platform scope; the cron's tick and each store's upgrade Workflow move it in system scope.

export type RolloutState = 'canary' | 'waves' | 'paused' | 'done' | 'rolled_back'
export type StoreUpgradeState = 'pending' | 'running' | 'passed' | 'migrated' | 'pinned' | 'baseline' | 'live' | 'reverted'

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

/** A major's passed upgrade, which the merchant's next publish takes (ARCHITECTURE §7). */
export const setPendingUpgrade = async (tx: ScopedSql, storeId: string, pending: { version: string; commit: string } | null): Promise<void> => {
  await tx`update storefront set core_upgrade_version = ${pending?.version ?? null}, core_upgrade_commit = ${pending?.commit ?? null} where store_id = ${storeId}`
}