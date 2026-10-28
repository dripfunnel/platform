import { callingCodeOf, toE164 } from './phone'

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

  it('preselects the store’s country, and leaves the code to type for one it does not know', () => {
    expect(callingCodeOf('IN')).toBe('91')
    expect(callingCodeOf('ZZ')).toBe('')
    expect(callingCodeOf(null)).toBe('')
  })
})
