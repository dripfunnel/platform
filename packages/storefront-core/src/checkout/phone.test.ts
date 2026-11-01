import { describe, expect, it } from 'vitest'
import { isPhone } from './address'
import { callingCodes, countryOptions, dialOf, joinPhone, splitPhone } from './phone'

describe('phone', () => {
  it('lists each country once, by name in the shopper’s language', () => {
    expect(new Set(callingCodes.map((c) => c.country)).size).toBe(callingCodes.length)
    expect(dialOf('IN')).toBe('91')
    expect(dialOf('JM')).toBe('1876')
    expect(dialOf('ZZ')).toBeNull()
    expect(countryOptions('en-US')[0]?.name).toBe('Afghanistan')
    expect(countryOptions('en-US')).toBe(countryOptions('en-US'))
  })

  it('splits a number at its longest calling code, the preferred country breaking a tie', () => {
    expect(splitPhone('+919876543210', 'US')).toEqual({ country: 'IN', national: '9876543210' })
    expect(splitPhone('+91 98765 43210', 'US')).toEqual({ country: 'IN', national: '9876543210' })
    expect(splitPhone('+18765550100', 'US')).toEqual({ country: 'JM', national: '5550100' })
    expect(splitPhone('+14165550100', 'CA')).toEqual({ country: 'CA', national: '4165550100' })
    expect(splitPhone('+14165550100', 'IN')).toEqual({ country: 'US', national: '4165550100' })
  })

  it('keeps a number without a known code in the preferred country, or in none', () => {
    expect(splitPhone('', 'IN')).toEqual({ country: 'IN', national: '' })
    expect(splitPhone('98765', 'IN')).toEqual({ country: 'IN', national: '98765' })
    expect(splitPhone('98765', 'ZZ')).toEqual({ country: '', national: '98765' })
    expect(splitPhone('+999123', 'IN')).toEqual({ country: '', national: '+999123' })
  })

  it('joins the code and the number into the E.164 the API takes', () => {
    expect(joinPhone('IN', '98765 43210')).toBe('+919876543210')
    expect(isPhone(joinPhone('IN', '98765-43210'))).toBe(true)
    expect(joinPhone('IN', '')).toBe('')
    expect(joinPhone('', '98765')).toBe('98765')
    expect(joinPhone('IN', '+44 20 7946 0958')).toBe('+442079460958')
    expect(joinPhone('IN', '0044 20 7946 0958')).toBe('+442079460958')
  })

  it('gives back what it was given, split and joined again', () => {
    for (const number of ['+919876543210', '+18765550100', '+447946095800']) {
      const { country, national } = splitPhone(number, 'US')
      expect(joinPhone(country, national)).toBe(number)
    }
  })
})
