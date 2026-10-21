import { describe, expect, it } from 'vitest'
import { addInterval, offeredWays, quoteChange, type CurrentPlan } from './quote'

const start = new Date('2026-10-01T00:00:00Z')
const end = new Date('2026-10-31T00:00:00Z')
const growth: CurrentPlan = { paid: true, amount: 3000, interval: 'month', rank: 3000, periodStart: start, periodEnd: end }
const tenDaysLeft = new Date('2026-10-21T00:00:00Z')

describe('a plan change’s quote (SAAS §7.2)', () => {
  it('prorates an upgrade today: the new plan for the days left, less the old plan’s unused part', () => {
    const q = quoteChange(growth, { amount: 6000, interval: 'month', rank: 6000 }, 'now', tenDaysLeft)
    expect(q).toMatchObject({ offered: ['now', 'period_end'], charge: 2000, credit: 1000, today: 1000, from: tenDaysLeft, nextAmount: 6000 })
  })

  it('charges a longer period whole from today, less what is unused of the month', () => {
    const q = quoteChange(growth, { amount: 30000, interval: 'year', rank: 2500 }, 'now', tenDaysLeft)
    expect(q).toMatchObject({ charge: 30000, credit: 1000, today: 29000 })
  })

  it('offers a downgrade or a shorter period only at the period’s end, charging nothing today', () => {
    expect(offeredWays(growth, { amount: 1000, interval: 'month', rank: 1000 })).toEqual(['period_end'])
    expect(offeredWays({ ...growth, interval: 'year', amount: 30000 }, { amount: 3000, interval: 'month', rank: 3000 })).toEqual(['period_end'])
    expect(quoteChange(growth, { amount: 1000, interval: 'month', rank: 1000 }, 'period_end', tenDaysLeft)).toMatchObject({ today: 0, from: end, nextAmount: 1000 })
  })

  it('starts the first period now out of the trial, charging all of it', () => {
    const q = quoteChange({ ...growth, paid: false }, { amount: 1000, interval: 'month', rank: 1000 }, 'now', tenDaysLeft)
    expect(q).toMatchObject({ offered: ['now'], charge: 1000, credit: 0, today: 1000, from: tenDaysLeft })
  })

  it('rounds half up and never goes below zero', () => {
    const third = new Date(start.getTime() + (end.getTime() - start.getTime()) * (2 / 3))
    expect(quoteChange({ ...growth, amount: 1 }, { amount: 1, interval: 'month', rank: 3000 }, 'now', third)).toMatchObject({ charge: 0, credit: 0, today: 0 })
    expect(quoteChange(growth, { amount: 3000, interval: 'month', rank: 3000 }, 'now', end).today).toBe(0)
  })

  it('adds a calendar month or year', () => {
    expect(addInterval(new Date('2026-01-31T00:00:00Z'), 'year').toISOString()).toBe('2027-01-31T00:00:00.000Z')
    expect(addInterval(new Date('2026-10-05T09:00:00Z'), 'month').toISOString()).toBe('2026-11-05T09:00:00.000Z')
  })
})
