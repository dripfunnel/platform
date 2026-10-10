import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog } from '#auth/activity'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { selectStoreForUpdate } from '#db/scoped/stores'
import { applyPlan, selectOverdueStores, selectStoreBySubscription, syncSubscription, type BillingSubscriptionRow } from '#db/scoped/storeBilling'
import type { StripeSubscription } from '#integrations/stripe/index'
import { en } from '#saas/email/index'
import { queueSideEffect } from '#saas/outbox/index'
import { transitionStore } from '#saas/stores/index'

// The store's state from its Stripe subscription (SAAS §4.2, §7.2–7.3): a failed renewal makes it past due, which
// keeps the storefront selling and the portal read-only; paid again it is active; 14 days unpaid suspend it.

/** SAAS §7.3, decided 2026-10-05 on #284. */
export const suspendAfterDays = 14
/** Who suspended a store for being unpaid, so a payment that arrives later restores it and a person's suspension stays. */
export const dunningLabel = 'Billing'
const sweepSize = 100
const dayMs = 86_400_000

const systemEntry = (store: { id: string; partner_id: string; name: string }, action: string, actorKind: 'job' | 'provider', reason: string, changes: NonNullable<ActivityEntry['changes']> = []): ActivityEntry => ({
  category: 'system',
  action,
  result: 'success',
  actorKind,
  actorId: null,
  actorLabel: actorKind === 'provider' ? 'Stripe' : dunningLabel,
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

const statusOf = (s: StripeSubscription['status'], before: BillingSubscriptionRow['status']): BillingSubscriptionRow['status'] => {
  switch (s) {
    case 'active':
    case 'trialing':
      return 'active'
    case 'past_due':
    case 'unpaid':
      return 'past_due'
    case 'canceled':
    case 'incomplete_expired':
      return 'cancelled'
    default:
      // incomplete or paused: nothing has been decided on Stripe yet.
      return before
  }
}

/**
 * One subscription event, read back from Stripe (saas/billing/webhook.ts): the store's partner, or null when no
 * store holds the subscription, so the event isn't kept.
 */
export const applyStoreSubscription = async (tx: ScopedSql, sub: StripeSubscription, activity: ActivityLog, at: Date): Promise<string | null> => {
  const storeId = sub.metadata['store_id']
  if (!storeId || !/^[0-9a-f-]{36}$/i.test(storeId)) return null
  const row = await selectStoreBySubscription(tx, storeId, sub.id)
  if (!row || row.stripe_customer_id !== sub.customer) return null
  const item = sub.items.data[0]
  const start = sub.current_period_start ?? item?.current_period_start
  const end = sub.current_period_end ?? item?.current_period_end
  const periodStart = start ? new Date(start * 1000) : row.period_start
  const periodEnd = end ? new Date(end * 1000) : row.period_end
  // A scheduled change takes effect when Stripe's subscription names it: its phase sets the plan's metadata (SAAS §6.3).
  const m = sub.metadata
  if (row.next_plan_id && m['plan_id'] === row.next_plan_id && m['plan_version'] === String(row.next_plan_version) && item?.price.unit_amount != null) {
    await applyPlan(tx, storeId, { planId: row.next_plan_id, planVersion: row.next_plan_version ?? 1, interval: m['interval'] === 'year' ? 'year' : 'month', amount: item.price.unit_amount, subscriptionId: sub.id, periodStart, periodEnd, activate: false })
  }
  const status = statusOf(sub.status, row.status)
  await syncSubscription(tx, storeId, { status, periodStart, periodEnd, cancelAt: sub.cancel_at_period_end ? periodEnd : null })

  const store = await selectStoreForUpdate(tx, storeId)
  if (!store) return row.partner_id
  const change = async (to: 'active' | 'past_due' | 'cancelled' | 'restored', action: string) => {
    const done = await transitionStore(tx, store, { to }, at)
    if (done.ok) await activity.record(tx, systemEntry(store, action, 'provider', sub.status, [{ field: 'status', before: store.status, after: done.status }]))
    return done.ok
  }
  if (status === 'past_due' && (store.status === 'trial' || store.status === 'active')) await change('past_due', 'store.past_due')
  else if (status === 'active' && store.status === 'past_due') await change('active', 'store.paid')
  else if (status === 'active' && store.status === 'suspended' && store.suspended_by_label === dunningLabel && store.suspended_previous_status === 'past_due') {
    // Paid after dunning suspended it: back to past due, then on to active, each in the log.
    if (await change('restored', 'store.restored')) {
      const restored = await selectStoreForUpdate(tx, storeId)
      if (restored) {
        const done = await transitionStore(tx, restored, { to: 'active' }, at)
        if (done.ok) await activity.record(tx, systemEntry(restored, 'store.paid', 'provider', sub.status, [{ field: 'status', before: 'past_due', after: 'active' }]))
      }
    }
  } else if (status === 'cancelled' && store.status !== 'cancelled' && store.status !== 'closed') await change('cancelled', 'store.cancelled')
  return row.partner_id
}

/**
 * The cron's dunning step: every store 14 days past due is suspended, with the partner's support as its contact, who
 * may restore it (SAAS §4.2, ACCESS §5.3); Stripe's own later retry paying it restores it too.
 */
export const suspendOverdueStores = (sql: postgres.Sql, activity: ActivityLog, now: Date): Promise<number> =>
  withSystemScope(sql, async (tx) => {
    let suspended = 0
    for (const { id } of await selectOverdueStores(tx, new Date(now.getTime() - suspendAfterDays * dayMs), sweepSize)) {
      const store = await selectStoreForUpdate(tx, id)
      if (!store || store.status !== 'past_due') continue
      const done = await transitionStore(tx, store, { to: 'suspended', reason: en.storeSuspended.unpaid, by: dunningLabel }, now)
      if (!done.ok) continue
      await activity.record(tx, systemEntry(store, 'store.suspended', 'job', 'unpaid', [{ field: 'status', before: 'past_due', after: 'suspended' }]))
      await queueSideEffect(tx, {
        kind: 'email',
        idempotencyKey: `store-suspended:${store.id}:${now.toISOString()}`,
        payload: { template: 'store-suspended', storeId: store.id, reason: en.storeSuspended.unpaid, contact: 'partner-support' },
        partnerId: store.partner_id,
        storeId: store.id,
      })
      suspended += 1
    }
    return suspended
  })
