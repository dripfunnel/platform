import { catalogueFor, locale, setLanguage, t } from '.'

afterEach(() => setLanguage('en'))

describe('the app’s own words', () => {
  it('are English for a language the store offers and the app has no words for', () => {
    setLanguage('hi-IN')
    expect(locale).toBe('en')
    expect(t('tabs.home')).toBe('Home')
  })

  it('follow the language’s base, so en-IN and en are the same catalogue', () => {
    expect(catalogueFor('en-IN')).toBe('en')
    expect(catalogueFor('EN')).toBe('en')
    expect(catalogueFor('hi')).toBeNull()
    expect(catalogueFor(null)).toBeNull()
  })

  it('stay English when no language is chosen', () => {
    setLanguage(null)
    expect(locale).toBe('en')
  })
})
