import { isApiError } from '../graphql'
import { brandFrom } from './store'

describe("the store's brand", () => {
  it("maps the Shop API's answer to the name, the logo and the mark", () => {
    const answer = { store: { name: 'Juniper & Co.', logo: { url: 'https://juniper.my-store.one/shop-api/assets/1' }, favicon: { url: 'https://juniper.my-store.one/shop-api/assets/2' } } }
    expect(brandFrom(answer)).toEqual({ name: 'Juniper & Co.', logo: 'https://juniper.my-store.one/shop-api/assets/1', mark: 'https://juniper.my-store.one/shop-api/assets/2' })
  })

  it('keeps a store that has no logo yet, with none', () => {
    expect(brandFrom({ store: { name: 'Juniper & Co.', logo: null, favicon: { url: null } } })).toEqual({ name: 'Juniper & Co.', logo: null, mark: null })
  })

  it('is none when the host answers with no store, an answer rather than a failure', () => {
    expect(brandFrom({ store: null })).toBeNull()
  })

  it('refuses an answer of another shape, by code', () => {
    try {
      brandFrom({ store: { name: 7 } })
      throw new Error('should have refused')
    } catch (error) {
      expect(isApiError(error) && error.code).toBe('BAD_RESPONSE')
    }
  })
})
