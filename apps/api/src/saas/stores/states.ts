import type { StoreRow, StoreStatus } from '#db/schema/saas'
import { updateStoreStatus } from '#db/scoped/stores'
import type { ScopedSql } from '#db/scoped/index'

// SAAS.md §4.2. Suspended keeps the status it had, so Restore puts it back exactly (decided on
// #20); only a person suspends, with a reason.
export const storeTransitions: Readonly<Record<StoreStatus, readonly StoreStatus[]>> = {
  trial: ['active', 'past_due', 'suspended', 'cancelled'],
  active: ['past_due', 'suspended', 'cancelled'],
  past_due: ['active', 'suspended', 'cancelled'],
  // Out of suspension only by `restored` (back to the status it had) or by cancelling.
  suspended: ['cancelled'],
  cancelled: ['closed'],
  closed: [],
}

export const canTransitionStore = (from: StoreStatus, to: StoreStatus): boolean => storeTransitions[from].includes(to)

export type StoreTransition =
  | { to: 'active' }
  | { to: 'past_due' }
  | { to: 'suspended'; reason: string; by: string }
  | { to: 'restored' }
  | { to: 'cancelled' }
  | { to: 'closed' }

export type StoreTransitionRefusal = 'INVALID_TRANSITION' | 'REASON_REQUIRED' | 'NOT_SUSPENDED'

export type StoreTransitionResult = { ok: true; status: StoreStatus } | { ok: false; code: StoreTransitionRefusal }

/** Writes the status and the facts that go with it; the activity entry is the caller's (LOGGING.md §5). */
export const transitionStore = async (tx: ScopedSql, store: StoreRow, change: StoreTransition, now: Date): Promise<StoreTransitionResult> => {
  if (change.to === 'restored') {
    if (store.status !== 'suspended' || !store.suspended_previous_status) return { ok: false, code: 'NOT_SUSPENDED' }
    const status = store.suspended_previous_status
    await updateStoreStatus(tx, store.id, { status, suspendedAt: null, suspendedReason: null, suspendedByLabel: null, suspendedPreviousStatus: null })
    return { ok: true, status }
  }
  if (!canTransitionStore(store.status, change.to)) return { ok: false, code: 'INVALID_TRANSITION' }
  switch (change.to) {
    case 'active':
      await updateStoreStatus(tx, store.id, { status: 'active', pastDueSince: null })
      break
    case 'past_due':
      await updateStoreStatus(tx, store.id, { status: 'past_due', pastDueSince: now })
      break
    case 'suspended':
      if (change.reason.trim() === '') return { ok: false, code: 'REASON_REQUIRED' }
      // The map admits only trial, active and past_due here, which is what the column holds.
      await updateStoreStatus(tx, store.id, {
        status: 'suspended',
        suspendedAt: now,
        suspendedReason: change.reason,
        suspendedByLabel: change.by,
        suspendedPreviousStatus: store.status as 'trial' | 'active' | 'past_due',
      })
      break
    case 'cancelled':
      await updateStoreStatus(tx, store.id, { status: 'cancelled', cancelledAt: now, suspendedAt: null, suspendedReason: null, suspendedByLabel: null, suspendedPreviousStatus: null })
      break
    case 'closed':
      await updateStoreStatus(tx, store.id, { status: 'closed', closedAt: now })
      break
  }
  return { ok: true, status: change.to }
}

/** Extends a trial to a later end date (FIRST-RELEASE §5.3); refused off trial. */
export const extendTrial = async (tx: ScopedSql, store: StoreRow, trialEndsAt: Date): Promise<StoreTransitionResult> => {
  if (store.status !== 'trial') return { ok: false, code: 'INVALID_TRANSITION' }
  if (store.trial_ends_at && trialEndsAt <= store.trial_ends_at) return { ok: false, code: 'INVALID_TRANSITION' }
  await updateStoreStatus(tx, store.id, { status: 'trial', trialEndsAt })
  return { ok: true, status: 'trial' }
}
