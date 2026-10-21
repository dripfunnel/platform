import { describe, expect, it } from 'vitest'
import { csvCell, csvLine, parseCsv } from './csv'

describe('csv', () => {
  it('keeps formula-looking text as text, and numbers as numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('-4500')).toBe(`'-4500`)
    expect(csvCell(-4500)).toBe('-4500')
    expect(csvCell(-1200)).toBe('-1200')
    expect(csvLine(['a,b', null, 3])).toBe('"a,b",,3')
  })

  it('writes money as a major-unit number, a negative one unquoted', () => {
    expect(csvLine([{ amount: -1250n, currency: 'USD' }, { amount: 129950n, currency: 'INR' }])).toBe('-12.50,1299.50')
  })
})

describe('parseCsv', () => {
  it('reads quoted cells, doubled quotes, line breaks inside quotes and either line ending', () => {
    expect(parseCsv('﻿a,"b, c","say ""hi"""\r\n1,"two\nlines",\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', 'two\nlines', ''],
    ])
  })

  it('takes back what csvCell guarded, so a written file reads as it was', () => {
    const values = ['=SUM(A1)', '-12', 'plain', "it's"]
    expect(parseCsv(csvLine(values))).toEqual([values])
  })

  it('refuses a quote never closed', () => {
    expect(parseCsv('a,"b\n')).toBeNull()
  })
})
