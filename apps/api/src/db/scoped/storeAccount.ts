import type { AmountKey } from './plans'
import type { Keyset } from '#core/cursor'
import { pageLimit, type ScopedSql } from './index'

// The store account tables of migrations/0014 (DATA-MODEL.md §7.9, §2.4).

export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'cancelled'

export interface SubscriptionRow {
  store_id: string
  partner_id: string
  plan_id: string
  plan_version: number
  status: SubscriptionStatus
  interval: 'month' | 'year'
  currency: string
  amount: number
  period_start: Date
  period_end: Date
  trial_ends_at: Date | null
  next_plan_id: string | null
  next_plan_version: number | null
  change_at: Date | null
  payment_method_last4: string | null
}

export type NewSubscription = Pick<SubscriptionRow, 'store_id' | 'partner_id' | 'plan_id' | 'plan_version' | 'status' | 'interval' | 'currency' | 'amount' | 'period_start' | 'period_end' | 'trial_ends_at' | 'payment_method_last4'>

export const insertSubscription = async (tx: ScopedSql, s: NewSubscription): Promise<void> => {
  await tx`insert into store_subscription ${tx(s, 'store_id', 'partner_id', 'plan_id', 'plan_version', 'status', 'interval', 'currency', 'amount', 'period_start', 'period_end', 'trial_ends_at', 'payment_method_last4')}`
}

export interface NewOverride {
  storeId: string
  key: AmountKey
  amount: number
  duration: 'month' | 'always'
  month: Date | null
  reason: string
  by: { kind: 'partner_user' | 'staff'; label: string }
  at: Date
}

export const insertLimitOverride = async (tx: ScopedSql, o: NewOverride): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into store_limit_override (store_id, key, amount, duration, month, reason, created_by_kind, created_by_label, created_at)
    values (${o.storeId}, ${o.key}, ${o.amount}, ${o.duration}, ${o.month}, ${o.reason}, ${o.by.kind}, ${o.by.label}, ${o.at})
    returning id
  `
  if (!row) throw new Error('store_limit_override: the insert returned no row')
  return row.id
}

/** Removes an active override of the store once; false when there is none to remove. */
export const removeLimitOverride = async (tx: ScopedSql, storeId: string, id: string, byLabel: string, at: Date): Promise<OverrideRow | null> =>
  (
    await tx<OverrideRow[]>`
      update store_limit_override set removed_at = ${at}, removed_by_label = ${byLabel}
      where id = ${id} and store_id = ${storeId} and removed_at is null
      returning id, key, amount, duration, month, reason, created_by_label, created_at
    `
  )[0] ?? null

export const selectSubscriptionForUpdate = async (tx: ScopedSql, storeId: string): Promise<SubscriptionRow | null> =>
  (
    await tx<SubscriptionRow[]>`
      select store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end, trial_ends_at,
             next_plan_id, next_plan_version, change_at, payment_method_last4
      from store_subscription where store_id = ${storeId} for update
    `
  )[0] ?? null

/** Moves the store to the Live plan's current version at its price (0018's function); the proration adds up for billing. */
export const moveSubscriptionNow = async (tx: ScopedSql, storeId: string, planId: string, proration: number, at: Date): Promise<void> => {
  await tx`select partner_move_subscription(${storeId}, ${planId}, ${proration}, ${at})`
}

/** The move happens at `changeAt` (SAAS §6.3); billing (#201) applies it there. */
export const scheduleSubscriptionMove = async (tx: ScopedSql, storeId: string, planId: string, version: number, changeAt: Date): Promise<void> => {
  await tx`update store_subscription set next_plan_id = ${planId}, next_plan_version = ${version}, change_at = ${changeAt} where store_id = ${storeId}`
}

/** A plan change scheduled for the trial's end moves with it. */
export const extendSubscriptionTrial = async (tx: ScopedSql, storeId: string, endsAt: Date): Promise<void> => {
  await tx`
    update store_subscription set trial_ends_at = ${endsAt}, change_at = case when change_at = trial_ends_at then ${endsAt} else change_at end
    where store_id = ${storeId} and status = 'trial'
  `
}

export const insertTrialExtension = async (tx: ScopedSql, e: { storeId: string; days: number; endsAt: Date; reason: string; by: NewOverride['by']; at: Date }): Promise<void> => {
  await tx`
    insert into store_trial_extension (store_id, days, ends_at, reason, created_by_kind, created_by_label, created_at)
    values (${e.storeId}, ${e.days}, ${e.endsAt}, ${e.reason}, ${e.by.kind}, ${e.by.label}, ${e.at})
  `
}

/** Written where the work happens (the engine, the meters); one row per store and key. */
export const setUsage = async (tx: ScopedSql, storeId: string, key: AmountKey, used: number, periodStart: Date | null, at: Date): Promise<void> => {
  await tx`
    insert into store_usage (store_id, key, used, period_start, updated_at) values (${storeId}, ${key}, ${used}, ${periodStart}, ${at})
    on conflict (store_id, key) do update set used = excluded.used, period_start = excluded.period_start, updated_at = excluded.updated_at
  `
}

export interface StoreAccount {
  subscription: SubscriptionRow | null
  usage: { key: AmountKey; used: number; period_start: Date | null }[]
}

/** One store's subscription and usage, for a scope that reaches the store; empty otherwise. */
export const selectStoreAccount = async (tx: ScopedSql, storeId: string): Promise<StoreAccount> => {
  const [subscription] = await tx<SubscriptionRow[]>`
    select store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end, trial_ends_at,
           next_plan_id, next_plan_version, change_at, payment_method_last4
    from store_subscription where store_id = ${storeId}
  `
  const usage = await tx<StoreAccount['usage']>`select key, used, period_start from store_usage where store_id = ${storeId} order by key`
  return { subscription: subscription ?? null, usage }
}

export interface OverrideRow {
  id: string
  key: AmountKey
  amount: number
  duration: 'month' | 'always'
  month: Date | null
  reason: string
  created_by_label: string
  created_at: Date
}

// The partner's and staff's view, with why and who: a merchant is not granted those columns
// (0014), and its own read comes with the Store API. Newest first, a keyset page at a time.
export const selectOverrides = (tx: ScopedSql, storeId: string, after: Keyset | undefined, limit: number): Promise<OverrideRow[]> =>
  tx<OverrideRow[]>`
    select id, key, amount, duration, month, reason, created_by_label, created_at from store_limit_override
    where store_id = ${storeId} and removed_at is null
      ${after ? tx`and (created_at, id) < (${after.occurredAt}, ${after.id})` : tx``}
    order by created_at desc, id desc limit ${pageLimit(limit)}
  `

export interface TrialExtensionRow {
  id: string
  days: number
  ends_at: Date
  reason: string
  created_by_label: string
  created_at: Date
}

export const selectTrialExtensions = (tx: ScopedSql, storeId: string, after: Keyset | undefined, limit: number): Promise<TrialExtensionRow[]> =>
  tx<TrialExtensionRow[]>`
    select id, days, ends_at, reason, created_by_label, created_at from store_trial_extension
    where store_id = ${storeId}
      ${after ? tx`and (created_at, id) < (${after.occurredAt}, ${after.id})` : tx``}
    order by created_at desc, id desc limit ${pageLimit(limit)}
  `
