import type { Brand } from '../api/brand'
import { buildTheme, darkPalette, lightPalette, radii } from '../theme'
import { themeFor } from './brandTheme'

const brand: Brand = { productName: 'Northstar', primaryColor: '#0A2A4A', accentColor: '#EC844F', font: null, corner: null, files: { logoLight: null, logoDark: null, mark: null } }

describe('the partner look over the tokens', () => {
  it("is DripFunnel's own look with no brand, light or dark", () => {
    expect(themeFor(null, 'light')).toEqual(buildTheme('light'))
    expect(themeFor(null, 'dark').colors).toEqual(darkPalette)
    expect(buildTheme('light').colors).toEqual(lightPalette)
  })

  it('takes the primary colour as the header and the accent as the brand colour, with a darker hover', () => {
    const { colors } = themeFor({ ...brand, primaryColor: '#123456', accentColor: '#C8E6F0' }, 'light')
    expect(colors.side).toBe('#123456')
    expect(colors.brand).toBe('#C8E6F0')
    expect(colors.brandHover).toBe('#b0cad3')
    expect(colors.page).toBe(lightPalette.page)
  })

  it("keeps DripFunnel's colours where the partner set none, and in dark mode keeps the dark ones", () => {
    const { colors } = themeFor({ ...brand, primaryColor: null, accentColor: null }, 'dark')
    expect(colors.side).toBe(darkPalette.side)
    expect(colors.brand).toBe(darkPalette.brand)
    expect(colors.page).toBe(darkPalette.page)
  })

  it('halves the corners for soft and removes them for square', () => {
    expect(themeFor({ ...brand, corner: 'soft' }, 'light').radii).toEqual({ small: 3, button: 6, tile: 7, card: 8, sheet: 12 })
    expect(themeFor({ ...brand, corner: 'square' }, 'light').radii).toEqual({ small: 0, button: 0, tile: 0, card: 0, sheet: 0 })
    expect(themeFor({ ...brand, corner: 'round' }, 'light').radii).toEqual(radii)
  })
})
