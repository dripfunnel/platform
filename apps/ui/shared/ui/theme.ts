export const themeChoices = ['system', 'light', 'dark'] as const

export type ThemeChoice = (typeof themeChoices)[number]
export type ResolvedTheme = 'light' | 'dark'

export const parseThemeChoice = (value: unknown): ThemeChoice =>
  typeof value === 'string' && (themeChoices as readonly string[]).includes(value)
    ? (value as ThemeChoice)
    : 'system'

export const resolveTheme = (choice: ThemeChoice, prefersDark: boolean): ResolvedTheme =>
  choice === 'system' ? (prefersDark ? 'dark' : 'light') : choice

// Light is the absence of the attribute, not a value of it.
export const applyTheme = (root: HTMLElement, theme: ResolvedTheme): void => {
  if (theme === 'dark') root.dataset.theme = 'dark'
  else delete root.dataset.theme
}

export interface ThemeStore {
  read: () => ThemeChoice
  write: (choice: ThemeChoice) => void
}

// Storage throws in a private window; the theme is a convenience, so a failure follows the
// system rather than breaking the app.
export const themeStore = (key: string, storage: Storage | undefined): ThemeStore => ({
  read: () => {
    try {
      return parseThemeChoice(storage?.getItem(key))
    } catch {
      return 'system'
    }
  },
  write: (choice) => {
    try {
      if (choice === 'system') storage?.removeItem(key)
      else storage?.setItem(key, choice)
    } catch {
      // Ignore: the choice applies for this page load only.
    }
  },
})
