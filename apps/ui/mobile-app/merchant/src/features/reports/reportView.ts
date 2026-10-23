import type { ApiMoney } from '../../api/orders'
import type { ReportDays, ReportPanel, ReportSuppliers, StoreReport } from '../../api/reports'
import { formatNumber, formatMoney, regionName } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../messages'
import { tCount } from '../../messages/plural'

// How PortalReports words the API's `report` (FIRST-RELEASE (store) §10): one card per panel. Every figure is the API's; the bars and the
// change against the period before only compare two of them.

export type PanelRow = { key: string; label: string; value: string; refund?: boolean; /** Its share of the panel's top row, 0 to 100. */ bar?: number }
export type Delta = { text: string; tone: 'up' | 'down' | 'muted' }
export type PanelView = {
  key: ReportPanel
  title: string
  big: string | null
  delta: Delta | null
  rows: PanelRow[]
  none: string | null
  note: string
}

export type SuppliersView = { kind: 'loading' } | { kind: 'hidden' } | { kind: 'ready'; rows: ReportSuppliers } | { kind: 'locked'; plan: string | null }

const money = (amount: ApiMoney): string => formatMoney(amount, locale)

const noneFor = (days: ReportDays): string => t(days < 90 ? 'reports.none' : 'reports.noneLongest', { days })

const bars = <T>(rows: readonly T[], amount: (row: T) => ApiMoney): number[] => {
  const top = Math.max(...rows.map((row) => Number(amount(row).amount)), 0)
  return rows.map((row) => (top > 0 ? Math.round((Number(amount(row).amount) / top) * 100) : 0))
}

const percent = (basisPoints: number): string => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(basisPoints / 10_000)

export const ordersOf = (report: StoreReport): number => report.takings?.orders ?? 0

const takingsPanel = (report: StoreReport, days: ReportDays): PanelView => {
  const base = { key: 'takings', title: t('reports.takings.title'), note: t('reports.takings.note') } as const
  const takings = report.takings
  if (takings === null) return { ...base, big: null, delta: null, rows: [], none: noneFor(days) }
  const before = Number(takings.previousNet.amount)
  const change = before === 0 ? null : Math.round(((Number(takings.net.amount) - before) / Math.abs(before)) * 100)
  const delta: Delta =
    change === null ? { text: t('reports.takings.nothingBefore'), tone: 'muted' } : { text: t(change >= 0 ? 'reports.takings.up' : 'reports.takings.down', { pct: formatNumber(Math.abs(change), locale), days }), tone: change >= 0 ? 'up' : 'down' }
  return {
    ...base,
    big: money(takings.net),
    delta,
    rows: [
      { key: 'sales', label: t('reports.takings.sales'), value: money(takings.sales) },
      { key: 'refunds', label: t('reports.takings.refunds'), value: t('reports.takings.refunded', { amount: money(takings.refunds) }), refund: true },
      { key: 'net', label: t('reports.takings.net'), value: money(takings.net) },
    ],
    none: null,
  }
}

const taxPanel = (report: StoreReport, days: ReportDays): PanelView => {
  const tax = report.tax
  const byState = tax ? tax.by === 'state' : report.country === 'US'
  const title = t(byState ? 'reports.tax.titleState' : report.country === 'IN' ? 'reports.tax.titleGst' : 'reports.tax.titleRate')
  const note = t('reports.tax.note')
  if (tax === null) return { key: 'tax', title, big: null, delta: null, rows: [], none: noneFor(days), note }
  const labelOf = (key: string | null): string => (key === null ? t(byState ? 'reports.tax.noState' : 'reports.tax.delivery') : byState ? key : percent(Number(key)))
  return {
    key: 'tax',
    title,
    big: byState ? t('reports.tax.byState') : money(tax.total),
    delta: byState ? { text: t('reports.tax.stateNote'), tone: 'muted' } : report.country ? { text: t('reports.tax.forShoppers', { country: regionName(report.country, locale) }), tone: 'muted' } : null,
    rows: tax.rows.map((row) => ({ key: row.key ?? 'none', label: labelOf(row.key), value: money(row.amount) })),
    none: null,
    note,
  }
}

const ranked = <T>(key: 'sold' | 'markets' | 'offers', title: string, note: string, rows: readonly T[], none: string, row: (item: T, index: number) => Omit<PanelRow, 'bar'>, amount: (item: T) => ApiMoney): PanelView => {
  const widths = bars(rows, amount)
  return { key, title, big: null, delta: null, rows: rows.map((item, index) => ({ ...row(item, index), bar: widths[index] ?? 0 })), none: rows.length === 0 ? none : null, note }
}

const suppliersPanel = (view: SuppliersView, days: ReportDays): PanelView | null => {
  const base = { key: 'suppliers', title: t('reports.suppliers.title'), big: null, delta: null, note: t('reports.suppliers.note') } as const
  if (view.kind === 'locked') return { ...base, rows: [], none: t('reports.suppliers.locked', { plan: view.plan ?? t('reports.locked.somePlan') }) }
  // A store whose sales are all its own has no supplier split to show.
  if (view.kind !== 'ready' || !view.rows.some((row) => row.supplierId !== null)) return null
  const rows = view.rows.map((row) => ({ key: row.supplierId ?? 'own', label: row.supplierId === null ? t('reports.suppliers.own') : (row.name ?? t('reports.suppliers.own')), value: tCount('reports.suppliers.units', row.units) }))
  return { ...base, rows, none: rows.length === 0 ? noneFor(days) : null }
}

/** The prototype's cards in its order, then top offers (decided on #337), before the custom reports card. */
export const panelsOf = (report: StoreReport, days: ReportDays, suppliers: SuppliersView): PanelView[] => {
  const panels: (PanelView | null)[] = [
    takingsPanel(report, days),
    ranked('sold', t('reports.sold.title'), t('reports.sold.note'), report.sold, noneFor(days), (row) => ({ key: row.productId, label: t('reports.sold.row', { name: row.name, units: formatNumber(row.units, locale) }), value: money(row.amount) }), (row) => row.amount),
    ranked('markets', t('reports.markets.title'), t('reports.markets.note'), report.markets, noneFor(days), (row, index) => ({ key: row.marketId ?? `outside-${index}`, label: row.name ?? t('reports.markets.outside'), value: money(row.amount) }), (row) => row.amount),
    taxPanel(report, days),
    suppliersPanel(suppliers, days),
    ranked(
      'offers',
      t('reports.offers.title'),
      t('reports.offers.note'),
      report.offers,
      // Sales with no offer used aren't "no sales".
      report.takings ? t('reports.offers.none', { days }) : noneFor(days),
      (row, index) => ({ key: `${row.name}-${index}`, label: [t('reports.offers.row', { name: row.name, orders: tCount('reports.orders', row.orders) }), t('reports.offers.off', { discount: money(row.discount) })].join(' · '), value: money(row.amount) }),
      (row) => row.amount,
    ),
  ]
  return panels.filter((panel): panel is PanelView => panel !== null)
}

/** The builder's card: what it is, and the plan it needs once a refusal has named it. */
export const customPanel = (plan: string | null): PanelView => ({
  key: 'custom',
  title: t('reports.custom.title'),
  big: null,
  delta: null,
  rows: [{ key: 'custom', label: t('reports.custom.row'), value: plan ?? t('reports.custom.open') }],
  none: null,
  note: plan ? t('reports.custom.lockedNote', { plan }) : t('reports.custom.note'),
})
