import type postgres from 'postgres'
import type { TenantContext } from '#core/tenancy'
import { amountKeys, selectStoreEntitlement, selectUnlockingPlan, type EntitlementKey, type UnlockingPlan } from '#db/scoped/entitlements'
import { withScope, withSystemScope } from '#db/scoped/index'

export type { EntitlementKey, UnlockingPlan } from '#db/scoped/entitlements'

/** Why a plan refuses: the facts the portal words as "upgrade to …" (FIRST-RELEASE §19, `PLAN_LIMIT`). */
export interface PlanLimit {
  key: EntitlementKey
  /** The limit reached, or null for a switch that is off. */
  limit: number | null
  /** The partner's cheapest live plan that allows it, or null when none does. */
  unlockedBy: UnlockingPlan | null
}

const isAmountKey = (key: EntitlementKey): boolean => (amountKeys as readonly string[]).includes(key)

/**
 * Whether the store's plan allows this, checked on the server (AGENTS.md "Tenancy and access").
 * `total` is what the store would hold after the action, for a limit; ignored for a switch.
 * A switch or limit the plan doesn't set refuses: an entitlement is granted, never assumed.
 */
export const planLimitFor = async (sql: postgres.Sql, context: TenantContext, key: EntitlementKey, now: Date, total = 0): Promise<PlanLimit | null> => {
  // A supplier's action counts against the store's plan too, which only the merchant side reads
  // (DATA-MODEL §5.2): the same store, so RLS still pins the read to app.store_id.
  const current = await withScope(sql, { ...context, sellerScope: { kind: 'all' } }, (tx) => selectStoreEntitlement(tx, context.storeId, key, now))
  const amount = isAmountKey(key)
  if (amount ? total <= (current.amount ?? 0) : current.enabled === true) return null
  const unlockedBy = await withSystemScope(sql, (tx) => selectUnlockingPlan(tx, context.storeId, key, amount ? total : null))
  return { key, limit: amount ? (current.amount ?? 0) : null, unlockedBy }
}
