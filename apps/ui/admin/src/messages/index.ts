import { formatDateTime, formatDuration, formatNumber, pluralForm } from '@dripfunnel/shared/format'
import en from './en.json'

export const messages = en

export const locale = 'en'

// Every time in the console is shown in UTC, named, as the prototype does (decided on #18).
export const timeZone = 'UTC'

export const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (placeholder, key: string) => values[key] ?? placeholder)

export const formatCount = (count: number): string => formatNumber(count, locale)

export const plural = (forms: { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>, count: number): string => pluralForm(locale, forms, count)

export const formatTime = (iso: string): string => formatDateTime(iso, locale, timeZone)

export const formatWait = (seconds: number): string => formatDuration(seconds, locale)

const dateFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone })

// A day, not a moment: shown without a time, so it needs no zone name beside it.
export const formatDate = (iso: string): string => dateFormat.format(new Date(iso))

const regionNames = new Intl.DisplayNames(locale, { type: 'region' })

export const formatCountry = (code: string): string => regionNames.of(code) ?? code
