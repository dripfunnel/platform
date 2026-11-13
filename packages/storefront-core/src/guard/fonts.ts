// Web fonts from Google Fonts (decided 2026-11-12, ARCHITECTURE §3.4 "Fonts"): a theme lists the families it wants in
// theme.css's `@theme { --google-fonts: 'Bebas Neue', 'Barlow'; }` and core loads them, so none load unasked. Each family's weights are
// the ones Google serves, since a request naming one a family lacks is refused whole. Loading sends a shopper's IP to Google.

const all = 'wght@100;200;300;400;500;600;700;800;900'

export const googleFonts: ReadonlyMap<string, string | null> = new Map<string, string | null>([
  ['Inter', 'wght@100..900'],
  ['Roboto', 'wght@100..900'],
  ['Open Sans', 'wght@300..800'],
  ['Lato', 'wght@100;300;400;700;900'],
  ['Montserrat', 'wght@100..900'],
  ['Poppins', all],
  ['Raleway', 'wght@100..900'],
  ['Nunito', 'wght@200..1000'],
  ['Playfair Display', 'wght@400..900'],
  ['Merriweather', 'wght@300;400;700;900'],
  ['Lora', 'wght@400..700'],
  ['Oswald', 'wght@200..700'],
  ['Bebas Neue', null],
  ['Anton', null],
  ['Abril Fatface', null],
  ['Pacifico', null],
  ['Great Vibes', null],
  ['Barlow', all],
  ['Barlow Condensed', all],
  ['DM Sans', 'wght@400;500;700'],
  ['DM Serif Display', null],
  ['Work Sans', 'wght@100..900'],
  ['Manrope', 'wght@200..800'],
  ['Outfit', 'wght@100..900'],
  ['Space Grotesk', 'wght@300..700'],
  ['Rubik', 'wght@300..900'],
  ['Mulish', 'wght@200..1000'],
  ['Archivo', 'wght@100..900'],
  ['Cormorant Garamond', 'wght@300;400;500;600;700'],
  ['EB Garamond', 'wght@400..800'],
  ['Libre Baskerville', 'wght@400;700'],
  ['Josefin Sans', 'wght@100..700'],
  ['Quicksand', 'wght@300..700'],
  ['Teko', 'wght@300..700'],
  ['Rajdhani', 'wght@300;400;500;600;700'],
  ['Orbitron', 'wght@400..900'],
  ['Exo 2', 'wght@100..900'],
  ['Noto Sans', 'wght@100..900'],
  ['Noto Serif', 'wght@100..900'],
  ['Noto Sans Devanagari', 'wght@100..900'],
  ['Hind', 'wght@300;400;500;600;700'],
  ['Mukta', 'wght@200;300;400;500;600;700;800'],
  ['Source Sans 3', 'wght@200..900'],
  ['PT Serif', 'wght@400;700'],
  ['Fira Sans', all],
  ['Karla', 'wght@200..800'],
  ['Cabin', 'wght@400..700'],
  ['Kanit', all],
  ['Prompt', all],
  ['Sora', 'wght@100..800'],
  ['Plus Jakarta Sans', 'wght@200..800'],
  ['Urbanist', 'wght@100..900'],
  ['Lexend', 'wght@100..900'],
  ['Dancing Script', 'wght@400..700'],
])

export const googleFontsCss = 'https://fonts.googleapis.com'
export const googleFontsFiles = 'https://fonts.gstatic.com'

/** The families of the list that theme.css's `--google-fonts` asks for, in its order. */
export const fontsIn = (themeCss: string): string[] => {
  const asked = /--google-fonts\s*:([^;}]*)/.exec(themeCss)?.[1] ?? ''
  return [...new Set([...asked.matchAll(/['"]([A-Za-z0-9 ]{2,40})['"]/g)].map((m) => m[1] ?? '').filter((name) => googleFonts.has(name)))]
}

/** The one @import that loads them, first in the stylesheet as CSS requires; empty when theme.css names none. */
export const googleFontsImport = (themeCss: string): string => {
  const families = fontsIn(themeCss).map((name) => {
    const spec = googleFonts.get(name)
    return `family=${name.replaceAll(' ', '+')}${spec ? `:${spec}` : ''}`
  })
  return families.length === 0 ? '' : `@import url("${googleFontsCss}/css2?${families.join('&')}&display=swap");\n`
}
