import en from './en.json'

export const locale = 'en'

type Paths<T, Prefix extends string = ''> = { [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Paths<T[K], `${Prefix}${K}.`> }[keyof T & string]

export type MessageKey = Paths<typeof en>

const lookup = (key: string): string => {
  const found = key.split('.').reduce<unknown>((node, part) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined), en)
  return typeof found === 'string' ? found : key
}

/** The words for a key, with `{name}` filled from `values`. A placeholder with no value stays visible, never blank. */
export const t = (key: MessageKey, values: Readonly<Record<string, string | number>> = {}): string =>
  lookup(key).replace(/\{(\w+)\}/g, (placeholder, name: string) => (name in values ? String(values[name]) : placeholder))
