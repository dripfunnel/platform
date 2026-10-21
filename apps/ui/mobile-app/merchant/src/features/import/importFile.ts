import { maxImportBytes, type CatalogImport } from '../../api/imports'
import { locale, t } from '../../messages'

export type FileError = { kind: 'type' | 'empty' | 'cols' | 'unreadable' | 'other'; name: string } | { kind: 'big'; name: string; size: number }

type Picked = { name: string; size: number | null; mimeType: string | null }

/** Refused on the phone before anything is sent: not a CSV, or over what the API takes (FILE_TOO_LARGE). */
export const checkPicked = (file: Picked): FileError | null => {
  if (!/\.csv$/i.test(file.name) && file.mimeType !== 'text/csv') return { kind: 'type', name: file.name }
  if (file.size !== null && file.size > maxImportBytes) return { kind: 'big', name: file.name, size: file.size }
  return null
}

/** The file's own refusal, as CatImport draws it: the two codes it names, else the general one. */
export const fileErrorOf = (job: CatalogImport, name: string): FileError => {
  const code = job.problems.find((problem) => problem.line === 0)?.code
  if (code === 'EMPTY') return { kind: 'empty', name }
  if (code === 'NO_NAME_COLUMN') return { kind: 'cols', name }
  return { kind: 'other', name }
}

const megabytes = (bytes: number): string => t('imports.fileErrors.big.size', { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024)) })

export const fileErrorWords = (error: FileError): { title: string; body: string } =>
  error.kind === 'big'
    ? { title: t('imports.fileErrors.big.title'), body: t('imports.fileErrors.big.body', { name: error.name, size: megabytes(error.size) }) }
    : { title: t(`imports.fileErrors.${error.kind}.title`), body: t(`imports.fileErrors.${error.kind}.body`, { name: error.name }) }

/** A file whose size the picker didn't report turned out over the limit once read (`size` is in bytes, or characters, which are never more). */
export class CsvTooLarge extends Error {
  constructor(readonly size: number) {
    super('The CSV is over the import limit.')
  }
}
