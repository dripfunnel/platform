// A cell a spreadsheet would run as a formula is prefixed, so an exported label can't execute (OWASP CSV injection).
export const csvCell = (value: string) => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export const csv = (rows: readonly (readonly string[])[]): string => rows.map((row) => row.map(csvCell).join(',')).join('\r\n')

// A download link for a CSV the browser holds; a data URL where object URLs do not exist (tests).
export const csvLink = (text: string) =>
  typeof URL.createObjectURL === 'function' ? URL.createObjectURL(new Blob([text], { type: 'text/csv' })) : `data:text/csv;charset=utf-8,${encodeURIComponent(text)}`
