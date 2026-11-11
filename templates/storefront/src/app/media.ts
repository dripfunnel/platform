import { readdirSync } from 'node:fs'
import { join } from 'node:path'

// The theme's own images (src/theme/media/, #1405) for next dev and the template's own build; a live build names its
// copies on the asset host itself (apps/sandbox/src/gate/media.ts).
export const mediaFolder = join(process.cwd(), 'src/theme/media')
const imageName = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.(png|jpg|jpeg|webp)$/

export const imageNames = (): string[] => {
  try {
    return readdirSync(mediaFolder).filter((n) => imageName.test(n))
  } catch {
    return []
  }
}

/** Each image's address under /theme-media/, which ThemeImage reads through ThemeMediaProvider. */
export const themeMedia = (): Record<string, string> => Object.fromEntries(imageNames().map((n) => [n, `/theme-media/${n}`]))
