import { describe, expect, it } from 'vitest'
import { toPayoutCurrency } from './index'

describe('toPayoutCurrency', () => {
  it('divides by the contract rate, minding each currency’s digits, rounded half up', () => {
    // CAD 13.51 at 1.351351 CAD per USD is USD 10.00.
    expect(toPayoutCurrency(1351, '1.351351', 'CAD', 'USD')).toBe(1000)
    // ¥3,000 at 150 JPY per USD is USD 20.00, not 0.20: JPY has no minor digits.
    expect(toPayoutCurrency(3000, '150', 'JPY', 'USD')).toBe(2000)
    // USD 20.00 at 150 JPY per USD... the other way round is the plans' convert, not this.
    expect(toPayoutCurrency(5, '2', 'EUR', 'USD')).toBe(3)
  })
})
