import { describe, expect, it } from 'vitest'
import { addMonth, codeFrom } from './create'

describe('addMonth', () => {
  it('keeps the day within the next month', () => {
    expect(addMonth(new Date('2026-01-31T10:00:00Z')).toISOString()).toBe('2026-02-28T10:00:00.000Z')
    expect(addMonth(new Date('2028-01-31T10:00:00Z')).toISOString()).toBe('2028-02-29T10:00:00.000Z')
    expect(addMonth(new Date('2026-12-15T10:00:00Z')).toISOString()).toBe('2027-01-15T10:00:00.000Z')
  })
})

describe('codeFrom', () => {
  it('makes a short readable code, or "store" when the name has no letters', () => {
    expect(codeFrom('Cedar & Pine')).toBe('cedar-pine')
    expect(codeFrom('  Café Ünïcode!  ')).toBe('cafe-unicode')
    expect(codeFrom('★★★')).toBe('store')
  })
})
