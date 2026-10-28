import en from './en.json'

type Tree = { [key: string]: string | Tree }

// A language the store offers but has no file here is spoken in English; adding `hi.json` here is all `hi` needs.
const catalogues: Record<string, Tree> = { en }

/** The language of the app's own words and numbers: the shopper's, when there is a catalogue for it, else English. Live, so a screen that reads it after `setLanguage` sees the new one. */
export let locale = 'en'

/** The catalogue a store language (`hi-IN`, `en`) is spoken from, or null when the app has none for it. */
export const catalogueFor = (language: string | null): string | null => {
  const base = language?.toLowerCase().split('-')[0] ?? ''
  return base in catalogues ? base : null
}

export const setLanguage = (language: string | null): void => {
  locale = catalogueFor(language) ?? 'en'
}

type Paths<T, Prefix extends string = ''> = { [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Paths<T[K], `${Prefix}${K}.`> }[keyof T & string]

export type MessageKey = Paths<typeof en>

type Values = Readonly<Record<string, string | number>>

const find = (tree: Tree | undefined, key: string): string | undefined => {
  const found = key.split('.').reduce<unknown>((node, part) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined), tree)
  return typeof found === 'string' ? found : undefined
}

const lookup = (key: string): string => find(catalogues[locale], key) ?? find(en, key) ?? key

const fill = (text: string, values: Values): string => text.replace(/\{(\w+)\}/g, (placeholder, name: string) => (name in values ? String(values[name]) : placeholder))

/** The words for a key, with `{name}` filled from `values`. A placeholder with no value stays visible, never blank. */
export const t = (key: MessageKey, values: Values = {}): string => fill(lookup(key), values)
