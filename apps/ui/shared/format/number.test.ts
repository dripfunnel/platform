import { describe, expect, it } from 'vitest'
import { formatNumber } from './number'

describe('formatNumber', () => {
  it('groups digits the locale’s way', () => {
    expect(formatNumber(1679, 'en')).toBe('1,679')
    expect(formatNumber(1234567, 'en-IN')).toBe('12,34,567')
  })
})
