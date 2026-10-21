import { describe, expect, it } from 'vitest'
import { prorate, signed } from './proration'

const october = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-11-01T00:00:00Z') }

describe('prorate', () => {
  it('charges the difference for what is left of the period, rounded half up', () => {
    // Growth $49.00 to Pro $99.00 on 3 Oct at 09:00: 28 days 15 hours of 31 days left.
    const p = prorate(4900, 9900, october, new Date('2026-10-03T09:00:00Z'))
    expect(p).toEqual({ kind: 'charge', amount: 4617 })
    expect(signed(p)).toBe(4617)
  })

  it('credits a move down and leaves nothing at the period end or for the same price', () => {
    expect(prorate(9900, 4900, october, new Date('2026-10-16T12:00:00Z'))).toEqual({ kind: 'credit', amount: 2500 })
    expect(prorate(4900, 9900, october, october.end)).toEqual({ kind: 'none' })
    expect(prorate(4900, 4900, october, new Date('2026-10-03T09:00:00Z'))).toEqual({ kind: 'none' })
  })
})
