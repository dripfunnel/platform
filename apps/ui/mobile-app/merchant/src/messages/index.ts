import en from './en.json'

export const locale = 'en'

type Paths<T, Prefix extends string = ''> = { [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Paths<T[K], `${Prefix}${K}.`> }[keyof T & string]

export type MessageKey = Paths<typeof en>

type Values = Readonly<Record<string, string | number>>

const lookup = (key: string): string => {
  const found = key.split('.').reduce<unknown>((node, part) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined), en)
  return typeof found === 'string' ? found : key
}

const fill = (text: string, values: Values): string => text.replace(/\{(\w+)\}/g, (placeholder, name: string) => (name in values ? String(values[name]) : placeholder))

/** The words for a key, with `{name}` filled from `values`. A placeholder with no value stays visible, never blank. */
export const t = (key: MessageKey, values: Values = {}): string => fill(lookup(key), values)

/** The words for a key that may not exist (an error code with no wording of its own): undefined, never the key itself. */
export const tryT = (key: string, values: Values = {}): string | undefined => {
  const found = lookup(key)
  return found === key ? undefined : fill(found, values)
}
