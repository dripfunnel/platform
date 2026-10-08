/** The fonts a theme may use (storefront DESIGN §2): the allowlist, with each one's fallback. */
export const fonts = {
  'DM Sans': 'sans-serif',
  'Archivo Black': 'sans-serif',
  'Work Sans': 'sans-serif',
  Lora: 'serif',
  Nunito: 'sans-serif',
  'Space Grotesk': 'sans-serif',
  Inter: 'sans-serif',
  'Playfair Display': 'serif',
  'Cormorant Garamond': 'serif',
  Manrope: 'sans-serif',
  'Libre Baskerville': 'serif',
  'Bebas Neue': 'sans-serif',
} as const

export type Font = keyof typeof fonts
export const fontNames = Object.keys(fonts) as [Font, ...Font[]]

export const fontStack = (font: Font): string => `'${font}', ${fonts[font]}`
