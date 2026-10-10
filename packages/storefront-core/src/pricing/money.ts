import { z } from 'zod'
import type { Branded } from './brand'

/** Money as the Shop API sends it, minor units as a string with its currency (AGENTS.md "Money"); only core's decoder makes one. */
export type Money = Branded<{ amount: string; currency: string }, 'Money'>

const minorUnits = /^-?\d+$/

/** The decoder every Shop API operation uses for money, so a malformed amount fails as BAD_RESPONSE, not in a render. */
export const moneySchema = z
  .object({ amount: z.string().regex(minorUnits), currency: z.string().regex(/^[A-Z]{3}$/) })
  .transform((m) => m as Money)

const formatters = new Map<string, Intl.NumberFormat>()
const formatter = (locale: string, currency: string) => {
  const key = `${locale}|${currency}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: 'currency', currency })
    formatters.set(key, f)
  }
  return f
}

const fractionDigits = (currency: string): number => formatter('en', currency).resolvedOptions().maximumFractionDigits ?? 2

/** The amount as a major-unit decimal string ("19.99", JPY "1200"), exact past 2^53 minor units. */
export const toDecimal = ({ amount, currency }: Money): string => {
  if (!minorUnits.test(amount)) throw new Error(`Not a minor-unit amount: "${amount}"`)
  const digits = fractionDigits(currency)
  const minor = BigInt(amount)
  const abs = minor < 0n ? -minor : minor
  const scale = 10n ** BigInt(digits)
  const whole = `${minor < 0n ? '-' : ''}${abs / scale}`
  return digits === 0 ? whole : `${whole}.${(abs % scale).toString().padStart(digits, '0')}`
}

/** The amount in the shopper's locale, the currency always shown (never a silent default). */
export const formatMoney = (money: Money, locale: string): string => formatter(locale, money.currency).format(toDecimal(money) as `${number}`)
