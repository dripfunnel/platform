import type { Brand } from '../api/brand'

// The partner's look over DripFunnel's tokens (ui/README.md §4): the primary colour is the header and
// side bar, which carry white text; the accent is the brand colour, which carries dark text. The
// published brand passed both contrast checks (apps/api src/saas/partnerBranding/contrast.ts).

const radii: Record<string, Record<string, string>> = {
  soft: { '--df-radius-small': '3px', '--df-radius': '4px', '--df-radius-card': '6px', '--df-radius-dialog': '8px' },
  square: { '--df-radius-small': '0', '--df-radius': '0', '--df-radius-card': '0', '--df-radius-dialog': '0' },
}

const panels = (primary: string, accent: string): Record<string, string> => ({
  sand: `repeating-linear-gradient(135deg, color-mix(in srgb, ${accent} 30%, transparent) 0 2px, transparent 2px 12px), ${primary}`,
  photo: `linear-gradient(160deg, color-mix(in srgb, ${primary} 70%, black), ${primary})`,
})

const authPanel = (brand: Brand): Record<string, string> => {
  const panel = brand.primaryColor && brand.accentColor && brand.background ? panels(brand.primaryColor, brand.accentColor)[brand.background] : undefined
  return panel ? { '--df-auth-panel': panel } : {}
}

// The families @fontsource-variable registers, which carry a " Variable" suffix (shared/ui/fonts.css).
export const fontFamilies: Record<string, string> = {
  Nunito: 'Nunito Variable',
  'Source Sans 3': 'Source Sans 3 Variable',
  Manrope: 'Manrope Variable',
  Lora: 'Lora Variable',
  'DM Sans': 'DM Sans Variable',
}

const fontTokens = (font: string | null): Record<string, string> => {
  const family = font ? fontFamilies[font] : undefined
  return family ? { '--df-font': `"${family}", system-ui, sans-serif`, '--df-font-heading': `"${family}", system-ui, sans-serif` } : {}
}

export const brandTokens = (brand: Brand): Record<string, string> => ({
  ...(brand.primaryColor ? { '--df-color-side': brand.primaryColor } : {}),
  ...(brand.accentColor
    ? { '--df-color-brand': brand.accentColor, '--df-color-brand-hover': `color-mix(in srgb, ${brand.accentColor} 88%, black)`, '--df-color-brand-contrast': 'var(--df-color-ink)' }
    : {}),
  ...fontTokens(brand.font),
  ...(brand.corner ? radii[brand.corner] : {}),
  ...authPanel(brand),
})

export const applyBrand = (brand: Brand, root: HTMLElement = document.documentElement): void => {
  for (const [name, value] of Object.entries(brandTokens(brand))) root.style.setProperty(name, value)
  document.title = brand.productName
  if (brand.files.favicon) {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }))
    link.href = brand.files.favicon
  }
}
