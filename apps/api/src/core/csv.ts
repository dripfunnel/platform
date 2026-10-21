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

/**
 * A spreadsheet's rows (RFC 4180: quoted cells, doubled quotes, line breaks inside quotes; a byte-order mark and
 * CRLF or LF endings), with csvCell's guard taken back off. Null when a quote is never closed.
 */
export const parseCsv = (text: string): string[][] | null => {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const endCell = () => {
    row.push(/^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell)
    cell = ''
  }
  for (; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === ',') endCell()
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      endCell()
      rows.push(row)
      row = []
    } else cell += c
  }
  if (quoted) return null
  if (cell !== '' || row.length > 0) {
    endCell()
    rows.push(row)
  }
  return rows
}
