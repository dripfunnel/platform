import type { ScopedSql } from './index'
import { sale } from './storeHome'

// Reports (FIRST-RELEASE §10, PortalReports), read on the merchant side in the store's scope: each panel over the sales
// (storeHome's) placed in a range of the store's own days, in one currency, never converted.

export interface ReportRange {
  time_zone: string
  pricing_currency: string | null
  country: string | null
  /** The first of the last `days` days in the store's zone, today included, to now; and the as many days before. */
  from: Date
  to: Date
  previous_from: Date
}

export const selectReportRange = async (tx: ScopedSql, storeId: string, now: Date, days: number): Promise<ReportRange | null> =>
  (
    await tx<ReportRange[]>`
      select s.time_zone, s.pricing_currency, s.country, (d.day - make_interval(days => ${days - 1})) at time zone s.time_zone as from, ${now}::timestamptz as to,
        (d.day - make_interval(days => ${2 * days - 1})) at time zone s.time_zone as previous_from
      from store s cross join lateral (select date_trunc('day', ${now}::timestamptz at time zone s.time_zone) as day) d
      where s.id = ${storeId}
    `
  )[0] ?? null

/** One currency's sales in [from, to): the filter every panel shares. */
export interface ReportWindow {
  storeId: string
  currency: string
  from: Date
  to: Date
}

const within = (tx: ScopedSql, w: ReportWindow) =>
  tx`o.store_id = ${w.storeId} and o.placed_at >= ${w.from} and o.placed_at < ${w.to} and o.currency = ${w.currency} and ${sale(tx)}`

/** The currencies the store sold in over the range, for the screen's switch. */
export const selectReportCurrencies = async (tx: ScopedSql, storeId: string, from: Date, to: Date): Promise<string[]> =>
  (
    await tx<{ currency: string }[]>`
      select distinct o.currency from "order" o
      where o.store_id = ${storeId} and o.state <> 'cart' and o.placed_at >= ${from} and o.placed_at < ${to} and ${sale(tx)} order by o.currency
    `
  ).map((r) => r.currency)

export interface TakingsRow {
  orders: number
  /** Minor units as text. */
  sales: string
  refunds: string
  previous_net: string
  previous_orders: number
}

export const selectTakings = async (tx: ScopedSql, w: ReportWindow, previousFrom: Date): Promise<TakingsRow> => {
  const previous = { ...w, from: previousFrom, to: w.from }
  const [row] = await tx<TakingsRow[]>`
    select (select count(*)::int from "order" o where ${within(tx, w)}) as orders,
      (select coalesce(sum(o.total_amount), 0)::text from "order" o where ${within(tx, w)}) as sales,
      (select coalesce(sum(o.refunded_amount), 0)::text from "order" o where ${within(tx, w)}) as refunds,
      (select coalesce(sum(o.total_amount - o.refunded_amount), 0)::text from "order" o where ${within(tx, previous)}) as previous_net,
      (select count(*)::int from "order" o where ${within(tx, previous)}) as previous_orders
  `
  return row ?? { orders: 0, sales: '0', refunds: '0', previous_net: '0', previous_orders: 0 }
}

export interface SoldRow {
  product_id: string
  /** The name it sold under most recently. */
  name: string
  units: number
  amount: string
}

/** Products by money taken on their lines, the most first. */
export const selectSold = (tx: ScopedSql, w: ReportWindow, limit: number): Promise<SoldRow[]> =>
  tx<SoldRow[]>`
    select l.product_id, (array_agg(l.name order by o.placed_at desc, l.id))[1] as name, sum(l.quantity)::int as units, sum(l.line_total_amount)::text as amount
    from "order" o join order_line l on l.order_id = o.id and l.store_id = o.store_id
    where ${within(tx, w)}
    group by l.product_id order by sum(l.line_total_amount) desc, l.product_id limit ${limit}
  `

export interface MarketRow {
  market_id: string | null
  name: string | null
  orders: number
  amount: string
}

/** Sales net of refunds by the market each shopper bought in; an order with none is the store's own (null). */
export const selectByMarket = (tx: ScopedSql, w: ReportWindow, limit: number): Promise<MarketRow[]> =>
  tx<MarketRow[]>`
    select o.market_id, m.name, count(*)::int as orders, sum(o.total_amount - o.refunded_amount)::text as amount
    from "order" o left join market m on m.id = o.market_id and m.store_id = o.store_id
    where ${within(tx, w)}
    group by o.market_id, m.name order by sum(o.total_amount - o.refunded_amount) desc, o.market_id nulls last limit ${limit}
  `

export interface TaxRow {
  /** A US state as the address has it, or an Indian rate in basis points as text; null for what no line carries. */
  key: string | null
  orders: number
  amount: string
}

/**
 * Tax as charged at checkout: by state for a US store (each order's delivery state), by rate otherwise (each line's
 * rate, then the order's tax its lines don't carry, delivery's, under a null key). Refunds don't change it. The rows
 * are the top ones by amount; the total is every order's.
 */
export const selectTax = async (tx: ScopedSql, w: ReportWindow, by: 'state' | 'rate', limit: number): Promise<{ total: string; rows: TaxRow[] }> => {
  const [total] = await tx<{ amount: string }[]>`select coalesce(sum(o.tax_amount), 0)::text as amount from "order" o where ${within(tx, w)}`
  const rows =
    by === 'state'
      ? await tx<TaxRow[]>`
          select upper(o.shipping_address ->> 'region') as key, count(*)::int as orders, sum(o.tax_amount)::text as amount
          from "order" o where ${within(tx, w)} and o.tax_amount > 0
          group by 1 order by sum(o.tax_amount) desc, 1 nulls last limit ${limit}
        `
      : await tx<TaxRow[]>`
          select x.key, count(distinct x.order_id)::int as orders, sum(x.amount)::text as amount from (
            select l.tax_rate_bps::text as key, l.order_id, l.tax_amount as amount
            from "order" o join order_line l on l.order_id = o.id and l.store_id = o.store_id where ${within(tx, w)} and l.tax_amount > 0
            union all
            select null, o.id, o.tax_amount - (select coalesce(sum(l.tax_amount), 0) from order_line l where l.order_id = o.id)
            from "order" o where ${within(tx, w)}
          ) x where x.amount > 0
          group by x.key order by x.key is null, sum(x.amount) desc, x.key limit ${limit}
        `
  return { total: total?.amount ?? '0', rows }
}

export interface SupplierUnitsRow {
  /** Null for the store's own products. */
  seller_id: string | null
  name: string | null
  units: number
}

/** Units sold per owner, never money: "Suppliers never see your totals" is the merchant's view of them. */
export const selectSupplierUnits = (tx: ScopedSql, w: ReportWindow, limit: number): Promise<SupplierUnitsRow[]> =>
  tx<SupplierUnitsRow[]>`
    select l.seller_id, s.name, sum(l.quantity)::int as units
    from "order" o join order_line l on l.order_id = o.id and l.store_id = o.store_id left join seller s on s.id = l.seller_id and s.store_id = l.store_id
    where ${within(tx, w)}
    group by l.seller_id, s.name order by l.seller_id is not null, sum(l.quantity) desc, s.name, l.seller_id limit ${limit}
  `

export interface OfferRow {
  /** The discount line's name at placement (OFFERS fact 13): the offer as shoppers saw it. */
  label: string
  orders: number
  discount: string
  /** The orders' sales, net of refunds. */
  amount: string
}

/** Offers by the discount they gave, the most first. */
export const selectTopOffers = (tx: ScopedSql, w: ReportWindow, limit: number): Promise<OfferRow[]> =>
  tx<OfferRow[]>`
    select x.label, count(*)::int as orders, sum(x.discount)::text as discount, sum(x.net)::text as amount from (
      select a.label, o.id, sum(a.amount) as discount, o.total_amount - o.refunded_amount as net
      from "order" o join order_adjustment a on a.order_id = o.id and a.store_id = o.store_id and a.kind = 'discount' and a.label is not null
      where ${within(tx, w)}
      group by a.label, o.id
    ) x
    group by x.label order by sum(x.discount) desc, x.label limit ${limit}
  `
