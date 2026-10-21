import { describe, expect, it } from 'vitest'
import { fontNames, fonts, fontStack } from './fonts'

describe('the font allowlist', () => {
  it('gives every font a generic fallback, and lists exactly the fonts it holds', () => {
    expect(fontNames).toEqual(Object.keys(fonts))
    for (const name of fontNames) expect(['serif', 'sans-serif']).toContain(fonts[name])
  })

  it('quotes the family name and ends the stack with its fallback', () => {
    expect(fontStack('Playfair Display')).toBe("'Playfair Display', serif")
    expect(fontStack('Inter')).toBe("'Inter', sans-serif")
  })
})
