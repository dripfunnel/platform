import { t } from './index'

describe('t()', () => {
  it('returns the words for a key', () => {
    expect(t('tabs.home')).toBe('Home')
  })

  it('fills {name} placeholders, numbers included', () => {
    expect(t('brand.logo', { name: 'Northstar' })).toBe('Northstar logo')
    expect(t('hermesCheck.summary', { passed: 3, total: 4 })).toBe('3 of 4 inputs match')
  })

  it('leaves a placeholder with no value visible, never blank', () => {
    expect(t('brand.logo')).toBe('{name} logo')
  })
})
