// The values of apps/ui/shared/ui/tokens.css (designs/design.md §5–§7), as React Native has no CSS
// variables (ARCHITECTURE.md §2). Light is the default; dark is the same names with the dark values.
export type Palette = {
  brand: string
  brandHover: string
  brandContrast: string
  ink: string
  /** Text on an `ink` surface (a toast, the scenario button). */
  onInk: string
  page: string
  surface: string
  heading: string
  text: string
  muted: string
  textStrong: string
  link: string
  border: string
  fieldBorder: string
  focus: string
  skeleton: string
  backdrop: string
  danger: string
  dangerSurface: string
  dangerBorder: string
  /** A destructive action's button, which carries white text. */
  dangerButton: string
  /** The label on `dangerButton`. */
  onDanger: string
  /** A floating control's shadow. */
  shadow: string
  warning: string
  warningSurface: string
  warningBorder: string
  info: string
  infoSurface: string
  infoBorder: string
  success: string
  successSurface: string
  successBorder: string
  neutral: string
  neutralSurface: string
  neutralBorder: string
  hover: string
  /** The active tab's pill (DESIGN.md §2). */
  selected: string
  /** The header and the active tab: the partner's primary colour, which carries white text. */
  side: string
  sideText: string
}

export const lightPalette: Palette = {
  brand: '#ec844f',
  brandHover: '#d96c33',
  brandContrast: '#4a1b0c',
  ink: '#14181f',
  onInk: '#ffffff',
  page: '#fdfaf7',
  surface: '#ffffff',
  heading: '#0a2a4a',
  text: '#14181f',
  muted: '#5a6472',
  textStrong: '#434a55',
  link: '#b8541f',
  border: '#e8e2dc',
  fieldBorder: '#d7d3cd',
  focus: '#00519f',
  skeleton: '#efeae4',
  backdrop: 'rgba(10, 22, 34, 0.55)',
  danger: '#a1261b',
  dangerSurface: '#fdecec',
  dangerBorder: '#f3c7c2',
  dangerButton: '#a1261b',
  onDanger: '#ffffff',
  shadow: '#000000',
  warning: '#7a4b00',
  warningSurface: '#fff6e5',
  warningBorder: '#f2d9a6',
  info: '#00325f',
  infoSurface: '#eaf1f8',
  infoBorder: '#c6d9ec',
  success: '#1d6b47',
  successSurface: '#eef7f2',
  successBorder: '#cbe6d6',
  neutral: '#4a5360',
  neutralSurface: '#f1eeea',
  neutralBorder: '#e0dad3',
  hover: '#f7f2ed',
  selected: '#e3ecf5',
  side: '#0a2a4a',
  sideText: '#ffffff',
}

export const darkPalette: Palette = {
  ...lightPalette,
  brandHover: '#f09a6d',
  page: '#0a1622',
  surface: '#12222f',
  heading: '#ffffff',
  text: '#d6dee7',
  muted: '#8a9aab',
  textStrong: '#d6dee7',
  link: '#ec844f',
  border: '#1e3242',
  fieldBorder: '#2a3f52',
  focus: '#2e7bd1',
  skeleton: '#1a2c3b',
  backdrop: 'rgba(0, 0, 0, 0.6)',
  danger: '#f29a90',
  dangerSurface: '#34110f',
  dangerBorder: '#5e231e',
  dangerButton: '#b83227',
  warning: '#f2c36b',
  warningSurface: '#2e2208',
  warningBorder: '#5a4212',
  info: '#9cc3ec',
  infoSurface: '#132b3f',
  infoBorder: '#23496b',
  success: '#7fd1a5',
  successSurface: '#0f2a1e',
  successBorder: '#1f4a35',
  neutral: '#b8c7d6',
  neutralSurface: '#1a2a38',
  neutralBorder: '#2a3f52',
  hover: '#16293a',
  selected: '#1e3a52',
  side: '#050d14',
}

// Mobile sizes (DESIGN.md §4): buttons 12, quick tiles 14, list cards 16, sheets 24; hit targets 44.
export const radii = { small: 6, button: 12, tile: 14, card: 16, sheet: 24 } as const
export type Radii = { [K in keyof typeof radii]: number }

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 10: 40, 12: 48, 16: 64 } as const
export const controlHeight = 44
