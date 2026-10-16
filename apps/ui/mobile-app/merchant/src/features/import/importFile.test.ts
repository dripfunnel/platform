import { maxImportBytes } from '../../api/imports'
import { checkPicked, fileErrorOf, fileErrorWords } from './importFile'

const file = (over: Partial<{ name: string; size: number | null; mimeType: string | null }> = {}) => ({ name: 'spring.csv', size: 1000, mimeType: 'text/csv', ...over })

describe('checkPicked', () => {
  it('takes a CSV by its extension in any case, or by its type', () => {
    expect(checkPicked(file())).toBeNull()
    expect(checkPicked(file({ name: 'SPRING.CSV', mimeType: null }))).toBeNull()
    expect(checkPicked(file({ name: 'export', mimeType: 'text/csv' }))).toBeNull()
  })

  it('refuses anything else, such as an Excel file', () => {
    expect(checkPicked(file({ name: 'stock.xlsx', mimeType: 'application/vnd.ms-excel' }))).toEqual({ kind: 'type', name: 'stock.xlsx' })
    expect(checkPicked(file({ name: 'stock.csv.xlsx', mimeType: null }))).toEqual({ kind: 'type', name: 'stock.csv.xlsx' })
  })

  it('takes a file of exactly 5 MB and refuses one byte more; a size the picker did not give is left to the API', () => {
    expect(checkPicked(file({ size: maxImportBytes }))).toBeNull()
    expect(checkPicked(file({ size: maxImportBytes + 1 }))).toEqual({ kind: 'big', name: 'spring.csv', size: maxImportBytes + 1 })
    expect(checkPicked(file({ size: null }))).toBeNull()
  })
})

describe('fileErrorOf', () => {
  const job = (code: string | null) => ({ problems: code === null ? [] : [{ line: 0, column: null, code, message: 'x' }] }) as Parameters<typeof fileErrorOf>[0]

  it('names the two refusals CatImport draws, and calls anything else the general one', () => {
    expect(fileErrorOf(job('EMPTY'), 'a.csv')).toEqual({ kind: 'empty', name: 'a.csv' })
    expect(fileErrorOf(job('NO_NAME_COLUMN'), 'a.csv')).toEqual({ kind: 'cols', name: 'a.csv' })
    expect(fileErrorOf(job('SOMETHING_NEW'), 'a.csv')).toEqual({ kind: 'other', name: 'a.csv' })
    expect(fileErrorOf(job(null), 'a.csv')).toEqual({ kind: 'other', name: 'a.csv' })
  })
})

describe('words', () => {
  it('says each refusal with the file’s name, and a size in megabytes', () => {
    expect(fileErrorWords({ kind: 'unreadable', name: 'a.csv' }).body).toBe('a.csv didn’t open. Choose it again, or save a copy as CSV first.')
    expect(fileErrorWords({ kind: 'big', name: 'a.csv', size: 7.25 * 1024 * 1024 }).body).toBe('a.csv is 7.3 MB; the limit is 5 MB. Split it into two files, or import from Shopify instead.')
  })
})
