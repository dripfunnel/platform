import { describe, expect, it } from 'vitest'
import { formatMoney, shopMoneySchema, toDecimal } from './money'

describe('formatMoney', () => {
  it('reads minor units by the currency’s own digits', () => {
    expect(formatMoney({ amount: '129900', currency: 'INR' }, 'en-IN')).toBe('₹1,299.00')
    expect(formatMoney({ amount: '1200', currency: 'USD' }, 'en-US')).toBe('$12.00')
    expect(formatMoney({ amount: '1200', currency: 'JPY' }, 'en-US')).toBe('¥1,200')
    expect(formatMoney({ amount: '-505', currency: 'USD' }, 'en-US')).toBe('-$5.05')
  })

  it('stays exact past 2^53 minor units', () => {
    expect(formatMoney({ amount: '900719925474099312', currency: 'USD' }, 'en-US')).toBe('$9,007,199,254,740,993.12')
  })
})

describe('toDecimal', () => {
  it('turns minor units into a major-unit decimal with the currency\'s digits', () => {
    expect(toDecimal({ amount: '1999', currency: 'USD' })).toBe('19.99')
    expect(toDecimal({ amount: '1200', currency: 'JPY' })).toBe('1200')
    expect(toDecimal({ amount: '-5', currency: 'INR' })).toBe('-0.05')
  })
})

describe('malformed amounts', () => {
  it('fail at the decoder, and with a named error if one slips through', () => {
    expect(shopMoneySchema.safeParse({ amount: '19.99', currency: 'USD' }).success).toBe(false)
    expect(shopMoneySchema.safeParse({ amount: '', currency: 'USD' }).success).toBe(false)
    expect(shopMoneySchema.safeParse({ amount: '1999', currency: 'USD' }).success).toBe(true)
    expect(() => toDecimal({ amount: '19.99', currency: 'USD' })).toThrow('Not a minor-unit amount: "19.99"')
  })
})
