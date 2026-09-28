import { describe, expect, it } from 'vitest'
import { formatMoney } from './money'

describe('formatMoney', () => {
  it('converts minor units using the currency’s own decimals', () => {
    expect(formatMoney({ amount: 123456, currency: 'INR' }, 'en-IN')).toBe('₹1,234.56')
    expect(formatMoney({ amount: 1500, currency: 'JPY' }, 'en-US')).toBe('¥1,500')
  })
})
