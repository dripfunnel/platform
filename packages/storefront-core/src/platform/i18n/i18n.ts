import { catalogues, en, type Catalogue, type MessageKey } from './messages'

export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string

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

/** A translator for a locale such as "hi-IN": its catalogue, the base language's, then English. */
export const createI18n = (locale: string, extra: Record<string, Catalogue> = {}): { locale: string; t: Translate } => {
  const base = locale.split('-')[0] ?? 'en'
  const chain: Catalogue[] = [extra[locale], catalogues[locale], extra[base], catalogues[base]].filter((c): c is Catalogue => c !== undefined)
  const t: Translate = (key, values = {}) => formatMessage(chain.find((c) => c[key] !== undefined)?.[key] ?? en[key], locale, values)
  return { locale, t }
}
