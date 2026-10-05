import { formatDateTime, formatDuration, formatNumber, pluralForm } from '@dripfunnel/shared/format'
import en from './en.json'

export const messages = en

export const locale = 'en'

export const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (placeholder, key: string) => values[key] ?? placeholder)

// UTC and named, until the store's own time zone reaches the portal (AGENTS.md "Data").
export const formatTime = (iso: string): string => formatDateTime(iso, locale, 'UTC')

export const formatWait = (seconds: number): string => formatDuration(seconds, locale)

export const formatCount = (count: number): string => formatNumber(count, locale)

/** “a, b and c” as the portal's language joins a list. */
export const formatList = (items: readonly string[]): string => new Intl.ListFormat(locale, { type: 'conjunction' }).format(items)

export const plural = (forms: { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>, count: number): string => pluralForm(locale, forms, count)
