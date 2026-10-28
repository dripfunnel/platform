import { offersFrom } from './markets'

describe('what the store offers', () => {
  it('lists the main language and the pricing currency first, once each', () => {
    expect(offersFrom({ store: { mainLanguage: 'en', languages: ['hi', 'en'], pricingCurrency: 'INR', currencies: [{ code: 'AED' }, { code: 'INR' }] } })).toEqual({ languages: ['en', 'hi'], currencies: ['INR', 'AED'] })
  })

  it('is just the main language and the pricing currency for a store with one of each', () => {
    expect(offersFrom({ store: { mainLanguage: 'en', languages: null, pricingCurrency: 'USD', currencies: null } })).toEqual({ languages: ['en'], currencies: ['USD'] })
  })

  it('is nothing for a store that has not said, so the screen shows no list', () => {
    expect(offersFrom({ store: null })).toBeNull()
    expect(offersFrom({ store: { mainLanguage: null, languages: null, pricingCurrency: null, currencies: null } })).toBeNull()
  })
})
