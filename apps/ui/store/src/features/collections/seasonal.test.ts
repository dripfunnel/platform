import { describe, expect, it } from 'vitest'
import { seasonalFor } from './seasonal'

describe('seasonal suggestions', () => {
  it('follows the markets’ countries and the date, soonest first', () => {
    expect(seasonalFor(['IN'], new Date('2026-10-06T00:00:00Z'))).toEqual(['navratri', 'diwali', 'weddingSeason'])
    expect(seasonalFor(['US'], new Date('2026-10-06T00:00:00Z'))).toEqual(['halloween', 'blackFriday'])
    expect(seasonalFor(['DE'], new Date('2026-11-01T00:00:00Z'))).toEqual(['blackFriday', 'advent', 'christmas'])
  })

  it('dates Black Friday the day after the fourth Thursday, and Advent four Sundays before Christmas', () => {
    expect(seasonalFor(['US'], new Date('2026-11-27T00:00:00Z'))).toContain('blackFriday')
    expect(seasonalFor(['US'], new Date('2026-11-28T00:00:00Z'))).not.toContain('blackFriday')
    expect(seasonalFor(['DE'], new Date('2026-11-29T00:00:00Z'))).toContain('advent')
    expect(seasonalFor(['DE'], new Date('2026-11-30T00:00:00Z'))).not.toContain('advent')
  })

  it('keeps suggesting a season that runs across the new year, and nothing for a country it doesn’t know', () => {
    expect(seasonalFor(['IN'], new Date('2027-02-01T00:00:00Z'))).toContain('weddingSeason')
    expect(seasonalFor(['ZZ'], new Date('2026-10-06T00:00:00Z'))).toEqual([])
  })
})
