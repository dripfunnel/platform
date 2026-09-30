import { describe, expect, it } from 'vitest'
import { formatDuration } from './duration'

describe('formatDuration', () => {
  it('shows the two largest units', () => {
    expect(formatDuration(2 * 86_400 + 3_600 + 120, 'en')).toBe('2 days 1 hr')
    expect(formatDuration(6 * 60 + 12, 'en')).toBe('6 min 12 sec')
  })

  it('drops a second unit that is zero', () => {
    expect(formatDuration(3 * 3_600, 'en')).toBe('3 hr')
  })

  it('shows zero and sub-second values as zero seconds', () => {
    expect(formatDuration(0, 'en')).toBe('0 sec')
    expect(formatDuration(-5, 'en')).toBe('0 sec')
  })
})
