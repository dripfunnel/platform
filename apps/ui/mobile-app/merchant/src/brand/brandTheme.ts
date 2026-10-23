import type { Brand } from '../api/brand'
import { buildTheme, radii, type Mode, type Theme } from '@dripfunnel/mobile-shared/theme'

// The partner's look over DripFunnel's tokens, as the portal applies it (apps/ui/store brand/applyBrand.ts):
// the primary colour is the header, which carries white text; the accent is the brand colour, which carries
// dark text. The published brand passed both contrast checks (SAAS.md §3.3).
const darken = (hex: string, by: number): string => {
  const channel = (start: number) =>
    Math.round(parseInt(hex.slice(start, start + 2), 16) * (1 - by))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(1)}${channel(3)}${channel(5)}`
}

// "soft" halves every corner, "square" removes them.
const cornerScale: Record<string, number> = { soft: 0.5, square: 0 }

export const themeFor = (brand: Brand | null, mode: Mode): Theme => {
  if (!brand) return buildTheme(mode)
  const scale = brand.corner ? cornerScale[brand.corner] : undefined
  return buildTheme(mode, {
    colors: {
      ...(brand.primaryColor ? { side: brand.primaryColor } : {}),
      ...(brand.accentColor ? { brand: brand.accentColor, brandHover: darken(brand.accentColor, 0.12) } : {}),
    },
    ...(scale === undefined ? {} : { radii: Object.fromEntries(Object.entries(radii).map(([name, value]) => [name, Math.round(value * scale)])) as typeof radii }),
  })
}
