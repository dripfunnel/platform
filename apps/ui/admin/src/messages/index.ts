import en from './en.json'

export const messages = en

export const locale = 'en'

export const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (placeholder, key: string) => values[key] ?? placeholder)

export const formatCount = (count: number): string => new Intl.NumberFormat(locale).format(count)
