import { describe, expect, it } from 'vitest'
import { formatDateTime } from './dateTime'

describe('formatDateTime', () => {
  it('names the time zone it shows', () => {
    expect(formatDateTime('2026-09-26T09:40:00Z', 'en', 'UTC')).toBe('Sep 26, 2026, 09:40 UTC')
    expect(formatDateTime('2026-09-26T09:40:00Z', 'en-GB', 'UTC')).toMatch(/^26 Sept? 2026, 09:40 UTC$/)
  })

  it('converts to the zone it is given, never the machine’s', () => {
    expect(formatDateTime('2026-09-26T23:30:00Z', 'en', 'Asia/Kolkata')).toBe('Sep 27, 2026, 05:00 GMT+5:30')
  })
})
