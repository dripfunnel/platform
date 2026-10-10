import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog } from '#auth/activity'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { selectStoreEntitlement } from '#db/scoped/entitlements'
import { UNLIMITED } from '#db/scoped/planKeys'
import { selectStoreForUpdate } from '#db/scoped/stores'
import { applyPlan, applyProductKeep, markTrialUnpaid, saveKeepPicks, selectBillingSubscription, selectEndedTrials, selectFreePlan } from '#db/scoped/storeBilling'
import { selectCurrentVersions } from '#db/scoped/partnerPlans'
import { transitionStore } from '#saas/stores/index'
import { addInterval } from './quote'

// Choose what to keep (SAAS §6.2, PortalKeep): a plan whose product limit is below the catalogue pauses the rest,
// never deletes it, the Owner's picks first; an upgrade brings it back. Trials that end without a plan move to the
// partner's free plan this way, or, where it has none, to past due (FIRST-RELEASE §3.3).

/** The product limit of the plan the store is on now, with its overrides; null when the plan sets none, which pauses nothing. */
export const productLimitOf = async (tx: ScopedSql, storeId: string, at: Date): Promise<number | null> => {
  const { amount } = await selectStoreEntitlement(tx, storeId, 'products', at)
  return amount === null ? null : Math.min(amount, UNLIMITED)
}

/** Keeps the catalogue within the plan the store is on now, with the Owner's picks, which it then forgets. */
export const keepWithinPlan = async (tx: ScopedSql, storeId: string, at: Date): Promise<{ paused: number; back: number }> => {
  const limit = await productLimitOf(tx, storeId, at)
  if (limit === null) return { paused: 0, back: 0 }
  const sub = await selectBillingSubscription(tx, storeId)
  const done = await applyProductKeep(tx, storeId, sub?.keep_products ?? [], limit, at)
  await saveKeepPicks(tx, storeId, null)
  return done
}

const sweepSize = 100

const trialEntry = (store: { id: string; partner_id: string; name: string }, reason: 'free_plan' | 'no_free_plan', changes: NonNullable<ActivityEntry['changes']>): ActivityEntry => ({
  category: 'system',
  action: 'store.trial_ended',
  result: 'success',
  actorKind: 'job',
  actorId: null,
  actorLabel: 'Billing',
  partnerId: store.partner_id,
  storeId: store.id,
  target: { type: 'store', id: store.id, label: store.name },
  reason,
  changes,
  api: null,
  visibility: 'store',
  requestId: null,
  ip: null,
  userAgent: null,
})

const endTrial = async (tx: ScopedSql, activity: ActivityLog, storeId: string, now: Date): Promise<boolean> => {
  const sub = await selectBillingSubscription(tx, storeId, true)
  if (!sub || sub.status !== 'trial' || !sub.trial_ends_at || sub.trial_ends_at > now) return false
  const store = await selectStoreForUpdate(tx, storeId)
  if (!store || store.status !== 'trial') return false
  const free = await selectFreePlan(tx, sub.partner_id, sub.currency)
  if (free) {
    const version = (await selectCurrentVersions(tx, [free.id])).get(free.id)
    const amount = version?.prices.find((p) => p.currency === sub.currency)?.monthly ?? 0
    await applyPlan(tx, storeId, { planId: free.id, planVersion: free.version, interval: 'month', amount, subscriptionId: null, periodStart: now, periodEnd: addInterval(now, 'month'), activate: true })
    await transitionStore(tx, store, { to: 'active' }, now)
    await keepWithinPlan(tx, storeId, now)
    await activity.record(tx, trialEntry(store, 'free_plan', [{ field: 'plan', before: sub.plan_id, after: free.id }]))
  } else {
    await markTrialUnpaid(tx, storeId)
    await transitionStore(tx, store, { to: 'past_due' }, now)
    await activity.record(tx, trialEntry(store, 'no_free_plan', [{ field: 'status', before: 'trial', after: 'past_due' }]))
  }
  return true
}

/** The cron's trial step: each trial past its end with no plan chosen moves to the free plan, or is past due without one.
 * Each store is its own transaction, so one that fails is counted and the others still end. */
export const endTrials = async (sql: postgres.Sql, activity: ActivityLog, now: Date): Promise<{ ended: number; failed: number }> => {
  const due = await withSystemScope(sql, (tx) => selectEndedTrials(tx, now, sweepSize))
  const done = { ended: 0, failed: 0 }
  for (const { store_id: storeId } of due) {
    try {
      if (await withSystemScope(sql, (tx) => endTrial(tx, activity, storeId, now))) done.ended += 1
    } catch {
      done.failed += 1
    }
  }
  return done
}
