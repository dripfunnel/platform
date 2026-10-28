import { errorText, t } from './index'

describe('the words for a refusal', () => {
  it('come from the screen’s own wording first, then the code’s, then the generic one', () => {
    expect(errorText('RATE_LIMITED', 'signIn')).toBe(t('errors.signIn.RATE_LIMITED'))
    expect(errorText('RATE_LIMITED')).toBe(t('errors.RATE_LIMITED'))
    expect(errorText('RIDER_HAS_PARCEL', 'signOut')).toBe(t('errors.signOut.RIDER_HAS_PARCEL'))
    expect(errorText('RIDER_SUSPENDED', 'signIn')).toBe(t('errors.RIDER_SUSPENDED'))
    expect(errorText('SOMETHING_NEW', 'signIn')).toBe(t('errors.generic'))
  })

  it('never carry the API’s English', () => {
    expect(errorText('UNKNOWN')).toBe(t('errors.generic'))
  })
})
