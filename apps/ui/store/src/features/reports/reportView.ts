import type { ApiMoney } from '../../api/orders'
import type { ReportDays, ReportPanel, ReportSuppliers, StoreReport } from '../../api/reports'
import { fill, formatCount, locale, messages, plural } from '../../messages'
import { moneyText } from '../orders/orderView'

// How PortalReports words the API's `report` (FIRST-RELEASE §10): one card per panel. Every figure is the API's; the
// bars and the change against the period before only compare two of them.

const words = messages.reports

export interface PanelRow {
  key: string
  label: string
  value: string
  refund?: boolean
  /** Its share of the panel's top row, for the bar. */
  bar?: number
}

export interface PanelView {
  key: Exclude<ReportPanel, 'custom'>
  title: string
  big: string | null
  delta: { text: string; tone: 'up' | 'down' | 'muted' } | null
  rows: PanelRow[]
  none: string | null
  note: string
}

export type SuppliersView = { kind: 'loading' } | { kind: 'hidden' } | { kind: 'ready'; rows: ReportSuppliers } | { kind: 'locked'; plan: string | null }

const noneFor = (days: ReportDays) => fill(days < 90 ? words.none : words.noneLongest, { days: String(days) })

const bars = <T>(rows: readonly T[], amount: (row: T) => ApiMoney): number[] => {
  const top = Math.max(...rows.map((r) => Number(amount(r).amount)), 0)
  return rows.map((r) => (top > 0 ? Math.round((Number(amount(r).amount) / top) * 100) : 0))
}

const percent = (bps: number) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(bps / 10_000)
const countryName = (code: string) => new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code

export const ordersOf = (report: StoreReport): number => report.takings?.orders ?? 0

const takingsPanel = (report: StoreReport, days: ReportDays): PanelView => {
  const t = report.takings
  const w = words.takings
  if (!t) return { key: 'takings', title: w.title, big: null, delta: null, rows: [], none: noneFor(days), note: w.note }
  const before = Number(t.previousNet.amount)
  const pct = before === 0 ? null : Math.round(((Number(t.net.amount) - before) / Math.abs(before)) * 100)
  return {
    key: 'takings',
    title: w.title,
    big: moneyText(t.net),
    delta: pct === null ? { text: w.nothingBefore, tone: 'muted' } : { text: fill(pct >= 0 ? w.up : w.down, { pct: formatCount(Math.abs(pct)), days: String(days) }), tone: pct >= 0 ? 'up' : 'down' },
    rows: [
      { key: 'sales', label: w.sales, value: moneyText(t.sales) },
      { key: 'refunds', label: w.refunds, value: fill(w.refunded, { amount: moneyText(t.refunds) }), refund: true },
      { key: 'net', label: w.net, value: moneyText(t.net) },
    ],
    none: null,
    note: w.note,
  }
}

const taxPanel = (report: StoreReport, days: ReportDays): PanelView => {
  const w = words.tax
  const tax = report.tax
  const byState = tax ? tax.by === 'state' : report.country === 'US'
  const title = byState ? w.titleState : report.country === 'IN' ? w.titleGst : w.titleRate
  if (!tax) return { key: 'tax', title, big: null, delta: null, rows: [], none: noneFor(days), note: w.note }
  const keyText = (key: string | null) => (key === null ? (byState ? w.noState : w.delivery) : byState ? key : percent(Number(key)))
  return {
    key: 'tax',
    title,
    big: byState ? w.byState : moneyText(tax.total),
    delta: byState ? { text: w.stateNote, tone: 'muted' } : report.country ? { text: fill(w.forShoppers, { country: countryName(report.country) }), tone: 'muted' } : null,
    rows: tax.rows.map((r) => ({ key: r.key ?? 'none', label: keyText(r.key), value: moneyText(r.amount) })),
    none: null,
    note: w.note,
  }
}

const ranked = <T>(key: 'sold' | 'markets' | 'offers', title: string, note: string, rows: readonly T[], none: string, row: (r: T, i: number) => Omit<PanelRow, 'bar'>, amount: (r: T) => ApiMoney): PanelView => {
  const widths = bars(rows, amount)
  return { key, title, big: null, delta: null, rows: rows.map((r, i) => ({ ...row(r, i), bar: widths[i] ?? 0 })), none: rows.length === 0 ? none : null, note }
}

const suppliersPanel = (view: SuppliersView, days: ReportDays): PanelView | null => {
  const w = words.suppliers
  if (view.kind === 'locked') return { key: 'suppliers', title: w.title, big: null, delta: null, rows: [], none: fill(w.locked, { plan: view.plan ?? words.locked.somePlan }), note: w.note }
  // A store whose sales are all its own has no supplier split to show.
  if (view.kind !== 'ready' || !view.rows.some((r) => r.supplierId !== null)) return null
  const rows = view.rows.map((r) => ({ key: r.supplierId ?? 'own', label: r.supplierId === null ? w.own : (r.name ?? w.own), value: fill(plural(w.units, r.units), { count: formatCount(r.units) }) }))
  return { key: 'suppliers', title: w.title, big: null, delta: null, rows, none: rows.length === 0 ? noneFor(days) : null, note: w.note }
}

/** The prototype's cards in its order, then top offers (decided on #337), before the custom reports card. */
export const panelsOf = (report: StoreReport, days: ReportDays, suppliers: SuppliersView): PanelView[] => {
  const panels: (PanelView | null)[] = [
    takingsPanel(report, days),
    ranked('sold', words.sold.title, words.sold.note, report.sold, noneFor(days), (r) => ({ key: r.productId, label: fill(words.sold.row, { name: r.name, units: formatCount(r.units) }), value: moneyText(r.amount) }), (r) => r.amount),
    ranked('markets', words.markets.title, words.markets.note, report.markets, noneFor(days), (r, i) => ({ key: r.marketId ?? `outside-${i}`, label: r.name ?? words.markets.outside, value: moneyText(r.amount) }), (r) => r.amount),
    taxPanel(report, days),
    suppliersPanel(suppliers, days),
    ranked(
      'offers',
      words.offers.title,
      words.offers.note,
      report.offers,
      // Sales with no offer used aren't "no sales".
      report.takings ? fill(words.offers.none, { days: String(days) }) : noneFor(days),
      (r, i) => ({ key: `${r.name}-${i}`, label: [fill(words.offers.row, { name: r.name, orders: fill(plural(words.orders, r.orders), { count: formatCount(r.orders) }) }), fill(words.offers.off, { discount: moneyText(r.discount) })].join(' · '), value: moneyText(r.amount) }),
      (r) => r.amount,
    ),
  ]
  return panels.filter((p): p is PanelView => p !== null)
}
