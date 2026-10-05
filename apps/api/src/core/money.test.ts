import { describe, expect, it } from 'vitest'
import { add, applyBps, compare, fromMajor, isCurrency, minorDigits, parseMinor, toMinorString } from './money'

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
