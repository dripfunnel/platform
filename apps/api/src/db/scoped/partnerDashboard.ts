import type { ProvisioningStep } from '../schema/saas'
import type { ScopedSql } from './index'
import { stuckJobPredicate } from './stores'

// The partner Dashboard's reads (ui/platform/FIRST-RELEASE.md §5; #163): one query per card, each
// a count or a sum over the partner's own rows, which RLS already holds it to.

export interface Window {
  from: Date
  to: Date
}

export interface StoreCounts {
  total: number
  active: number
  trial: number
  past_due: number
  suspended: number
  new_this_month: number
}

export const countPartnerStores = async (tx: ScopedSql, partnerId: string, monthStart: Date): Promise<StoreCounts> =>
  (
    await tx<StoreCounts[]>`
      select count(*)::int as total,
        count(*) filter (where status = 'active')::int as active,
        count(*) filter (where status = 'trial')::int as trial,
        count(*) filter (where status = 'past_due')::int as past_due,
        count(*) filter (where status = 'suspended')::int as suspended,
        count(*) filter (where created_at >= ${monthStart})::int as new_this_month
      from store where partner_id = ${partnerId}
    `
  )[0] ?? { total: 0, active: 0, trial: 0, past_due: 0, suspended: 0, new_this_month: 0 }

export interface RevenueSums {
  currency: string | null
  collected: number
  fee: number
  payout: number
  previous: number
  next_payout_at: string | null
  charges: number
}

/**
 * What was collected in the window and in the one it is compared with, in the contract's payout
 * currency (0019 holds every charge to it); a refund subtracts. Sums are bigint, read as float8:
 * exact for minor units far beyond any partner's revenue.
 */
export const sumRevenue = async (tx: ScopedSql, partnerId: string, current: Window, previous: Window): Promise<RevenueSums> =>
  (
    await tx<RevenueSums[]>`
      with counted as (
        select charged_at, case when kind = 'refund' then -1 else 1 end as sign, payout_gross, fee_amount, partner_amount
        from merchant_charge
        where partner_id = ${partnerId}
          and (status in ('paid', 'recovered') or (kind = 'refund' and status = 'refunded'))
          and charged_at >= least(${current.from}::timestamptz, ${previous.from}::timestamptz) and charged_at < greatest(${current.to}::timestamptz, ${previous.to}::timestamptz)
      )
      select (select fee_currency from partner_contract where partner_id = ${partnerId}) as currency,
        coalesce(sum(sign * payout_gross) filter (where charged_at >= ${current.from} and charged_at < ${current.to}), 0)::float8 as collected,
        coalesce(sum(sign * fee_amount) filter (where charged_at >= ${current.from} and charged_at < ${current.to}), 0)::float8 as fee,
        coalesce(sum(sign * partner_amount) filter (where charged_at >= ${current.from} and charged_at < ${current.to}), 0)::float8 as payout,
        coalesce(sum(sign * payout_gross) filter (where charged_at >= ${previous.from} and charged_at < ${previous.to}), 0)::float8 as previous,
        (select min(scheduled_for)::text from partner_payout where partner_id = ${partnerId} and status = 'scheduled') as next_payout_at,
        (select count(*)::int from merchant_charge where partner_id = ${partnerId}) as charges
      from counted
    `
  )[0] ?? { currency: null, collected: 0, fee: 0, payout: 0, previous: 0, next_payout_at: null, charges: 0 }

export interface AttentionRow {
  kind: 'pastDue' | 'setupStuck' | 'domainStuck' | 'trialEnding'
  store_id: string
  store_name: string
  since: Date
  step: ProvisioningStep | null
  host: string | null
}

/** §5's four reasons, oldest first within each, at most `limit` rows. */
export const selectAttention = (tx: ScopedSql, partnerId: string, stuckAfterMinutes: Readonly<Record<ProvisioningStep, number>>, now: Date, trialDays: number, limit: number): Promise<AttentionRow[]> =>
  tx<AttentionRow[]>`
    select * from (
      select 'pastDue' as kind, s.id as store_id, s.name as store_name, s.past_due_since as since, null as step, null as host, 1 as rank
      from store s where s.partner_id = ${partnerId} and s.status = 'past_due' and s.past_due_since is not null
      union all
      select 'setupStuck', s.id, s.name, j.step_started_at, j.step, null, 2
      from store s join lateral (select * from job where store_id = s.id order by started_at desc limit 1) j on true
      where s.partner_id = ${partnerId} and s.status not in ('cancelled', 'closed') and ${stuckJobPredicate(tx, stuckAfterMinutes, now)}
      union all
      select 'domainStuck', s.id, s.name, d.created_at, null, d.host, 3
      from store s join lateral (select * from custom_domain where store_id = s.id order by created_at desc limit 1) d on true
      where s.partner_id = ${partnerId} and s.status not in ('cancelled', 'closed') and d.status = 'waiting' and d.created_at < ${now}::timestamptz - interval '1 day'
      union all
      select 'trialEnding', s.id, s.name, s.trial_ends_at, null, null, 4
      from store s where s.partner_id = ${partnerId} and s.status = 'trial'
        and s.trial_ends_at >= ${now} and s.trial_ends_at < ${now}::timestamptz + make_interval(days => ${trialDays})
    ) a
    order by rank, since, store_name, store_id
    limit ${limit}
  `

export interface SignupSums {
  started: number
  completed: number
  ended: number
  converted: number
  previous_ended: number
  previous_converted: number
}

/**
 * Stores created in the window (the Stores list's `created` filter), those whose setup finished,
 * and the trials that ended in it and in the window compared with, and how many became paid.
 */
export const sumSignups = async (tx: ScopedSql, partnerId: string, current: Window, previous: Window): Promise<SignupSums> =>
  (
    await tx<SignupSums[]>`
      select
        count(*) filter (where s.created_at >= ${current.from} and s.created_at < ${current.to})::int as started,
        count(*) filter (where s.created_at >= ${current.from} and s.created_at < ${current.to} and (j.id is null or j.state = 'done'))::int as completed,
        count(*) filter (where s.status <> 'trial' and s.trial_ends_at >= ${current.from} and s.trial_ends_at < ${current.to})::int as ended,
        count(*) filter (where s.status in ('active', 'past_due', 'suspended') and s.trial_ends_at >= ${current.from} and s.trial_ends_at < ${current.to})::int as converted,
        count(*) filter (where s.status <> 'trial' and s.trial_ends_at >= ${previous.from} and s.trial_ends_at < ${previous.to})::int as previous_ended,
        count(*) filter (where s.status in ('active', 'past_due', 'suspended') and s.trial_ends_at >= ${previous.from} and s.trial_ends_at < ${previous.to})::int as previous_converted
      from store s left join lateral (select id, state from job where store_id = s.id order by started_at desc limit 1) j on true
      where s.partner_id = ${partnerId}
    `
  )[0] ?? { started: 0, completed: 0, ended: 0, converted: 0, previous_ended: 0, previous_converted: 0 }

export interface TopStoreRow {
  store_id: string
  store_name: string
  plan_name: string | null
  currency: string
  amount: number
}

export const selectTopStores = (tx: ScopedSql, partnerId: string, month: Date, limit: number): Promise<TopStoreRow[]> =>
  tx<TopStoreRow[]>`
    select m.store_id, s.name as store_name, p.name as plan_name, m.currency, m.amount::float8 as amount
    from store_sales_month m join store s on s.id = m.store_id left join plan p on p.id = s.plan_id
    where m.partner_id = ${partnerId} and m.month = ${month}::date and m.amount > 0
    order by m.payout_amount desc, s.name
    limit ${limit}
  `

export const selectBillingFeed = async (tx: ScopedSql, partnerId: string): Promise<{ synced_at: Date; stale_since: Date | null } | null> =>
  (await tx<{ synced_at: Date; stale_since: Date | null }[]>`select synced_at, stale_since from partner_billing_feed where partner_id = ${partnerId}`)[0] ?? null

export interface NewCharge {
  partnerId: string
  storeId: string
  kind: 'subscription' | 'proration' | 'refund'
  status: 'paid' | 'failed' | 'refunded' | 'recovered'
  amount: number
  currency: string
  payoutCurrency: string
  payoutGross: number
  fee: number
  cardLast4: string | null
  failureReason: string | null
  chargedAt: Date
}

/** Stripe Connect's sync writes these (THIRD-PARTY-ACCESS §2.7); the seed does until then. */
export const insertCharge = async (tx: ScopedSql, c: NewCharge): Promise<void> => {
  await tx`
    insert into merchant_charge (partner_id, store_id, kind, status, amount, currency, payout_currency, payout_gross, fee_amount, partner_amount, card_last4, failure_reason, charged_at)
    values (${c.partnerId}, ${c.storeId}, ${c.kind}, ${c.status}, ${c.amount}, ${c.currency}, ${c.payoutCurrency}, ${c.payoutGross}, ${c.fee}, ${c.payoutGross - c.fee}, ${c.cardLast4}, ${c.failureReason}, ${c.chargedAt})
  `
}

export interface NewPayout {
  partnerId: string
  periodStart: Date
  periodEnd: Date
  currency: string
  gross: number
  fee: number
  adjustments: number
  adjustmentNote: string | null
  stores: number
  status: 'scheduled' | 'paid'
  scheduledFor: Date
  paidAt: Date | null
}

export const insertPayout = async (tx: ScopedSql, p: NewPayout): Promise<void> => {
  await tx`
    insert into partner_payout (partner_id, period_start, period_end, currency, gross, fee, adjustments, amount, stores, status, scheduled_for, paid_at, adjustment_note)
    values (${p.partnerId}, ${p.periodStart}, ${p.periodEnd}, ${p.currency}, ${p.gross}, ${p.fee}, ${p.adjustments}, ${p.gross - p.fee + p.adjustments}, ${p.stores}, ${p.status}, ${p.scheduledFor}, ${p.paidAt}, ${p.adjustmentNote})
  `
}

export const insertSalesMonth = async (
  tx: ScopedSql,
  s: { storeId: string; partnerId: string; month: Date; currency: string; amount: number; payoutCurrency: string; payoutAmount: number; orders: number },
): Promise<void> => {
  await tx`
    insert into store_sales_month (store_id, partner_id, month, currency, amount, payout_currency, payout_amount, orders)
    values (${s.storeId}, ${s.partnerId}, ${s.month}, ${s.currency}, ${s.amount}, ${s.payoutCurrency}, ${s.payoutAmount}, ${s.orders})
  `
}

export const setBillingFeed = async (tx: ScopedSql, partnerId: string, syncedAt: Date, staleSince: Date | null): Promise<void> => {
  await tx`
    insert into partner_billing_feed (partner_id, synced_at, stale_since) values (${partnerId}, ${syncedAt}, ${staleSince})
    on conflict (partner_id) do update set synced_at = excluded.synced_at, stale_since = excluded.stale_since
  `
}
