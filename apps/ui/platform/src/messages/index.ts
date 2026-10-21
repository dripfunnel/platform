import { formatDateTime, formatDuration, formatMoney, formatNumber, pluralForm, type Money } from '@dripfunnel/shared/format'
import en from './en.json'

export const messages = en

export const locale = 'en'

export const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (placeholder, key: string) => values[key] ?? placeholder)

// UTC and named, until the store's own time zone reaches the portal (AGENTS.md "Data").
export const formatTime = (iso: string): string => formatDateTime(iso, locale, 'UTC')

export const formatWait = (seconds: number): string => formatDuration(seconds, locale)

export const formatCount = (count: number): string => formatNumber(count, locale)

const dateFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

const listFormat = new Intl.ListFormat(locale, { type: 'conjunction' })
const regionNames = new Intl.DisplayNames([locale], { type: 'region' })

// A country by its ISO code ("US" → "United States"), as the API sends it; anything else as given.
export const formatCountry = (code: string): string => {
  try {
    return regionNames.of(code) ?? code
  } catch {
    return code
  }
}

export const formatList = (items: readonly string[]): string => listFormat.format(items)

const monthFormat = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' })

// A report's month, as the API sends it (its first day, UTC).
export const formatMonth = (iso: string): string => monthFormat.format(new Date(iso))

// A day, not a moment: shown without a time, so it needs no zone name beside it.
export const formatDate = (iso: string): string => dateFormat.format(new Date(iso))

export const formatAmount = (money: Money): string => formatMoney(money, locale)

// A share the API sends in basis points (1/100 of a percent), shown as a percent; `signed` puts + on a rise.
export const formatBps = (bps: number, signed = false): string =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1, ...(signed ? { signDisplay: 'exceptZero' as const } : {}) }).format(bps / 10_000)

export const plural = (forms: { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>, count: number): string => pluralForm(locale, forms, count)
