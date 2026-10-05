// Seasonal collections to suggest (CATALOG H13): by the countries the store's markets sell to and today's
// date, never one culture's calendar. Each occasion lists its countries and dates; moving feasts by year.

export type SeasonKey =
  | 'diwali'
  | 'navratri'
  | 'holi'
  | 'rakhi'
  | 'weddingSeason'
  | 'halloween'
  | 'blackFriday'
  | 'holidayGifts'
  | 'christmas'
  | 'advent'
  | 'oktoberfest'
  | 'backToSchool'
  | 'ramadan'
  | 'eid'
  | 'singlesDay'

interface Occasion {
  key: SeasonKey
  countries: readonly string[]
  /** The day it falls on in a year (UTC), or null when this table doesn't know that year. */
  on: (year: number) => Date | null
  /** Days before it to start suggesting; a season (weddings) suggests through its own length too. */
  lead: number
  lasts?: number
}

const dayMs = 86_400_000
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))
const known = (dates: Record<number, [number, number]>) => (y: number) => (dates[y] ? day(y, dates[y][0], dates[y][1]) : null)
/** The nth given weekday (0 = Sunday) of a month. */
const nth = (y: number, m: number, weekday: number, n: number) => {
  const first = day(y, m, 1)
  return day(y, m, 1 + ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7)
}

const westernHolidays = ['US', 'CA', 'GB', 'IE', 'AU', 'NZ']
const europe = ['DE', 'AT', 'CH', 'FR', 'NL', 'BE', 'IT', 'ES']
const gulf = ['AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'MY', 'ID']

const occasions: readonly Occasion[] = [
  { key: 'diwali', countries: ['IN'], on: known({ 2026: [11, 8], 2027: [10, 29], 2028: [10, 17] }), lead: 60 },
  { key: 'navratri', countries: ['IN'], on: known({ 2026: [10, 11], 2027: [9, 30], 2028: [9, 19] }), lead: 45 },
  { key: 'holi', countries: ['IN'], on: known({ 2026: [3, 4], 2027: [3, 22], 2028: [3, 11] }), lead: 45 },
  { key: 'rakhi', countries: ['IN'], on: known({ 2026: [8, 28], 2027: [8, 17], 2028: [8, 5] }), lead: 40 },
  { key: 'weddingSeason', countries: ['IN'], on: (y) => day(y, 11, 15), lead: 45, lasts: 105 },
  { key: 'halloween', countries: ['US', 'CA', 'GB', 'IE'], on: (y) => day(y, 10, 31), lead: 45 },
  { key: 'blackFriday', countries: [...westernHolidays, ...europe], on: (y) => new Date(nth(y, 11, 4, 4).getTime() + dayMs), lead: 60 },
  { key: 'holidayGifts', countries: ['US', 'CA'], on: (y) => day(y, 12, 25), lead: 60 },
  { key: 'christmas', countries: ['GB', 'IE', 'AU', 'NZ', ...europe], on: (y) => day(y, 12, 25), lead: 60 },
  { key: 'advent', countries: ['DE', 'AT', 'CH'], on: (y) => day(y, 12, 24 - day(y, 12, 24).getUTCDay() - 21), lead: 45 },
  { key: 'oktoberfest', countries: ['DE', 'AT'], on: (y) => nth(y, 9, 6, 3), lead: 45 },
  { key: 'backToSchool', countries: ['US', 'CA'], on: (y) => day(y, 8, 15), lead: 45 },
  { key: 'backToSchool', countries: ['IN'], on: (y) => day(y, 6, 1), lead: 45 },
  { key: 'ramadan', countries: gulf, on: known({ 2026: [2, 18], 2027: [2, 8], 2028: [1, 28] }), lead: 40 },
  { key: 'eid', countries: gulf, on: known({ 2026: [3, 20], 2027: [3, 10], 2028: [2, 27] }), lead: 40 },
  { key: 'singlesDay', countries: ['CN', 'SG', 'MY'], on: (y) => day(y, 11, 11), lead: 45 },
]

/** The occasions coming up in these countries, soonest first, at most `limit`. */
export const seasonalFor = (countries: readonly string[], today: Date, limit = 4): SeasonKey[] => {
  const sells = new Set(countries)
  const found = new Map<SeasonKey, number>()
  for (const o of occasions) {
    if (!o.countries.some((c) => sells.has(c))) continue
    for (const year of [today.getUTCFullYear() - 1, today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
      const date = o.on(year)
      if (!date) continue
      const until = (date.getTime() - today.getTime()) / dayMs
      if (until <= o.lead && until >= -(o.lasts ?? 0)) found.set(o.key, Math.min(found.get(o.key) ?? Infinity, until))
    }
  }
  return [...found].sort((a, b) => a[1] - b[1]).slice(0, limit).map(([key]) => key)
}
