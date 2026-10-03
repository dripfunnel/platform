// One CSV cell: a value a spreadsheet would run as a formula is kept as text (OWASP CSV injection),
// and quotes, commas and line breaks are quoted.
export const csvCell = (value: string | number | null | undefined): string => {
  const text = value === null || value === undefined ? '' : String(value)
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

export const csvLine = (values: readonly (string | number | null | undefined)[]): string => values.map(csvCell).join(',')
