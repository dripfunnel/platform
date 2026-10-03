import { csvLine } from '#core/csv'
import type { ReportDto } from './index'

type Cell = string | number | null | undefined

// A tab's table as CSV: one column per field, money as integer minor units beside its currency,
// dates in ISO. Bars and the sentence are the screen's; the table is what a spreadsheet wants.
const isMoney = (v: unknown): v is { amount: number; currency: string } => typeof v === 'object' && v !== null && 'amount' in v && 'currency' in v

const flatten = (row: Record<string, unknown>): [string, Cell][] =>
  Object.entries(row).flatMap(([key, v]): [string, Cell][] => {
    if (isMoney(v)) return [[`${key} (minor units)`, v.amount], [`${key} currency`, v.currency]]
    if (v instanceof Date) return [[key, v.toISOString()]]
    if (v === null || v === undefined || typeof v === 'string' || typeof v === 'number') return [[key, v]]
    return [[key, typeof v === 'boolean' ? String(v) : JSON.stringify(v)]]
  })

export const reportCsv = (report: ReportDto): string => {
  const rows = (report.rows as Record<string, unknown>[]).map(flatten)
  const header = rows[0]?.map(([k]) => k) ?? []
  return [csvLine(header), ...rows.map((r) => csvLine(r.map(([, v]) => v)))].join('\n')
}
