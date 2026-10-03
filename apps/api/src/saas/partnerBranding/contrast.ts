// WCAG 2.2 contrast (SAAS.md §3.3): white button text on the primary colour and dark text on the
// accent, each at least 4.5:1. The screen's check and the publish refusal both use this.
export const minimumRatio = 4.5
const white = '#FFFFFF'
const ink = '#14181F'

const luminance = (hex: string): number => {
  const channel = (index: number) => {
    const value = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

export const ratio = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

export interface ContrastReport {
  pairs: { key: 'primaryOnWhite' | 'accentOnDark'; ratio: string; passes: boolean }[]
  passes: boolean
  fix: string | null
}

export const contrastReport = (primary: string, accent: string): ContrastReport => {
  const onPrimary = ratio(primary, white)
  const onAccent = ratio(accent, ink)
  const fix =
    onPrimary < minimumRatio
      ? `White button text on ${primary} is ${onPrimary.toFixed(1)}:1. It needs 4.5:1 to be readable; try a darker primary.`
      : onAccent < minimumRatio
        ? `Dark text on ${accent} is ${onAccent.toFixed(1)}:1. It needs 4.5:1 to be readable; try a lighter accent.`
        : null
  return {
    pairs: [
      { key: 'primaryOnWhite', ratio: `${onPrimary.toFixed(1)}:1`, passes: onPrimary >= minimumRatio },
      { key: 'accentOnDark', ratio: `${onAccent.toFixed(1)}:1`, passes: onAccent >= minimumRatio },
    ],
    passes: fix === null,
    fix,
  }
}
