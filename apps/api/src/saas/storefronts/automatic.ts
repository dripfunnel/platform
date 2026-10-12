import type postgres from 'postgres'
import { withSystemScope } from '#db/scoped/index'
import { lockStorefront, pruneVersionHistory, selectCatalogueState, selectDueAutomatic, setNextAutoPublish } from '#db/scoped/publishing'
import { startPublish } from './publish'

// The automatic publish (SAAS §9.1): a store with catalogue changes waiting is rebuilt on a schedule, using no
// allowance; a store with none isn't. The interval is the platform's default until the Admin setting exists (R5).

/** Decided on #318: daily, the platform default (never more often than hourly, SAAS §6.1). */
export const autoPublishIntervalMs = 24 * 60 * 60 * 1000
const batch = 100

/** Starts each due store's automatic publish and moves its next one on; answers how many started. */
export const startAutomaticPublishes = async (sql: postgres.Sql, now: Date): Promise<number> => {
  const due = await withSystemScope(sql, (tx) => selectDueAutomatic(tx, now, autoPublishIntervalMs, batch))
  let started = 0
  for (const { store_id: storeId } of due) {
    const ok = await withSystemScope(sql, async (tx) => {
      if (!(await lockStorefront(tx, storeId))) return false
      const state = await selectCatalogueState(tx, storeId)
      if (!state?.changes_since || !state.live_commit || !state.live_template || !state.live_core_version) return false
      await setNextAutoPublish(tx, storeId, new Date(now.getTime() + autoPublishIntervalMs))
      const run = await startPublish(tx, { storeId, kind: 'automatic', commit: state.live_commit, template: state.live_template, coreVersion: state.live_core_version, usesAllowance: false, startedBy: { kind: 'system', id: null }, at: now })
      return run.ok
    })
    if (ok) started += 1
  }
  return started
}

/** The version history kept for each plan's days (SAAS §9.2); a batch per call. */
export const pruneHistory = (sql: postgres.Sql, now: Date): Promise<number> => withSystemScope(sql, (tx) => pruneVersionHistory(tx, now, 500))
