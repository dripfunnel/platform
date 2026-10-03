// One CSV cell: text a spreadsheet would run as a formula is kept as text (OWASP CSV injection),
// numbers stay numbers (a negative one too), and quotes, commas and line breaks are quoted.
export const csvCell = (value: string | number | null | undefined): string => {
  if (typeof value === 'number') return String(value)
  const text = value ?? ''
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

export const csvLine = (values: readonly (string | number | null | undefined)[]): string => values.map(csvCell).join(',')
