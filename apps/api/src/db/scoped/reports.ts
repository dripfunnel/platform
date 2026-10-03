import type { ProvisioningStep } from '../schema/saas'
import type { ScopedSql } from './index'
import { stuckJobPredicate } from './stores'

// The partner's Reports (ui/platform/FIRST-RELEASE.md §10): account-level totals only (LOGGING §6);
// tests/platform-reports.test.ts holds this file to its list of tables.

export interface ReportScope {
  partnerId: string
  planId?: string | undefined
  country?: string | undefined
}

// Every query names its store `s`.
const storeWhere = (tx: ScopedSql, s: ReportScope) => tx`
  s.partner_id = ${s.partnerId}
  ${s.planId ? tx`and s.plan_id = ${s.planId}` : tx``}
  ${s.country ? tx`and s.country = ${s.country}` : tx``}
`

export interface GrowthMonth {
  month: Date
  signups: number
  new_stores: number
  ended: number
  converted: number
  churned: number
  net: number
}

/** Per month from `from` (a month start) to `to` (exclusive): signups, finished setups, trials ended and converted, churn, stores at month end. */
export const selectGrowth = (tx: ScopedSql, s: ReportScope, from: Date, to: Date): Promise<GrowthMonth[]> =>
  tx<GrowthMonth[]>`
    select m.month,
      count(st.id) filter (where st.created_at >= m.month and st.created_at < m.next)::int as signups,
      count(st.id) filter (where st.created_at >= m.month and st.created_at < m.next and (j.id is null or j.state = 'done'))::int as new_stores,
      count(st.id) filter (where st.status <> 'trial' and st.trial_ends_at >= m.month and st.trial_ends_at < m.next)::int as ended,
      count(st.id) filter (where st.status in ('active', 'past_due', 'suspended') and st.trial_ends_at >= m.month and st.trial_ends_at < m.next)::int as converted,
      count(st.id) filter (where st.cancelled_at >= m.month and st.cancelled_at < m.next)::int as churned,
      count(st.id) filter (where st.created_at < m.next and (st.cancelled_at is null or st.cancelled_at >= m.next))::int as net
    from (select g as month, g + interval '1 month' as next from generate_series(${from}::timestamptz, ${to}::timestamptz - interval '1 month', interval '1 month') g) m
    left join (
      select s.* from store s where ${storeWhere(tx, s)}
    ) st on true
    left join lateral (select id, state from job where store_id = st.id order by started_at desc limit 1) j on true
    group by m.month order by m.month
  `

export interface RevenueMonth {
  month: Date
  collected: string
  fee: string
  payout: string
}

/** What was collected per month in the partner's payout currency; a refund subtracts (as the Dashboard). Sums as text, read exactly. */
export const selectRevenue = (tx: ScopedSql, s: ReportScope, from: Date, to: Date): Promise<RevenueMonth[]> =>
  tx<RevenueMonth[]>`
    select m.month,
      coalesce(sum(c.sign * c.payout_gross), 0)::text as collected,
      coalesce(sum(c.sign * c.fee_amount), 0)::text as fee,
      coalesce(sum(c.sign * c.partner_amount), 0)::text as payout
    from generate_series(${from}::timestamptz, ${to}::timestamptz - interval '1 month', interval '1 month') m(month)
    left join (
      select ch.charged_at, case when ch.kind = 'refund' then -1 else 1 end as sign, ch.payout_gross, ch.fee_amount, ch.partner_amount
      from merchant_charge ch join store s on s.id = ch.store_id
      where ${storeWhere(tx, s)} and (ch.status in ('paid', 'recovered') or (ch.kind = 'refund' and ch.status = 'refunded'))
    ) c on c.charged_at >= m.month and c.charged_at < m.month + interval '1 month'
    group by m.month order by m.month
  `

export const selectPaymentOutcomes = async (tx: ScopedSql, s: ReportScope, from: Date, to: Date): Promise<{ failed: number; recovered: number }> =>
  (
    await tx<{ failed: number; recovered: number }[]>`
      select count(*) filter (where ch.status = 'failed')::int as failed, count(*) filter (where ch.status = 'recovered')::int as recovered
      from merchant_charge ch join store s on s.id = ch.store_id
      where ${storeWhere(tx, s)} and ch.charged_at >= ${from} and ch.charged_at < ${to}
    `
  )[0] ?? { failed: 0, recovered: 0 }

export interface MrrRow {
  plan_id: string
  plan: string
  currency: string
  amount: string
}

/** Each plan's monthly subscription total per currency, trials and cancelled excluded; a year counts a twelfth. */
export const selectMrr = (tx: ScopedSql, s: ReportScope): Promise<MrrRow[]> =>
  tx<MrrRow[]>`
    select p.id as plan_id, p.name as plan, x.currency,
      sum(case when x.interval = 'year' then round(x.amount / 12.0) else x.amount end)::bigint::text as amount
    from store_subscription x join store s on s.id = x.store_id join plan p on p.id = x.plan_id
    where ${storeWhere(tx, s)} and x.status in ('active', 'past_due')
    group by p.id, p.name, x.currency order by p.name, x.currency
  `

export const selectStoresPerPlan = (tx: ScopedSql, s: ReportScope): Promise<{ plan_id: string | null; plan: string | null; stores: number }[]> =>
  tx<{ plan_id: string | null; plan: string | null; stores: number }[]>`
    select p.id as plan_id, p.name as plan, count(*)::int as stores
    from store s left join plan p on p.id = s.plan_id
    where ${storeWhere(tx, s)} and s.status not in ('cancelled', 'closed')
    group by p.id, p.name order by stores desc, p.name
  `

/** Plan changes made in the window, from the log's own entries (#160: `store.plan_changed`, before and after plan ids). */
export const selectPlanChanges = (tx: ScopedSql, s: ReportScope, from: Date, to: Date): Promise<{ from_plan: string; to_plan: string; from_name: string | null; to_name: string | null; changes: number }[]> =>
  tx<{ from_plan: string; to_plan: string; from_name: string | null; to_name: string | null; changes: number }[]>`
    select x.from_plan, x.to_plan, pf.name as from_name, pt.name as to_name, x.changes from (
    select c->>'before' as from_plan, c->>'after' as to_plan, count(*)::int as changes
    from activity_log a cross join lateral jsonb_array_elements(a.changes) c
    join store s on s.id = a.store_id
    where a.partner_id = ${s.partnerId} and a.action = 'store.plan_changed' and a.result = 'success'
      and a.occurred_at >= ${from} and a.occurred_at < ${to} and c->>'field' = 'plan' and ${storeWhere(tx, s)}
      -- A store given its first plan, or losing it, is not a change between plans.
      and c->>'before' is not null and c->>'after' is not null
    group by 1, 2
    ) x
    -- A plan nobody is on any more still has its name.
    left join plan pf on pf.id::text = x.from_plan left join plan pt on pt.id::text = x.to_plan
    order by x.changes desc
  `

export interface StoreSalesRow {
  store_id: string
  store_name: string
  plan: string | null
  currency: string
  amount: string
  payout_amount: string
  orders: number
  previous: string | null
}

/** Each store's sales last month beside the month before, totals only (store_sales_month). */
export const selectStoreSales = (tx: ScopedSql, s: ReportScope, month: Date, before: Date, limit: number): Promise<StoreSalesRow[]> =>
  tx<StoreSalesRow[]>`
    select s.id as store_id, s.name as store_name, p.name as plan, m.currency, m.amount::text, m.payout_amount::text, m.orders, b.amount::text as previous
    from store_sales_month m join store s on s.id = m.store_id left join plan p on p.id = s.plan_id
    left join store_sales_month b on b.store_id = m.store_id and b.month = ${before}::date
    where ${storeWhere(tx, s)} and m.month = ${month}::date
    order by m.payout_amount desc, s.name
    limit ${limit}
  `

export const sumMeters = async (tx: ScopedSql, s: ReportScope, month: string): Promise<{ ai_prompts: number; publish_now: number }> =>
  (
    await tx<{ ai_prompts: number; publish_now: number }[]>`
      select coalesce(sum(u.used) filter (where u.key = 'ai_prompts'), 0)::int as ai_prompts,
        coalesce(sum(u.used) filter (where u.key = 'publish_now'), 0)::int as publish_now
      from store_usage u join store s on s.id = u.store_id
      where ${storeWhere(tx, s)} and u.period_start = ${month}::date
    `
  )[0] ?? { ai_prompts: 0, publish_now: 0 }

export interface SetupHealth {
  median_seconds: number | null
  failed: number
}

export const selectSetupHealth = async (tx: ScopedSql, s: ReportScope, since: Date): Promise<SetupHealth> =>
  (
    await tx<SetupHealth[]>`
      select percentile_cont(0.5) within group (order by extract(epoch from (j.finished_at - j.started_at)))
          filter (where j.state = 'done' and j.finished_at >= ${since}) as median_seconds,
        count(*) filter (where j.state = 'failed' and coalesce(j.finished_at, j.step_started_at) >= ${since})::int as failed
      from job j join store s on s.id = j.store_id
      where ${storeWhere(tx, s)} and j.kind = 'provision-store'
    `
  )[0] ?? { median_seconds: null, failed: 0 }

export interface SetupProblem {
  kind: 'stuck' | 'failed' | 'domain'
  store_id: string
  store_name: string
  detail: string | null
  since: Date
}

/** The stores concerned: setups stuck or failed now, and custom domains waiting for DNS over a day. */
export const selectSetupProblems = (tx: ScopedSql, s: ReportScope, stuckAfterMinutes: Readonly<Record<ProvisioningStep, number>>, now: Date, limit: number): Promise<SetupProblem[]> =>
  tx<SetupProblem[]>`
    select * from (
      select case when j.state = 'failed' then 'failed' else 'stuck' end as kind, s.id as store_id, s.name as store_name, j.step as detail, j.step_started_at as since
      from store s join lateral (select * from job where store_id = s.id order by started_at desc limit 1) j on true
      where ${storeWhere(tx, s)} and s.status not in ('cancelled', 'closed') and (j.state = 'failed' or ${stuckJobPredicate(tx, stuckAfterMinutes, now)})
      union all
      select 'domain', s.id, s.name, d.host, d.created_at
      from store s join lateral (select * from custom_domain where store_id = s.id order by created_at desc limit 1) d on true
      where ${storeWhere(tx, s)} and s.status not in ('cancelled', 'closed') and d.status = 'waiting' and d.created_at < ${now}::timestamptz - interval '1 day'
    ) p order by kind, since limit ${limit}
  `

/** How many setups are stuck or failed and how many custom domains wait over a day, uncapped. */
export const countSetupProblems = async (tx: ScopedSql, s: ReportScope, stuckAfterMinutes: Readonly<Record<ProvisioningStep, number>>, now: Date): Promise<{ stuck: number; failed_now: number; domains: number }> =>
  (
    await tx<{ stuck: number; failed_now: number; domains: number }[]>`
      select
        (select count(*)::int from store s join lateral (select * from job where store_id = s.id order by started_at desc limit 1) j on true
          where ${storeWhere(tx, s)} and s.status not in ('cancelled', 'closed') and j.state <> 'failed' and ${stuckJobPredicate(tx, stuckAfterMinutes, now)}) as stuck,
        (select count(*)::int from store s join lateral (select * from job where store_id = s.id order by started_at desc limit 1) j on true
          where ${storeWhere(tx, s)} and s.status not in ('cancelled', 'closed') and j.state = 'failed') as failed_now,
        (select count(*)::int from store s join lateral (select * from custom_domain where store_id = s.id order by created_at desc limit 1) d on true
          where ${storeWhere(tx, s)} and s.status not in ('cancelled', 'closed') and d.status = 'waiting' and d.created_at < ${now}::timestamptz - interval '1 day') as domains
    `
  )[0] ?? { stuck: 0, failed_now: 0, domains: 0 }

/** Stores that sold more than `decline` less than the month before, a month without sales counting as nothing. */
export const countDecliningStores = async (tx: ScopedSql, s: ReportScope, month: Date, before: Date, decline: number): Promise<number> =>
  (
    await tx<{ n: number }[]>`
      select count(*)::int as n
      from store_sales_month b join store s on s.id = b.store_id
      left join store_sales_month m on m.store_id = b.store_id and m.month = ${month}::date
      where ${storeWhere(tx, s)} and b.month = ${before}::date and b.amount > 0 and coalesce(m.amount, 0) < b.amount * ${decline}::numeric
    `
  )[0]?.n ?? 0

/** The stores `countDecliningStores` counts, the biggest fall first, `limit` at most. */
export const selectDecliningStores = (tx: ScopedSql, s: ReportScope, month: Date, before: Date, decline: number, limit: number): Promise<StoreSalesRow[]> =>
  tx<StoreSalesRow[]>`
    select s.id as store_id, s.name as store_name, p.name as plan, b.currency, coalesce(m.amount, 0)::text as amount,
      coalesce(m.payout_amount, 0)::text as payout_amount, coalesce(m.orders, 0)::int as orders, b.amount::text as previous
    from store_sales_month b join store s on s.id = b.store_id left join plan p on p.id = s.plan_id
    left join store_sales_month m on m.store_id = b.store_id and m.month = ${month}::date
    where ${storeWhere(tx, s)} and b.month = ${before}::date and b.amount > 0 and coalesce(m.amount, 0) < b.amount * ${decline}::numeric
    order by coalesce(m.amount, 0)::numeric / b.amount, s.name
    limit ${limit}
  `
