import type postgres from 'postgres'
import type { ActivityEntry } from '#auth/activity'
import { logEvent } from '#core/log'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { countRunning, enrolStores, markReverted, phaseCounts, selectRolloutsToTick, selectToRevert, setPendingUpgrade, setRolloutState, startStores, type RolloutRow } from '#db/scoped/coreRollouts'
import { activityLog } from '#saas/activity/index'
import { queueSideEffect } from '#saas/outbox/index'
import { rollBackLive } from '#saas/storefronts/index'
import { storefrontUpgradeKind } from './upgrade'

// The rollout's tick (SAAS §10), every minute from the cron: canaries first, then waves of a growing share of the fleet,
// never more upgrades building at once than the org's Actions jobs allow (storefront LIVE-SHOP §10).

/** Stores upgraded before anyone else's, chosen by a hash of the store and the rollout. */
export const canaryStores = 5
/** How far each wave reaches, in stores per hundred, after the canaries. */
export const wavePercents = [10, 25, 50, 100] as const
/** The Free plan's jobs at once, until GITHUB_ACTIONS_JOBS says the org's (LIVE-SHOP §10, decided on #287). */
export const defaultActionsJobs = 20
/** Stores a rolled-back rollout puts back each minute. */
export const revertBatch = 20

/**
 * A security fix may take every job; any other rollout half, so merchants' own publishes keep the rest (LIVE-SHOP §8:
 * a security fix goes ahead of automatic publishes).
 */
export const rolloutCapacity = (actionsJobs: number, security: boolean): number => (security ? actionsJobs : Math.max(1, Math.floor(actionsJobs / 2)))

const nextPercent = (percent: number): number | null => wavePercents.find((p) => p > percent) ?? null

const rolloutEntry = (rollout: RolloutRow, action: string, reason: string): ActivityEntry => ({
  category: 'system',
  action,
  result: 'success',
  actorKind: 'job',
  actorId: 'core-rollout',
  actorLabel: 'Core rollout',
  partnerId: null,
  storeId: null,
  target: { type: 'core_rollout', id: rollout.id, label: rollout.version },
  changes: [],
  reason,
  api: 'system',
  requestId: null,
  ip: null,
  userAgent: null,
  visibility: 'staff',
})

const startDue = async (tx: ScopedSql, rollout: RolloutRow, upTo: number, free: number, at: Date): Promise<number> => {
  if (free <= 0) return 0
  const started = await startStores(tx, rollout.id, upTo, free, at)
  for (const s of started) {
    await queueSideEffect(tx, { kind: storefrontUpgradeKind, idempotencyKey: `upgrade:${s.id}`, payload: { upgradeId: s.id, rolloutId: rollout.id, storeId: s.store_id }, partnerId: s.partner_id, storeId: s.store_id })
  }
  return started.length
}

/** One rollout one step on: enrol, start what the phase and the jobs allow, and move to the next phase once one ends. */
const advance = async (tx: ScopedSql, rollout: RolloutRow, actionsJobs: number, at: Date): Promise<void> => {
  if (!rollout.enrolled_at) {
    const enrolled = await enrolStores(tx, rollout, canaryStores, at)
    logEvent({ event: 'core_rollout_enrolled', api: 'system', code: rollout.version, count: enrolled })
  }
  const upTo = rollout.state === 'canary' ? 0 : rollout.percent
  const free = rolloutCapacity(actionsJobs, rollout.security) - (await countRunning(tx))
  await startDue(tx, rollout, upTo, free, at)
  const phase = await phaseCounts(tx, rollout.id, upTo)
  if (phase.pending > 0 || phase.running > 0) return
  if (rollout.state === 'canary') {
    // A canary pinned or on the baseline stops the rollout for an engineer to look (SAAS §10).
    if (phase.failed > 0) {
      await setRolloutState(tx, rollout.id, { state: 'paused', pausedState: 'canary' })
      await activityLog.record(tx, rolloutEntry(rollout, 'core_rollout.paused', 'canary_failed'))
      logEvent({ event: 'core_rollout_paused', api: 'system', code: 'canary_failed' })
      return
    }
    await setRolloutState(tx, rollout.id, { state: 'waves', percent: wavePercents[0] })
    return
  }
  const next = nextPercent(rollout.percent)
  if (next === null) await setRolloutState(tx, rollout.id, { state: 'done', finishedAt: at })
  else await setRolloutState(tx, rollout.id, { state: 'waves', percent: next })
}

/** A rolled-back rollout's stores, a batch a minute: each put back on the build before its upgrade, or left as it is. */
const revert = async (tx: ScopedSql, rollout: RolloutRow, at: Date): Promise<void> => {
  for (const row of await selectToRevert(tx, rollout.id, revertBatch)) {
    if (row.state === 'passed') {
      await setPendingUpgrade(tx, row.store_id, null)
      await markReverted(tx, row.id, { reverted: true }, at)
      continue
    }
    const outcome = row.publish_run_id ? await rollBackLive(tx, { storeId: row.store_id, runId: row.publish_run_id, code: 'core_rolled_back', now: at }) : 'refused'
    if (outcome === 'busy') continue
    await markReverted(tx, row.id, outcome === 'rolled_back' ? { reverted: true } : { reverted: false, error: 'moved_on' }, at)
  }
}

export const advanceRollouts = (sql: postgres.Sql, input: { actionsJobs: number; now: Date }): Promise<void> =>
  withSystemScope(sql, async (tx) => {
    for (const rollout of await selectRolloutsToTick(tx)) {
      if (rollout.state === 'rolled_back') await revert(tx, rollout, input.now)
      else await advance(tx, rollout, input.actionsJobs, input.now)
    }
  })
