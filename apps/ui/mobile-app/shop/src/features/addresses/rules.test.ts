import { addressFields, addressProblems, type Draft } from './rules'

const draft = (over: Partial<Draft> = {}): Draft => ({ name: 'Ana Rao', line1: '12 Sample Lane', line2: '', city: 'Jaipur', region: 'Rajasthan', postalCode: '302017', country: 'IN', phone: '', ...over })

describe('an address by country', () => {
  it('is complete when its country’s fields are filled', () => {
    expect(addressProblems(draft())).toEqual({})
    expect(addressProblems(draft({ country: 'US', region: 'Ohio', postalCode: '43215' }))).toEqual({})
  })

  it('needs a state and a six-digit PIN code for India, a ZIP code for the US', () => {
    expect(addressProblems(draft({ region: '', postalCode: '' }))).toEqual({ region: 'required', postalCode: 'required' })
    expect(addressProblems(draft({ postalCode: '3020' }))).toEqual({ postalCode: 'invalid' })
    expect(addressProblems(draft({ country: 'US', region: 'Ohio', postalCode: '302017' }))).toEqual({ postalCode: 'invalid' })
  })

  it('needs only the basics where the country has no rules of its own', () => {
    expect(addressProblems(draft({ country: 'FR', region: '', postalCode: '' }))).toEqual({})
    expect(addressFields('FR').filter((f) => !f.optional).map((f) => f.field)).toEqual(['name', 'line1', 'city'])
  })

  it('needs a name, a line and a city, and a country', () => {
    expect(addressProblems(draft({ name: ' ', line1: '', city: '' }))).toEqual({ name: 'required', line1: 'required', city: 'required' })
    expect(addressProblems(draft({ country: '' }))).toMatchObject({ country: 'required' })
  })

  it('takes a phone number with its country code, or none', () => {
    expect(addressProblems(draft({ phone: '+91 98765-43210' }))).toEqual({})
    expect(addressProblems(draft({ phone: '98765 43210' }))).toEqual({ phone: 'invalid' })
  })
})
