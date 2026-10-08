const channels = (hex: string): [number, number, number] => {
  let h = hex.slice(1)
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const n = Number.parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const luminance = (hex: string): number => {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.2 contrast ratio between two hex colours. */
export const contrastRatio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Body text needs 4.5:1 (WCAG 2.2 AA, storefront DESIGN §5). */
export const minContrast = 4.5

/** `fg` if it reads on `bg`, else whichever of near-black and white reads better. */
export const readableOn = (bg: string, fg: string): string => {
  if (contrastRatio(fg, bg) >= minContrast) return fg
  return contrastRatio('#111111', bg) >= contrastRatio('#FFFFFF', bg) ? '#111111' : '#FFFFFF'
}
