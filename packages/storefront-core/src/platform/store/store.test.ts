import { describe, expect, it } from 'vitest'
import { completeStore } from './store'

const full = { name: 'Juniper', mainLanguage: 'en', pricingCurrency: 'USD', pricesIncludeTax: false, timeZone: 'UTC' }

describe('completeStore', () => {
  it("falls back to the store's main language and pricing currency", () => {
    expect(completeStore({ ...full, language: null, currency: null })).toMatchObject({ language: 'en', currency: 'USD' })
  })

  it('drops a currency without a code and a logo without an address, instead of failing the store', () => {
    expect(completeStore({ ...full, currencies: [{ code: null }, { code: 'INR' }], logo: { url: null } })).toMatchObject({ currencies: [{ code: 'INR' }], logo: null })
  })

  it('names what is missing when a field a storefront needs is null', () => {
    expect(() => completeStore({ ...full, name: null, timeZone: null })).toThrow(expect.objectContaining({ code: 'STORE_INCOMPLETE', message: "The Shop API's store has no name, timeZone." }))
  })
})
