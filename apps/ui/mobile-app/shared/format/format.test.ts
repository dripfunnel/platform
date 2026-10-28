import { formatCases } from './cases'
import { formatMoney } from './money'

const NBSP = String.fromCharCode(0xa0)

describe('format on Node, with the inputs the Hermes check runs on the phone', () => {
  it.each(formatCases.map((c) => [`${c.group}: ${c.name}`, c] as const))('%s', (_label, { actual, expected }) => {
    expect(actual('en')).toBe(expected)
  })

  it('covers money in INR, USD and the zero-decimal JPY, dates across zones, plurals and lists', () => {
    const groups = new Set(formatCases.map((c) => c.group))
    expect([...groups]).toEqual(expect.arrayContaining(['money', 'dateTime', 'plural', 'list', 'number', 'duration', 'distance']))
    const names = formatCases.filter((c) => c.group === 'money').map((c) => c.name)
    expect(names).toEqual(expect.arrayContaining([expect.stringContaining('INR'), expect.stringContaining('USD'), expect.stringContaining('JPY')]))
  })
})

describe('formatMoney', () => {
  it('takes the digits from the currency, so yen has none and dinars have three', () => {
    expect(formatMoney({ amount: 100, currency: 'JPY' }, 'en')).toBe('¥100')
    expect(formatMoney({ amount: 100, currency: 'USD' }, 'en')).toBe('$1.00')
    expect(formatMoney({ amount: '50000', currency: 'INR' }, 'en', { trimWhole: true })).toBe('₹500')
    expect(formatMoney({ amount: '1250', currency: 'USD' }, 'en', { trimWhole: true })).toBe('$12.50')
    expect(formatMoney({ amount: 1000, currency: 'KWD' }, 'en')).toBe(`KWD${NBSP}1.000`)
  })

  it('refuses an amount that is not whole minor units', () => {
    expect(() => formatMoney({ amount: 19.99, currency: 'USD' }, 'en')).toThrow(RangeError)
    expect(() => formatMoney({ amount: Number.NaN, currency: 'USD' }, 'en')).toThrow(RangeError)
  })
})

describe('formatMoney with the API’s digit strings', () => {
  it('formats an amount past what a number holds without throwing', () => {
    expect(() => formatMoney({ amount: '9007199254740993', currency: 'INR' }, 'en')).not.toThrow()
    expect(formatMoney({ amount: '123456', currency: 'INR' }, 'en')).toBe('₹1,234.56')
    expect(formatMoney({ amount: '-1999', currency: 'USD' }, 'en')).toBe('-$19.99')
  })

  it('refuses text that is not whole minor units', () => {
    expect(() => formatMoney({ amount: '19.99', currency: 'USD' }, 'en')).toThrow(RangeError)
  })
})
