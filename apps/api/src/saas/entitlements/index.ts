import type postgres from 'postgres'
import type { TenantContext } from '#core/tenancy'
import { amountKeys, selectStoreEntitlement, selectUnlockingPlan, type AmountKey, type EntitlementKey, type SwitchKey, type UnlockingPlan } from '#db/scoped/entitlements'
import { withScope, withSystemScope } from '#db/scoped/index'

export type { EntitlementKey, UnlockingPlan } from '#db/scoped/entitlements'

/** A switch is on or off; a limit needs what the store would hold after the action. */
export type PlanCheck = { key: SwitchKey } | { key: AmountKey; total: number }

/** Why a plan refuses: the facts the portal words as "upgrade to …" (FIRST-RELEASE §19, `PLAN_LIMIT`). */
export interface PlanLimit {
  key: EntitlementKey
  /** The limit reached, or null for a switch that is off. */
  limit: number | null
  /** The partner's cheapest live plan that allows it, or null when none does. */
  unlockedBy: UnlockingPlan | null
}


/**
 * Whether the store's plan allows this, checked on the server (AGENTS.md "Tenancy and access").
 * A switch or limit the plan doesn't set refuses: an entitlement is granted, never assumed.
 */
export const planLimitFor = async (sql: postgres.Sql, context: TenantContext, check: PlanCheck, now: Date): Promise<PlanLimit | null> => {
  const { key } = check
  const amount = (amountKeys as readonly string[]).includes(key)
  const total = 'total' in check ? check.total : null
  // The type already demands it; a caller that casts past it still fails closed.
  if (amount && (typeof total !== 'number' || !Number.isFinite(total))) throw new Error(`entitlements: ${key} is a limit and needs a total`)
  // A supplier's action counts against the store's plan too, which only the merchant side reads
  // (DATA-MODEL §5.2): the same store, so RLS still pins the read to app.store_id.
  const current = await withScope(sql, { ...context, sellerScope: { kind: 'all' } }, (tx) => selectStoreEntitlement(tx, context.storeId, key, now))
  if (amount ? (total ?? Infinity) <= (current.amount ?? 0) : current.enabled === true) return null
  const unlockedBy = await withSystemScope(sql, (tx) => selectUnlockingPlan(tx, context.storeId, key, amount ? total : null))
  return { key, limit: amount ? (current.amount ?? 0) : null, unlockedBy }
}
