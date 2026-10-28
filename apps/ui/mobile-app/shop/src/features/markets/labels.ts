import { languageName } from '@dripfunnel/mobile-shared/format'

/** A language in its own words ("हिन्दी"), so a shopper can find theirs whatever the app is speaking; the code when the engine can't say. */
export const languageLabel = (code: string): string => languageName(code, code)

/** "Indian rupee · INR", or the code alone when this engine has no Intl.DisplayNames (Hermes may not, REACT-NATIVE.md §6). */
export const currencyLabel = (code: string, locale: string): string => {
  try {
    const name = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames([locale], { type: 'currency' }).of(code) : undefined
    return name && name !== code ? `${name} · ${code}` : code
  } catch {
    return code
  }
}
