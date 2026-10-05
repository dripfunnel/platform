import { describe, expect, it } from 'vitest'
import type { Brand } from '../api/brand'
import { brandTokens } from './applyBrand'

const brand = (over: Partial<Brand> = {}): Brand => ({
  productName: 'Northstar Shops',
  primaryColor: '#1B3A5B',
  accentColor: '#2BB673',
  files: { logoLight: null, logoDark: null, mark: null, favicon: null },
  supportEmail: null,
  supportUrl: null,
  helpUrl: null,
  poweredBy: true,
  ...over,
})

describe('brandTokens', () => {
  it('paints the side and header with the primary and the brand colour with the accent, dark text on it', () => {
    expect(brandTokens(brand())).toMatchObject({ '--df-color-side': '#1B3A5B', '--df-color-brand': '#2BB673', '--df-color-brand-contrast': '#14181F' })
  })

  it('keeps DripFunnel’s own colours for what the partner hasn’t set', () => {
    expect(brandTokens(brand({ primaryColor: null, accentColor: null }))).toEqual({})
  })
})
