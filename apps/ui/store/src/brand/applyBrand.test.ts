import { describe, expect, it } from 'vitest'
import type { Brand } from '../api/brand'
import { brandTokens, fontFamilies } from './applyBrand'

const brand = (over: Partial<Brand> = {}): Brand => ({
  productName: 'Northstar Shops',
  primaryColor: '#1B3A5B',
  accentColor: '#2BB673',
  font: null,
  corner: null,
  background: null,
  files: { logoLight: null, logoDark: null, mark: null, favicon: null },
  supportEmail: null,
  supportUrl: null,
  helpUrl: null,
  poweredBy: true,
  ...over,
})

describe('brandTokens', () => {
  it('paints the side and header with the primary and the brand colour with the accent, dark text on it', () => {
    expect(brandTokens(brand())).toMatchObject({ '--df-color-side': '#1B3A5B', '--df-color-brand': '#2BB673', '--df-color-brand-contrast': 'var(--df-color-ink)' })
  })

  it('keeps DripFunnel’s own colours for what the partner hasn’t set', () => {
    expect(brandTokens(brand({ primaryColor: null, accentColor: null }))).toEqual({})
  })

  it('sets the font and the corner radii', () => {
    expect(brandTokens(brand({ font: 'Lora', corner: 'square', background: 'sand' }))).toMatchObject({ '--df-font': '"Lora Variable", system-ui, sans-serif', '--df-radius': '0', '--df-radius-card': '0' })
    expect(brandTokens(brand({ background: 'sand' }))['--df-auth-panel']).toContain('repeating-linear-gradient')
    expect(brandTokens(brand({ background: 'plain' }))).not.toHaveProperty('--df-auth-panel')
    expect(brandTokens(brand({ corner: 'rounded' }))).not.toHaveProperty('--df-radius')
  })

  it('names only families the portal loads, and ignores a font it does not know', () => {
    expect(Object.keys(fontFamilies)).toEqual(['Nunito', 'Source Sans 3', 'Manrope', 'Lora', 'DM Sans'])
    expect(brandTokens(brand({ font: 'Comic Sans' }))).not.toHaveProperty('--df-font')
  })
})
