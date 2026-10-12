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

  it('decodes the brand and the home page’s search and sharing, and none of them is required', () => {
    const store = completeStore({
      ...full,
      favicon: { url: 'https://shop.example/shop-api/assets/f' },
      tagline: 'Linen for slow days',
      social: [{ network: 'instagram', url: 'https://www.instagram.com/juniper' }, { network: 'x', url: 'javascript:alert(1)' }, { network: 'facebook', url: 'http://facebook.com/juniper' }],
      seo: { title: 'Juniper linen', description: 'Handwoven in Jaipur.', image: { url: 'https://shop.example/shop-api/assets/s' } },
    })
    expect(store).toMatchObject({
      favicon: { url: 'https://shop.example/shop-api/assets/f' },
      tagline: 'Linen for slow days',
      // A link shows only once it parses as https.
      social: [{ network: 'instagram', url: 'https://www.instagram.com/juniper' }],
      seo: { title: 'Juniper linen', description: 'Handwoven in Jaipur.', image: { url: 'https://shop.example/shop-api/assets/s' } },
    })
    expect(completeStore(full)).toMatchObject({ favicon: null, tagline: null, social: [], seo: null })
    expect(completeStore({ ...full, seo: { title: null, description: null, image: null } }).seo).toEqual({ title: null, description: null, image: null })
  })

  it('names what is missing when a field a storefront needs is null', () => {
    expect(() => completeStore({ ...full, name: null, timeZone: null })).toThrow(expect.objectContaining({ code: 'STORE_INCOMPLETE', message: "The Shop API's store has no name, timeZone." }))
  })
})
