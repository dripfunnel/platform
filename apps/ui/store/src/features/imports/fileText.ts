import { maxImportBytes } from '../../api/imports'

// A chosen file as the API reads it: CSV text. An Excel sheet (the first one) is turned into CSV here, in the browser,
// so the API takes one kind of text for both (#1178).

export const isExcel = (file: File): boolean => /\.xlsx$/i.test(file.name) || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const isCsv = (file: File): boolean => /\.csv$/i.test(file.name) || file.type === 'text/csv'

const cell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export type FileText = { ok: true; text: string } | { ok: false; reason: 'unreadable' | 'big' }

/** The file's text; an Excel file that can't be read, or whose CSV is past the API's size, is refused. */
export const fileText = async (file: File): Promise<FileText> => {
  if (!isExcel(file)) return { ok: true, text: await file.text() }
  try {
    // Loaded only when an Excel file is chosen, so the library isn't in the page's first download.
    const { readSheet } = await import('read-excel-file/browser')
    const text = (await readSheet(file)).map((row) => row.map(cell).join(',')).join('\n')
    return new TextEncoder().encode(text).byteLength > maxImportBytes ? { ok: false, reason: 'big' } : { ok: true, text }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}
