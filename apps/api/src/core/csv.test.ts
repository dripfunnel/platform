import { describe, expect, it } from 'vitest'
import { csvCell, csvLine } from './csv'

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
