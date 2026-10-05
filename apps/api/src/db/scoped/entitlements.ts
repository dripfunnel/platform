import type { ScopedSql } from './index'

// SAAS.md §6.1's three kinds of entitlement, read for one store. In `system` scope: finding the
// plan that unlocks a feature reads the partner's other live plans, which a store may not
// (0007's plan_store_read), and only that plan's id and name leave this file.

export const switchKeys = ['custom_domain', 'offers', 'suppliers_enabled', 'powered_by_removal', 'aplus', 'size_charts'] as const
export const amountKeys = ['products', 'staff', 'suppliers', 'languages', 'currencies', 'publish_now', 'ai_prompts'] as const
export type SwitchKey = (typeof switchKeys)[number]
export type AmountKey = (typeof amountKeys)[number]
export type EntitlementKey = SwitchKey | AmountKey

export interface StoreEntitlement {
  /** A switch's state, or null for a limit. */
  enabled: boolean | null
  /** A limit or monthly allowance, raised by a live override; null for a switch, or when the plan sets none. */
  amount: number | null
}

/** The store's own value on its current plan version, with its partner's or staff's override (SAAS.md §6.4). */
export const selectStoreEntitlement = async (tx: ScopedSql, storeId: string, key: EntitlementKey, now: Date): Promise<StoreEntitlement> => {
  const rows = await tx<{ enabled: boolean | null; amount: number | null; override: number | null }[]>`
    select e.enabled, e.amount,
      (select o.amount from store_limit_override o
       where o.store_id = sub.store_id and o.key = ${key} and o.removed_at is null
         and (o.duration = 'always' or o.month = date_trunc('month', ${now}::timestamptz)::date)
       order by o.created_at desc limit 1) as override
    from store_subscription sub
    left join plan_entitlement e on e.plan_id = sub.plan_id and e.version = sub.plan_version and e.key = ${key}
    where sub.store_id = ${storeId}
  `
  const row = rows[0]
  if (!row) return { enabled: null, amount: null }
  return { enabled: row.enabled, amount: row.override ?? row.amount }
}

export interface UnlockingPlan {
  id: string
  name: string
}

/**
 * The partner's cheapest live plan, on its current version, that switches the key on or allows
 * at least `atLeast`; null when none does. Cheapest by its monthly price in the store's billing
 * currency, unpriced plans last.
 */
export const selectUnlockingPlan = async (tx: ScopedSql, storeId: string, key: EntitlementKey, atLeast: number | null): Promise<UnlockingPlan | null> => {
  const rows = await tx<UnlockingPlan[]>`
    select p.id, p.name
    from store s
    join plan p on p.partner_id = s.partner_id and p.status = 'live' and p.id is distinct from s.plan_id
    join plan_entitlement e on e.plan_id = p.id and e.version = p.version and e.key = ${key}
    left join store_subscription sub on sub.store_id = s.id
    left join plan_price pr on pr.plan_id = p.id and pr.version = p.version and pr.currency = sub.currency
    where s.id = ${storeId}
      and (e.enabled = true or (e.amount is not null and e.amount >= ${atLeast ?? 0}))
    order by pr.monthly_amount asc nulls last, p.name
    limit 1
  `
  return rows[0] ?? null
}
