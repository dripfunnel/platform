import { describe, expect, it } from 'vitest'
import { createI18n } from './i18n'

describe('createI18n', () => {
  it('fills values and plurals in the locale’s own digits', () => {
    const { t } = createI18n('en-US')
    expect(t('cart.label', { count: 0 })).toBe('Cart')
    expect(t('cart.label', { count: 3 })).toBe('Cart (3)')
    expect(t('powered.by', { brand: 'Northstar' })).toBe('Powered by Northstar')
  })

  it('takes the locale, then its base language, then English', () => {
    const { t } = createI18n('hi-IN', { hi: { 'nav.menu': 'मेनू' }, 'hi-IN': { 'nav.search': 'खोजें' } })
    expect(t('nav.search')).toBe('खोजें')
    expect(t('nav.menu')).toBe('मेनू')
    expect(t('products.viewAll')).toBe('View all')
  })

  it('leaves a placeholder it has no value for, rather than printing undefined', () => {
    expect(createI18n('en').t('price.was')).toBe('Was {price}')
  })
})
