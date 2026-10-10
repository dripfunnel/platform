import type postgres from 'postgres'
import type { TenantContext } from '#core/tenancy'
import { withScope, type ScopedSql } from '#db/scoped/index'
import {
  selectByMarket,
  selectReportCurrencies,
  selectReportRange,
  selectSold,
  selectSupplierUnits,
  selectTakings,
  selectTax,
  selectTopOffers,
  type MarketRow,
  type OfferRow,
  type ReportWindow,
  type SoldRow,
  type SupplierUnitsRow,
  type TakingsRow,
  type TaxRow,
} from '#db/scoped/storeReports'

// Reports (FIRST-RELEASE §10, PortalReports): 7, 30 or 90 of the store's days against as many before, one currency at a
// time. The merchant side's only (`reports.read`, Owner and Manager); the plan gates are the API's (saas/entitlements).

export const reportRanges = [7, 30, 90] as const
export type ReportDays = (typeof reportRanges)[number]
export const isReportDays = (value: number): value is ReportDays => (reportRanges as readonly number[]).includes(value)

export interface ReportView {
  days: ReportDays
  timeZone: string
  from: Date
  to: Date
  previousFrom: Date
  /** Null only for a store with no pricing currency that sold nothing: every panel is then empty. */
  currency: string | null
  /** Every currency sold in over the range, for the screen's switch. */
  currencies: string[]
  /** India's tax goes by rate, a US store's by state (FIRST-RELEASE §10). */
  taxBy: 'state' | 'rate'
}

export type ReportResult = { ok: true; value: ReportView } | { ok: false; reason: 'INVALID_INPUT' }

export interface ReportsDeps {
  sql: postgres.Sql
  context: TenantContext
  now: () => Date
}

export const createReportsService = ({ sql, context, now }: ReportsDeps) => {
  const { storeId } = context
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)

  /** The range and currency every panel reads; the pricing currency unless another is asked for. */
  const open = async (days: number, currency: string | null): Promise<ReportResult> => {
    if (!isReportDays(days) || (currency !== null && !/^[A-Z]{3}$/.test(currency))) return { ok: false, reason: 'INVALID_INPUT' }
    return inScope(async (tx): Promise<ReportResult> => {
      const range = await selectReportRange(tx, storeId, now(), days)
      if (!range) return { ok: false, reason: 'INVALID_INPUT' }
      const currencies = await selectReportCurrencies(tx, storeId, range.from, range.to)
      return {
        ok: true,
        value: {
          days,
          timeZone: range.time_zone,
          from: range.from,
          to: range.to,
          previousFrom: range.previous_from,
          currency: currency ?? range.pricing_currency ?? currencies[0] ?? null,
          currencies,
          taxBy: range.country === 'US' ? 'state' : 'rate',
        },
      }
    })
  }

  const panel = <T>(r: ReportView, none: T, read: (tx: ScopedSql, w: ReportWindow) => Promise<T>): Promise<T> => {
    const { currency } = r
    return currency === null ? Promise.resolve(none) : inScope((tx) => read(tx, { storeId, currency, from: r.from, to: r.to }))
  }

  return {
    open,
    takings: (r: ReportView): Promise<TakingsRow | null> => panel<TakingsRow | null>(r, null, (tx, w) => selectTakings(tx, w, r.previousFrom)),
    sold: (r: ReportView, limit: number): Promise<SoldRow[]> => panel(r, [], (tx, w) => selectSold(tx, w, limit)),
    markets: (r: ReportView, limit: number): Promise<MarketRow[]> => panel(r, [], (tx, w) => selectByMarket(tx, w, limit)),
    tax: (r: ReportView): Promise<{ total: string; rows: TaxRow[] } | null> => panel<{ total: string; rows: TaxRow[] } | null>(r, null, (tx, w) => selectTax(tx, w, r.taxBy)),
    suppliers: (r: ReportView): Promise<SupplierUnitsRow[]> => panel(r, [], selectSupplierUnits),
    offers: (r: ReportView, limit: number): Promise<OfferRow[]> => panel(r, [], (tx, w) => selectTopOffers(tx, w, limit)),
  }
}
