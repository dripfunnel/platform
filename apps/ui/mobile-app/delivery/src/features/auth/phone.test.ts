import { countries, countryOf, dialOf, flagOf, matchesSearch, toE164 } from './phone'

describe('the mobile number', () => {
  it('is put in international form from the country code and the national number', () => {
    expect(toE164('91', '98765 43210')).toBe('+919876543210')
    expect(toE164('+1', '(415) 555-0132')).toBe('+14155550132')
  })

  it('drops the trunk 0 of the national number', () => {
    expect(toE164('44', '07911 123456')).toBe('+447911123456')
  })

  it('is refused when it cannot be a number', () => {
    expect(toE164('91', '12')).toBeNull()
    expect(toE164('', '9876543210')).toBeNull()
    expect(toE164('0', '9876543210')).toBeNull()
    expect(toE164('91', '9'.repeat(20))).toBeNull()
  })

  it('knows the store’s country when it is in the list, and none for one that is not', () => {
    expect(countryOf('IN')).toBe('IN')
    expect(dialOf('IN')).toBe('91')
    expect(countryOf('ZZ')).toBeNull()
    expect(countryOf(null)).toBeNull()
  })

  it('finds a country by part of its name, or by its calling code with or without the +', () => {
    expect(matchesSearch('United Kingdom', '44', 'king')).toBe(true)
    expect(matchesSearch('United Kingdom', '44', '+44')).toBe(true)
    expect(matchesSearch('United Kingdom', '44', '4')).toBe(true)
    expect(matchesSearch('United Kingdom', '44', '91')).toBe(false)
    expect(matchesSearch('India', '91', 'zzz')).toBe(false)
    expect(matchesSearch('India', '91', '  ')).toBe(true)
  })

  it('draws a flag for every country in the list', () => {
    expect(flagOf('IN')).toBe('🇮🇳')
    expect(countries.every((country) => flagOf(country.iso).length === 4)).toBe(true)
  })
})
