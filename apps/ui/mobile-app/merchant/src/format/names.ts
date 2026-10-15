const lookup = (locale: string, type: 'region' | 'language', code: string): string => {
  // Hermes may not carry Intl.DisplayNames (REACT-NATIVE.md §6); the code stands in for the name rather than throwing.
  if (typeof Intl.DisplayNames !== 'function') return code
  try {
    return new Intl.DisplayNames([locale], { type }).of(code) ?? code
  } catch {
    return code
  }
}

/** A country's name in the app's language from its two-letter code ("India" for "IN"); the code itself when the engine can't say. */
export const regionName = (code: string, locale: string): string => lookup(locale, 'region', code)

/** A language's name from its code ("Hindi (India)" for "hi-IN"); the code itself when the engine can't say. */
export const languageName = (code: string, locale: string): string => lookup(locale, 'language', code)
