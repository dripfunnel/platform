import { defaultLanguage, marketHeaders, noChoice, resolveChoice } from './choice'
import { readChoice, readOffers, saveChoice, saveOffers } from './storage'

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))

const offers = { languages: ['en', 'hi'], currencies: ['INR', 'AED'] }

describe('the default language', () => {
  it('is the store’s language the phone speaks', () => {
    expect(defaultLanguage(offers, ['hi'])).toBe('hi')
  })

  it('takes the same language in another region, whichever way either is written', () => {
    expect(defaultLanguage(offers, ['hi-IN'])).toBe('hi')
    expect(defaultLanguage({ languages: ['en-IN', 'hi-IN'], currencies: ['INR'] }, ['hi'])).toBe('hi-IN')
    expect(defaultLanguage({ languages: ['en', 'EN-in'], currencies: ['INR'] }, ['en-in'])).toBe('EN-in')
  })

  it('prefers a language the phone ranks first, then the next', () => {
    expect(defaultLanguage(offers, ['fr-FR', 'hi-IN', 'en-US'])).toBe('hi')
  })

  it('is the store’s main language, the first it lists, when it offers none of the phone’s', () => {
    expect(defaultLanguage(offers, ['fr-FR'])).toBe('en')
    expect(defaultLanguage(offers, [])).toBe('en')
  })
})

describe('what goes out with every request', () => {
  it('is a saved choice the store still offers', () => {
    expect(resolveChoice(offers, { language: 'hi', currency: 'AED' }, ['en-US'])).toEqual({ language: 'hi', currency: 'AED' })
  })

  it('falls back for a language or currency the store no longer offers: the phone’s language, and the store’s own prices', () => {
    expect(resolveChoice(offers, { language: 'fr', currency: 'USD' }, ['hi-IN'])).toEqual({ language: 'hi', currency: null })
  })

  it('follows the phone’s language, and sends no currency, until the shopper picks', () => {
    expect(resolveChoice(offers, noChoice, ['hi-IN'])).toEqual({ language: 'hi', currency: null })
  })

  it('sends what was saved as it is while nothing is known of what the store offers', () => {
    expect(resolveChoice(null, { language: 'hi', currency: null }, ['en'])).toEqual({ language: 'hi', currency: null })
  })

  it('travels as the Shop API’s language and currency headers, each only when there is one', () => {
    expect(marketHeaders({ language: 'hi', currency: 'AED' })).toEqual({ 'x-shop-language': 'hi', 'x-shop-currency': 'AED' })
    expect(marketHeaders({ language: 'hi', currency: null })).toEqual({ 'x-shop-language': 'hi' })
    expect(marketHeaders(noChoice)).toEqual({})
  })
})

describe('what the phone keeps', () => {
  it('is the choice and the last offers, per store', async () => {
    await saveChoice('acme.my-store.one', { language: 'hi', currency: 'AED' })
    await saveOffers('acme.my-store.one', offers)
    expect(await readChoice('acme.my-store.one')).toEqual({ language: 'hi', currency: 'AED' })
    expect(await readOffers('acme.my-store.one')).toEqual(offers)
    expect(await readChoice('other.my-store.one')).toEqual(noChoice)
    expect(await readOffers('other.my-store.one')).toBeNull()
  })
})
