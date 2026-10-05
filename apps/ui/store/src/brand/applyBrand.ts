import type { Brand } from '../api/brand'

// The partner's look over DripFunnel's tokens (ui/README.md §4): the primary colour is the header and
// side bar, which carry white text; the accent is the brand colour, which carries dark text. The
// published brand passed both contrast checks (apps/api src/saas/partnerBranding/contrast.ts).

export const brandTokens = (brand: Brand): Record<string, string> => ({
  ...(brand.primaryColor ? { '--df-color-side': brand.primaryColor } : {}),
  ...(brand.accentColor
    ? { '--df-color-brand': brand.accentColor, '--df-color-brand-hover': `color-mix(in srgb, ${brand.accentColor} 88%, black)`, '--df-color-brand-contrast': 'var(--df-color-ink)' }
    : {}),
})

export const applyBrand = (brand: Brand, root: HTMLElement = document.documentElement): void => {
  for (const [name, value] of Object.entries(brandTokens(brand))) root.style.setProperty(name, value)
  document.title = brand.productName
  if (brand.files.favicon) {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }))
    link.href = brand.files.favicon
  }
}
