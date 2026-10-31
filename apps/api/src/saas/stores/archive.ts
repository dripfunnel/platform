import type postgres from 'postgres'
import type { StoreRow } from '#db/schema/saas'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { selectBillingSubscription } from '#db/scoped/storeBilling'
import type { StoreBillingStripe } from '#integrations/stripe/subscriptions'
import { queueSideEffect } from '#saas/outbox/index'
import { transitionStore } from './states'

// Archive a store (#1056): SAAS §4.2's Closed, from Cancelled or Suspended only. Gone from its people and its shoppers
// at once; its repo and files go after 90 days (the existing job). The admin and partner consoles both call this.

export const archivable = (status: StoreRow['status']): boolean => status === 'cancelled' || status === 'suspended'

/**
 * Ends a live Stripe subscription now, before the store's row changes, as Close my store calls Stripe first: a refusal
 * there leaves everything as it was. Callers hold the store's row lock. A store with nothing to end has nothing to do here.
 */
export const endStripeSubscription = async (sql: postgres.Sql, stripe: Pick<StoreBillingStripe, 'cancelNow'> | null, storeId: string): Promise<'ok' | 'NOT_CONNECTED' | 'PROVIDER_UNAVAILABLE'> => {
  const sub = await withSystemScope(sql, (tx) => selectBillingSubscription(tx, storeId))
  if (!sub || !archivable(sub.store_status) || sub.billing_mode !== 'dripfunnel' || !sub.stripe_subscription_id || sub.status === 'cancelled') return 'ok'
  if (!stripe) return 'NOT_CONNECTED'
  try {
    await stripe.cancelNow(sub.stripe_subscription_id)
    return 'ok'
  } catch {
    return 'PROVIDER_UNAVAILABLE'
  }
}

/** The store closed by `by`, its subscription ended, the Owner told and the storefront's lookups purged; false off Cancelled or Suspended. */
export const closeStore = async (tx: ScopedSql, store: StoreRow, by: string, at: Date, endSubscription: (tx: ScopedSql, storeId: string, at: Date) => Promise<void>): Promise<boolean> => {
  if (!archivable(store.status)) return false
  // A suspended store is cancelled first, which the state map allows; Closed comes only from Cancelled.
  if (store.status === 'suspended' && !(await transitionStore(tx, store, { to: 'cancelled' }, at)).ok) return false
  if (!(await transitionStore(tx, { ...store, status: 'cancelled' }, { to: 'closed', by }, at)).ok) return false
  await endSubscription(tx, store.id, at)
  await queueSideEffect(tx, {
    kind: 'email',
    idempotencyKey: `store-archived:${store.id}`,
    payload: { template: 'store-archived', storeId: store.id },
    partnerId: store.partner_id,
    storeId: store.id,
  })
  await queueSideEffect(tx, {
    kind: 'cache.purge',
    idempotencyKey: `store-degraded:${store.id}:closed:${at.toISOString()}`,
    payload: { storeId: store.id, rule: 'closed' },
    partnerId: store.partner_id,
    storeId: store.id,
  })
  return true
}
