import { describe, expect, it } from 'vitest'
import { add, applyBps, compare, convert, fromMajor, isCurrency, minorDigits, parseMinor, roundPrice, toMajor, toMinorString } from './money'

describe('money', () => {
  it('knows each currency’s minor unit, zero- and three-decimal ones included', () => {
    expect(minorDigits('USD')).toBe(2)
    expect(minorDigits('INR')).toBe(2)
    expect(minorDigits('JPY')).toBe(0)
    expect(minorDigits('KWD')).toBe(3)
    expect(isCurrency('XYZ')).toBe(false)
    expect(isCurrency('usd')).toBe(false)
    expect(() => minorDigits('NOPE')).toThrow()
  })

  it('reads minor units as the APIs carry them and refuses anything else', () => {
    expect(parseMinor('129900', 'INR')).toEqual({ amount: 129900n, currency: 'INR' })
    expect(parseMinor('0', 'USD')).toEqual({ amount: 0n, currency: 'USD' })
    for (const bad of ['-1', '1.5', '007', '', '1e3', '99999999999999999']) expect(parseMinor(bad, 'USD')).toBeNull()
    expect(parseMinor('100', 'XYZ')).toBeNull()
  })

  it('turns major units into minor ones, refusing more decimals than the currency has', () => {
    expect(fromMajor('1299.5', 'USD')).toEqual({ amount: 129950n, currency: 'USD' })
    expect(fromMajor('1299', 'JPY')).toEqual({ amount: 1299n, currency: 'JPY' })
    expect(fromMajor('1.234', 'KWD')).toEqual({ amount: 1234n, currency: 'KWD' })
    expect(fromMajor('12.5', 'JPY')).toBeNull()
    expect(fromMajor('1.999', 'USD')).toBeNull()
    expect(fromMajor('abc', 'USD')).toBeNull()
  })

  it('writes minor units as a major-unit decimal in each currency’s digits, which fromMajor reads back', () => {
    const cases: [bigint, string, string][] = [[129950n, 'USD', '1299.50'], [5n, 'USD', '0.05'], [0n, 'USD', '0.00'], [1299n, 'JPY', '1299'], [0n, 'JPY', '0'], [1234n, 'KWD', '1.234'], [7n, 'KWD', '0.007'], [-1250n, 'USD', '-12.50'], [-5n, 'JPY', '-5']]
    for (const [amount, currency, text] of cases) expect(toMajor({ amount, currency }), `${amount} ${currency}`).toBe(text)
    for (const [amount, currency, text] of cases.filter(([a]) => a >= 0n)) expect(fromMajor(text, currency)).toEqual({ amount, currency })
  })

  it('adds and compares only within one currency', () => {
    expect(add({ amount: 100n, currency: 'EUR' }, { amount: 250n, currency: 'EUR' })).toEqual({ amount: 350n, currency: 'EUR' })
    expect(compare({ amount: 1n, currency: 'EUR' }, { amount: 2n, currency: 'EUR' })).toBe(-1)
    expect(() => add({ amount: 1n, currency: 'EUR' }, { amount: 1n, currency: 'USD' })).toThrow()
    expect(toMinorString({ amount: 129900n, currency: 'INR' })).toBe('129900')
  })

  it('rounds a share half away from zero, in one place', () => {
    expect(applyBps({ amount: 4900n, currency: 'EUR' }, 1900)).toEqual({ amount: 931n, currency: 'EUR' })
    expect(applyBps({ amount: 5n, currency: 'EUR' }, 5000)).toEqual({ amount: 3n, currency: 'EUR' })
    expect(() => applyBps({ amount: 5n, currency: 'EUR' }, 1.5)).toThrow()
  })
})

describe('prices in another currency (CATALOG fact 26, O4)', () => {
  it('converts through both currencies’ rates against the euro, rounding half up to the target’s unit', () => {
    // 1299.00 INR at 90 INR and 1.08 USD to the euro.
    expect(convert({ amount: 129900n, currency: 'INR' }, 'USD', '90', '1.08')).toEqual({ amount: 1559n, currency: 'USD' })
    expect(convert({ amount: 1000n, currency: 'EUR' }, 'JPY', '1', '160.5')).toEqual({ amount: 1605n, currency: 'JPY' })
    expect(convert({ amount: 1605n, currency: 'JPY' }, 'EUR', '160.5', '1')).toEqual({ amount: 1000n, currency: 'EUR' })
    expect(convert({ amount: 100n, currency: 'USD' }, 'EUR', '0', '1')).toBeNull()
    expect(convert({ amount: 100n, currency: 'USD' }, 'EUR', '1.1e3', '1')).toBeNull()
  })

  it('rounds as the store asks', () => {
    expect(roundPrice({ amount: 1547n, currency: 'USD' }, 'ends-99')).toEqual({ amount: 1599n, currency: 'USD' })
    // Never below the computed price: 15.00 goes up to 15.99, and 15.99 stays.
    expect(roundPrice({ amount: 1500n, currency: 'USD' }, 'ends-99')).toEqual({ amount: 1599n, currency: 'USD' })
    expect(roundPrice({ amount: 1599n, currency: 'USD' }, 'ends-99')).toEqual({ amount: 1599n, currency: 'USD' })
    expect(roundPrice({ amount: 1500n, currency: 'JPY' }, 'ends-99')).toEqual({ amount: 1599n, currency: 'JPY' })
    expect(roundPrice({ amount: 1547n, currency: 'USD' }, 'nearest')).toEqual({ amount: 1500n, currency: 'USD' })
    expect(roundPrice({ amount: 1550n, currency: 'USD' }, 'nearest')).toEqual({ amount: 1600n, currency: 'USD' })
    expect(roundPrice({ amount: 1547n, currency: 'JPY' }, 'ends-99')).toEqual({ amount: 1599n, currency: 'JPY' })
    // Whole yen are already whole units.
    expect(roundPrice({ amount: 1547n, currency: 'JPY' }, 'nearest')).toEqual({ amount: 1547n, currency: 'JPY' })
    expect(roundPrice({ amount: 12345n, currency: 'KWD' }, 'nearest')).toEqual({ amount: 12000n, currency: 'KWD' })
    expect(roundPrice({ amount: 1547n, currency: 'USD' }, 'none')).toEqual({ amount: 1547n, currency: 'USD' })
  })
})
