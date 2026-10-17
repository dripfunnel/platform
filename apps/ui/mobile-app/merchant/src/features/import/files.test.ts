import { maxImportBytes } from '../../api/imports'
import { readCsv } from './files'
import { CsvTooLarge } from './importFile'

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }))

const answer = (text: string, length: string | null = null) => ({ headers: { get: () => length }, text: jest.fn(async () => text) })
const fetchMock = jest.fn()

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('readCsv', () => {
  it('reads the file’s text without the byte-order mark Excel writes', async () => {
    fetchMock.mockResolvedValue(answer('﻿name,price\nShirt,499\n'))

    expect(await readCsv('file:///cache/a.csv')).toBe('name,price\nShirt,499\n')
    expect(fetchMock).toHaveBeenCalledWith('file:///cache/a.csv')
  })

  it('refuses a file whose declared length is over the limit, before reading any of it', async () => {
    const response = answer('x', String(maxImportBytes + 1))
    fetchMock.mockResolvedValue(response)

    await expect(readCsv('file:///cache/big.csv')).rejects.toEqual(expect.objectContaining({ size: maxImportBytes + 1 }))
    expect(response.text).not.toHaveBeenCalled()
  })

  it('refuses a file with no declared length once its text is over the limit', async () => {
    fetchMock.mockResolvedValue(answer('a'.repeat(maxImportBytes + 1)))

    await expect(readCsv('file:///cache/big.csv')).rejects.toBeInstanceOf(CsvTooLarge)
  })

  it('takes a file of exactly the limit', async () => {
    fetchMock.mockResolvedValue(answer('a'.repeat(maxImportBytes), String(maxImportBytes)))

    expect((await readCsv('file:///cache/limit.csv')).length).toBe(maxImportBytes)
  })
})
