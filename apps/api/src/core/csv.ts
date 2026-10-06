import { toMajor, type Money } from './money'

// One CSV cell: text a spreadsheet would run as a formula is kept as text (OWASP CSV injection),
// numbers and money stay numbers (a negative one too), and quotes, commas and line breaks are quoted.
export type CsvValue = string | number | Money | null | undefined

export const csvCell = (value: CsvValue): string => {
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object' && value !== null) return toMajor(value)
  const text = value ?? ''
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

export const csvLine = (values: readonly CsvValue[]): string => values.map(csvCell).join(',')
