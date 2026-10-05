import { describe, expect, it } from 'vitest'
import { formatMoney, minorOf, moneyText } from './money'

describe('formatMoney', () => {
  it('converts minor units using the currency’s own decimals', () => {
    expect(formatMoney({ amount: 123456, currency: 'INR' }, 'en-IN')).toBe('₹1,234.56')
    expect(formatMoney({ amount: 1500, currency: 'JPY' }, 'en-US')).toBe('¥1,500')
  })
})

describe('money as typed', () => {
  it('reads major units into minor units by the currency’s decimals, empty as unpriced', () => {
    expect(minorOf('49', 'USD')).toBe(4900)
    expect(minorOf('49.5', 'USD')).toBe(4950)
    expect(minorOf('', 'USD')).toBeNull()
    expect(minorOf('abc', 'USD')).toBe('invalid')
    expect(minorOf('4900', 'JPY')).toBe(4900)
    expect(minorOf('49.00', 'JPY')).toBe('invalid')
  })

  it('shows minor units as a field holds them', () => {
    expect(moneyText({ amount: 129900, currency: 'INR' })).toBe('1299.00')
    expect(moneyText({ amount: 1500, currency: 'JPY' })).toBe('1500')
  })
})
