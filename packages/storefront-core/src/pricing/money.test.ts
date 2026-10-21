import { describe, expect, expectTypeOf, it } from 'vitest'
import { badgeSchema, ratingSchema, stockSchema, type Badge, type Rating, type Stock } from './brand'
import { formatMoney, moneySchema, toDecimal, type Money } from './money'

const money = (amount: string, currency: string): Money => moneySchema.parse({ amount, currency })

describe('formatMoney', () => {
  it('reads minor units by the currency’s own digits', () => {
    expect(formatMoney(money('129900', 'INR'), 'en-IN')).toBe('₹1,299.00')
    expect(formatMoney(money('1200', 'USD'), 'en-US')).toBe('$12.00')
    expect(formatMoney(money('1200', 'JPY'), 'en-US')).toBe('¥1,200')
    expect(formatMoney(money('-505', 'USD'), 'en-US')).toBe('-$5.05')
  })

  it('stays exact past 2^53 minor units', () => {
    expect(formatMoney(money('900719925474099312', 'USD'), 'en-US')).toBe('$9,007,199,254,740,993.12')
  })
})

describe('toDecimal', () => {
  it("turns minor units into a major-unit decimal with the currency's digits", () => {
    expect(toDecimal(money('1999', 'USD'))).toBe('19.99')
    expect(toDecimal(money('1200', 'JPY'))).toBe('1200')
    expect(toDecimal(money('-5', 'INR'))).toBe('-0.05')
  })
})

describe('malformed amounts', () => {
  it('fail at the decoder', () => {
    expect(moneySchema.safeParse({ amount: '19.99', currency: 'USD' }).success).toBe(false)
    expect(moneySchema.safeParse({ amount: '', currency: 'USD' }).success).toBe(false)
    expect(moneySchema.safeParse({ amount: '1999', currency: 'usd' }).success).toBe(false)
    expect(moneySchema.safeParse({ amount: '1999', currency: 'USD' }).success).toBe(true)
  })
})

describe('branded types', () => {
  it('are made only by core’s decoders, never from a plain value', () => {
    // Never called: these lines only have to fail to typecheck.
    const typeOnly = () => {
      // @ts-expect-error a number is not Money
      formatMoney(1999, 'en-US')
      // @ts-expect-error a string is not Money
      formatMoney('19.99', 'en-US')
      // @ts-expect-error an object of the right shape is still not Money
      formatMoney({ amount: '1999', currency: 'USD' }, 'en-US')
      // @ts-expect-error a Badge written out
      const badge: Badge = { label: 'Sale', tone: null }
      // @ts-expect-error a Stock written out
      const stock: Stock = { inStock: true, available: 2 }
      // @ts-expect-error a Rating written out
      const rating: Rating = { average: 5, count: 1000 }
      return [badge, stock, rating]
    }
    expect(typeOnly).toBeTypeOf('function')
    expectTypeOf(moneySchema.parse({ amount: '1', currency: 'USD' })).toEqualTypeOf<Money>()
  })

  it('decode the Shop API’s badges, stock and ratings', () => {
    expect(badgeSchema.parse({ label: 'New', tone: 'info' })).toEqual({ label: 'New', tone: 'info' })
    expect(badgeSchema.safeParse({ label: '', tone: null }).success).toBe(false)
    expect(stockSchema.parse({ inStock: false, available: 0 }).inStock).toBe(false)
    expect(stockSchema.safeParse({ inStock: true, available: -1 }).success).toBe(false)
    expect(ratingSchema.safeParse({ average: 6, count: 1 }).success).toBe(false)
  })
})
