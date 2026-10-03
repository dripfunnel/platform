import { csvLine } from '#core/csv'
import type { ReportDto, ReportTab } from './index'

type Cell = string | number | null | undefined
type RowOf<T extends ReportTab> = Extract<ReportDto, { tab: T }>['rows'][number]

// A tab's table as CSV: money as integer minor units beside its currency, dates in ISO. The
// columns are fixed per tab, so a report with no rows still exports its header.
const columns: { [T in ReportTab]: { key: keyof RowOf<T> & string; money?: true }[] } = {
  growth: [{ key: 'month' }, { key: 'signups' }, { key: 'newStores' }, { key: 'trialToPaidBps' }, { key: 'churned' }, { key: 'netStores' }],
  revenue: [{ key: 'month' }, { key: 'collected', money: true }, { key: 'fee', money: true }, { key: 'payout', money: true }],
  plans: [{ key: 'plan' }, { key: 'stores' }],
  storePerformance: [{ key: 'storeId' }, { key: 'store' }, { key: 'plan' }, { key: 'sales', money: true }, { key: 'orders' }, { key: 'changeBps' }, { key: 'declining' }],
  usage: [{ key: 'storeId' }, { key: 'store' }, { key: 'limit' }, { key: 'used' }, { key: 'cap' }, { key: 'percentBps' }],
  setupHealth: [{ key: 'kind' }, { key: 'storeId' }, { key: 'store' }, { key: 'detail' }, { key: 'since' }],
}

const cell = (v: unknown): Cell => {
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'boolean') return String(v)
  if (v === null || v === undefined || typeof v === 'string' || typeof v === 'number') return v
  return JSON.stringify(v)
}

const moneyOf = (v: unknown): { amount?: number; currency?: string } => (typeof v === 'object' && v !== null ? v : {})

export const reportCsv = (report: ReportDto): string => {
  const cols: { key: string; money?: true }[] = columns[report.tab]
  const header = cols.flatMap((c) => (c.money ? [`${c.key} (minor units)`, `${c.key} currency`] : [c.key]))
  const rows = (report.rows as Record<string, unknown>[]).map((row) =>
    cols.flatMap((c): Cell[] => (c.money ? [moneyOf(row[c.key]).amount, moneyOf(row[c.key]).currency] : [cell(row[c.key])])),
  )
  const cut = 'truncated' in report && report.truncated ? [csvLine([`Only the first ${report.rows.length} rows are included; narrow the filter to see the rest.`])] : []
  return [csvLine(header), ...rows.map(csvLine), ...cut].join('\n')
}
