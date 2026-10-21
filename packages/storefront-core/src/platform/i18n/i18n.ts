import { catalogues, en, type Catalogue, type MessageKey } from './messages'

// A theme's own keys (`home.hero.title`) are checked against content/** by the validator, so any string is accepted.
export type Translate = (key: MessageKey | (string & Record<never, never>), values?: Record<string, string | number>) => string

const pluralBlock = /\{(\w+), plural, ((?:[^{}]|\{[^{}]*\})*)\}/g

const formatMessage = (template: string, locale: string, values: Record<string, string | number>): string =>
  template
    .replace(pluralBlock, (_, name: string, cases: string) => {
      const n = Number(values[name] ?? 0)
      const options = Object.fromEntries([...cases.matchAll(/(=\d+|\w+) \{([^{}]*)\}/g)].map((m) => [m[1], m[2] ?? '']))
      const chosen = options[`=${n}`] ?? options[new Intl.PluralRules(locale).select(n)] ?? options.other ?? ''
      return chosen.replace(/#/g, new Intl.NumberFormat(locale).format(n))
    })
    .replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole))

/** The words the studio frame has shown, each with its content key (`home:hero.title`), for Edit text (AI-STUDIO §8). */
export type TextKeys = { add: (text: string, key: string) => void; keyOf: (text: string) => string | null }

const contentKey = /^([a-z][a-z0-9-]{0,40})\.([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,9})$/
const words = (text: string) => text.replace(/\s+/g, ' ').trim()

/** An empty map; the first key to show some words keeps them, so identical words resolve to the first. */
export const createTextKeys = (): TextKeys => {
  const keys = new Map<string, string>()
  return {
    add: (text, key) => {
      const m = contentKey.exec(key)
      const shown = words(text)
      if (m && shown && !keys.has(shown)) keys.set(shown, `${m[1]}:${m[2]}`)
    },
    keyOf: (text) => keys.get(words(text)) ?? null,
  }
}

/**
 * A translator for a locale such as "hi-IN": its catalogue, the base language's, then English. With `shown` (the studio
 * frame only), each string taken from the theme's own content is remembered with its key.
 */
export const createI18n = (locale: string, extra: Record<string, Catalogue> = {}, shown?: TextKeys): { locale: string; t: Translate } => {
  const base = locale.split('-')[0] ?? 'en'
  const own = [extra[locale], extra[base]]
  const chain: Catalogue[] = [extra[locale], catalogues[locale], extra[base], catalogues[base]].filter((c): c is Catalogue => c !== undefined)
  const t: Translate = (key, values = {}) => {
    const id = key as MessageKey
    const from = chain.find((c) => c[id] !== undefined)
    const text = formatMessage(from?.[id] ?? en[id] ?? key, locale, values)
    if (shown && from && own.includes(from)) shown.add(text, key)
    return text
  }
  return { locale, t }
}
