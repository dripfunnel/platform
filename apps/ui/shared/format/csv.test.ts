import { describe, expect, it } from 'vitest'
import { csv, csvCell } from './csv'

describe('csv', () => {
  it('quotes commas, quotes and line breaks, and defuses a cell that reads as a formula', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csv([['a', 'b'], ['1', 'x,y']])).toBe('a,b\r\n1,"x,y"')
  })
})
