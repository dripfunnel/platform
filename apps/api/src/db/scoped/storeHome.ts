import { lowStock } from './catalog'
import type { ScopedSql } from './index'
import { goneThrough, merchantFilter } from './storeOrders'

// Home (FIRST-RELEASE §5, PortalHome), read on the merchant side in the store's scope. A day is the store's own
// (store.time_zone), its bounds UTC instants; a sale is a placed order whose money was taken, as Customers' "spent" is.

export interface StoreDays {
  time_zone: string
  pricing_currency: string | null
  /** Midnight in the store's zone: today, yesterday, the day before, and six days before today (seven days with today). */
  today: Date
  yesterday: Date
  day_before: Date
  week: Date
}

export const selectStoreDays = async (tx: ScopedSql, storeId: string, now: Date): Promise<StoreDays | null> =>
  (
    await tx<StoreDays[]>`
      select s.time_zone, s.pricing_currency, d.day at time zone s.time_zone as today, (d.day - interval '1 day') at time zone s.time_zone as yesterday,
        (d.day - interval '2 days') at time zone s.time_zone as day_before, (d.day - interval '6 days') at time zone s.time_zone as week
      from store s cross join lateral (select date_trunc('day', ${now}::timestamptz at time zone s.time_zone) as day) d
      where s.id = ${storeId}
    `
  )[0] ?? null

export const sale = (tx: ScopedSql) => tx`o.state = 'placed' and o.payment_state in ('paid', 'partly_refunded', 'refunded') and ${goneThrough(tx)}`

export interface DayFiguresRow {
  currency: string
  /** Money taken less what went back, minor units as text. */
  sales_yesterday: string
  sales_day_before: string
  /** The average sale over the seven days, rounded to a minor unit; null with none. */
  average_week: string | null
  orders_today: number
  orders_yesterday: number
}

/** A row a currency the store sold in this week; the orders counted are those that went through, paid or to be paid by cash or transfer. */
export const selectDayFigures = (tx: ScopedSql, storeId: string, days: StoreDays): Promise<DayFiguresRow[]> =>
  tx<DayFiguresRow[]>`
    select o.currency,
      coalesce(sum(o.total_amount - o.refunded_amount) filter (where ${sale(tx)} and o.placed_at >= ${days.yesterday} and o.placed_at < ${days.today}), 0)::text as sales_yesterday,
      coalesce(sum(o.total_amount - o.refunded_amount) filter (where ${sale(tx)} and o.placed_at >= ${days.day_before} and o.placed_at < ${days.yesterday}), 0)::text as sales_day_before,
      round(avg(o.total_amount - o.refunded_amount) filter (where ${sale(tx)}))::bigint::text as average_week,
      count(*) filter (where o.state = 'placed' and ${goneThrough(tx)} and o.placed_at >= ${days.today})::int as orders_today,
      count(*) filter (where o.state = 'placed' and ${goneThrough(tx)} and o.placed_at >= ${days.yesterday} and o.placed_at < ${days.today})::int as orders_yesterday
    from "order" o
    where o.store_id = ${storeId} and o.state <> 'cart' and o.placed_at >= ${days.week}
    group by o.currency
  `

/** Shoppers with more than one order that went through: an account's own, else a guest's email, else its number. */
export const countReturningCustomers = async (tx: ScopedSql, storeId: string): Promise<number> =>
  (
    await tx<{ n: number }[]>`
      select count(*)::int as n from (
        select coalesce(o.customer_id::text, lower(o.email), o.phone) as who from "order" o
        where o.store_id = ${storeId} and o.state = 'placed' and ${goneThrough(tx)}
        group by 1 having count(*) > 1
      ) x where who is not null
    `
  )[0]?.n ?? 0

export interface OrderTasksRow {
  to_ship: number
  partly_shipped: number
  oldest_to_ship: Date | null
  /** Cash on delivery and bank transfers waiting to be marked paid. */
  to_collect: number
  first_to_collect: string | null
  /** Whether the store has any order at all, a test one included: a new store sees the checklist instead. */
  any_order: boolean
}

export const selectOrderTasks = async (tx: ScopedSql, storeId: string): Promise<OrderTasksRow> => {
  const collect = tx`o.state = 'placed' and o.payment_state = 'pending' and o.payment_method in ('cod', 'bank_transfer')`
  const [row] = await tx<OrderTasksRow[]>`
    select count(*) filter (where ${merchantFilter(tx, 'to_ship')})::int as to_ship,
      count(*) filter (where ${merchantFilter(tx, 'to_ship')} and o.fulfilment_state = 'partly_fulfilled')::int as partly_shipped,
      min(o.placed_at) filter (where ${merchantFilter(tx, 'to_ship')}) as oldest_to_ship,
      count(*) filter (where ${collect})::int as to_collect,
      (array_agg(o.id order by o.placed_at, o.id) filter (where ${collect}))[1] as first_to_collect,
      count(*) > 0 as any_order
    from "order" o where o.store_id = ${storeId} and o.state <> 'cart'
  `
  return row ?? { to_ship: 0, partly_shipped: 0, oldest_to_ship: null, to_collect: 0, first_to_collect: null, any_order: false }
}

export interface LowStockRow {
  count: number
  /** The first few by name, for "Kurta, Dupatta, Saree…". */
  names: string[]
}

export const selectLowStock = async (tx: ScopedSql, storeId: string, names: number): Promise<LowStockRow> => {
  const [row] = await tx<LowStockRow[]>`
    select (select count(*)::int from product p where p.store_id = ${storeId} and p.deleted_at is null and not p.is_sample and ${lowStock(tx, 'p')}) as count,
      coalesce((select json_agg(x.name order by x.name, x.id) from (
        select p.name, p.id from product p where p.store_id = ${storeId} and p.deleted_at is null and not p.is_sample and ${lowStock(tx, 'p')}
        order by p.name, p.id limit ${names}
      ) x), '[]'::json) as names
  `
  return row ?? { count: 0, names: [] }
}

/** Couriers in use whose account's login the last test refused (SetOps Shipping's "stopped working"). */
export const selectRejectedCouriers = async (tx: ScopedSql, storeId: string): Promise<string[]> =>
  (await tx<{ provider: string }[]>`select provider from store_courier where store_id = ${storeId} and role <> 'off' and last_test_result = 'rejected' order by position, provider`).map((r) => r.provider)

export interface SetupRow {
  products: boolean
  collections: boolean
  payments: boolean
  shipping: boolean
}

/** The getting-started checklist's facts (PortalHome "Get your shop ready"). */
export const selectSetup = async (tx: ScopedSql, storeId: string): Promise<SetupRow> => {
  const [row] = await tx<SetupRow[]>`
    select exists (select 1 from product where store_id = ${storeId} and deleted_at is null and not is_sample) as products,
      exists (select 1 from collection where store_id = ${storeId} and deleted_at is null) as collections,
      exists (select 1 from payment_provider_account where store_id = ${storeId} and status = 'live' and not paused_by_plan) as payments,
      exists (select 1 from store_shipping where store_id = ${storeId} and saved_at is not null) as shipping
  `
  return row ?? { products: false, collections: false, payments: false, shipping: false }
}
