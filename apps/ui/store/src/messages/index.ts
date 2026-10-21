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

/** A file's size: "17.5 MB", in megabytes of 1,024 × 1,024 bytes. */
export const formatMegabytes = (bytes: number): string => new Intl.NumberFormat(locale, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)

/** A calendar day ("2026-10-05") in the portal's words, read in UTC so no time zone moves it to another day. */
export const formatDay = (day: string): string => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))

/** “a, b and c” as the portal's language joins a list. */
export const formatList = (items: readonly string[]): string => new Intl.ListFormat(locale, { type: 'conjunction' }).format(items)

export const plural = (forms: { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>, count: number): string => pluralForm(locale, forms, count)
