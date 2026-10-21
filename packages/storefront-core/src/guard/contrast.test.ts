import { describe, expect, it } from 'vitest'
import { contrastRatio, minContrast, readableOn } from './contrast'

describe('contrastRatio', () => {
  it('is 21:1 for black on white, either way round, and 1:1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrastRatio('#FFF', '#000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#777777')).toBe(1)
  })
})

describe('readableOn', () => {
  it('keeps a colour that reads, and swaps one that does not for the better of near-black and white', () => {
    expect(readableOn('#FFFFFF', '#1F2937')).toBe('#1F2937')
    expect(readableOn('#FFFFFF', '#FDE68A')).toBe('#111111')
    expect(readableOn('#111827', '#1F2937')).toBe('#FFFFFF')
    expect(contrastRatio(readableOn('#0EA5E9', '#38BDF8'), '#0EA5E9')).toBeGreaterThanOrEqual(minContrast)
  })
})
