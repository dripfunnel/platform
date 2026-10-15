import { describe, expect, it } from 'vitest'
import { createI18n, createTextKeys } from './i18n'
import type { Catalogue, MessageKey } from './messages'

describe('createI18n', () => {
  it('fills values and plurals in the locale’s own digits', () => {
    const { t } = createI18n('en-US', { en: { 'legal.title': '{count, plural, =0 {No notices} one {# notice} other {# notices}}' } })
    expect(t('legal.title', { count: 0 })).toBe('No notices')
    expect(t('legal.title', { count: 1 })).toBe('1 notice')
    expect(t('legal.title', { count: 1200 })).toBe('1,200 notices')
    expect(t('powered.by', { brand: 'Northstar' })).toBe('Powered by Northstar')
  })

  it('takes the locale, then its base language, then English', () => {
    const { t } = createI18n('hi-IN', { hi: { 'consent.save': 'सहेजें' }, 'hi-IN': { 'consent.back': 'वापस' } })
    expect(t('consent.back')).toBe('वापस')
    expect(t('consent.save')).toBe('सहेजें')
    expect(t('consent.customize')).toBe('Choose')
  })

  it('reads a theme’s own key from its content, and shows an unknown key as written', () => {
    const { t } = createI18n('en', { en: { 'pages.cart.title': 'Your bag' } as Catalogue })
    expect(t('pages.cart.title')).toBe('Your bag')
    expect(t('pages.cart.titel')).toBe('pages.cart.titel')
  })
  it('leaves a placeholder it has no value for, rather than printing undefined', () => {
    expect(createI18n('en').t('price.was')).toBe('Was {price}')
  })
})

describe('the studio frame’s shown words (AI-STUDIO §8)', () => {
  const content = { en: { 'home.hero.title': 'Welcome to {store}', 'pages.home.lead': 'Made slowly', 'common.footer.note': 'Made slowly', 'consent.save': 'Keep my choice' } }
  const say = (t: (key: MessageKey, values?: Record<string, string>) => string, key: string, values?: Record<string, string>) => t(key as MessageKey, values)

  it('remembers each theme string as shown, with its file and key, and the first key on a tie', () => {
    const shown = createTextKeys()
    const { t } = createI18n('en-IN', content, shown)
    say(t, 'home.hero.title', { store: 'Acme' })
    say(t, 'pages.home.lead')
    say(t, 'common.footer.note')
    expect(shown.keyOf('Welcome to Acme')).toBe('home:hero.title')
    expect(shown.keyOf('  Made\n slowly ')).toBe('pages:home.lead')
  })

  it('leaves out core’s own messages and keys that aren’t a file and a path', () => {
    const shown = createTextKeys()
    const { t } = createI18n('en', { en: { ...content.en, Odd: 'Odd words' } as Catalogue }, shown)
    say(t, 'consent.customize')
    say(t, 'Odd')
    expect(shown.keyOf('Choose')).toBeNull()
    expect(shown.keyOf('Odd words')).toBeNull()
    say(t, 'consent.save')
    expect(shown.keyOf('Keep my choice')).toBe('consent:save')
  })
})
