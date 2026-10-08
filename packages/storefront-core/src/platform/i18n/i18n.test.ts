import { describe, expect, it } from 'vitest'
import { createI18n } from './i18n'

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

  it('leaves a placeholder it has no value for, rather than printing undefined', () => {
    expect(createI18n('en').t('price.was')).toBe('Was {price}')
  })
})
