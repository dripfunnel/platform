import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { Appearance } from 'react-native'
import { controlHeight, darkPalette, lightPalette, radii, space, type Palette, type Radii } from './tokens'

export type Mode = 'light' | 'dark'

export type Theme = { mode: Mode; colors: Palette; radii: Radii; space: typeof space; controlHeight: number }

/** The partner's look over a palette: what the brand overrides, nothing else (brand/brandTheme.ts). */
export type ThemeOverrides = { colors?: Partial<Palette>; radii?: Radii }

export const buildTheme = (mode: Mode, overrides: ThemeOverrides = {}): Theme => ({
  mode,
  colors: { ...(mode === 'dark' ? darkPalette : lightPalette), ...overrides.colors },
  radii: overrides.radii ?? radii,
  space,
  controlHeight,
})

const ThemeContext = createContext<Theme>(buildTheme('light'))

export const useTheme = (): Theme => useContext(ThemeContext)

// Native chrome (alerts, the keyboard) follows the app's mode, not the phone's.
export function ThemeProvider({ theme, children }: { theme: Theme; children: ReactNode }) {
  useEffect(() => {
    Appearance.setColorScheme(theme.mode)
  }, [theme.mode])
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}
