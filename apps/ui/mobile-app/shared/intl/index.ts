// REACT-NATIVE.md §6: Hermes' Intl is built on the phone's APIs, so the app loads FormatJS first. Each
// `polyfill.js` replaces its Intl member only where its own shouldPolyfill check says the engine lacks it,
// and each locale-data file registers only for a polyfill that is active. Data is for the shipped language.
// Import this before anything that formats (`app/_layout.tsx`).
import '@formatjs/intl-getcanonicallocales/polyfill.js'
import '@formatjs/intl-locale/polyfill.js'
import '@formatjs/intl-pluralrules/polyfill.js'
import '@formatjs/intl-pluralrules/locale-data/en.js'
import '@formatjs/intl-numberformat/polyfill.js'
import '@formatjs/intl-numberformat/locale-data/en.js'
import '@formatjs/intl-listformat/polyfill.js'
import '@formatjs/intl-listformat/locale-data/en.js'

const isNative = (member: unknown): boolean => typeof member === 'function' && /\[native code\]/.test(Function.prototype.toString.call(member))

/** The Intl members this engine got from FormatJS instead of its own: what the Hermes check records. */
export const polyfilledIntl = (): string[] =>
  Object.entries({
    getcanonicallocales: Intl.getCanonicalLocales,
    locale: Intl.Locale,
    pluralrules: Intl.PluralRules,
    numberformat: Intl.NumberFormat,
    listformat: Intl.ListFormat,
  })
    .filter(([, member]) => !isNative(member))
    .map(([name]) => name)
