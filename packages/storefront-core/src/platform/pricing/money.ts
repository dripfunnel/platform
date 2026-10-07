/** Money as the Shop API sends it: minor units as a string, with its currency (AGENTS.md "Money"). */
export type ShopMoney = { amount: string; currency: string }

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

/** The amount in the shopper's locale, the currency always shown (never a silent default). */
export const formatMoney = ({ amount, currency }: ShopMoney, locale: string): string => {
  const f = formatter(locale, currency)
  const digits = f.resolvedOptions().maximumFractionDigits ?? 2
  const minor = BigInt(amount)
  const sign = minor < 0n ? -1n : 1n
  const abs = minor * sign
  const scale = 10n ** BigInt(digits)
  // Whole and fraction kept apart so amounts beyond 2^53 minor units stay exact.
  const whole = `${sign < 0n ? '-' : ''}${abs / scale}`
  const major = digits === 0 ? whole : `${whole}.${(abs % scale).toString().padStart(digits, '0')}`
  return f.format(major as `${number}`)
}
