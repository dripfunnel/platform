export type Money = { amount: number; currency: string }

const digitsByCurrency = new Map<string, number>()

/** How many minor-unit digits a currency has, from Intl: yen has none, dinars three. Remembered, as forms ask on every keystroke. */
export const moneyDigits = (currency: string): number => {
  const known = digitsByCurrency.get(currency)
  if (known !== undefined) return known
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  digitsByCurrency.set(currency, digits)
  return digits
}

/** Integer minor units and their currency as a price. A fraction of a minor unit is a bug upstream, so it throws. */
export const formatMoney = ({ amount, currency }: Money, locale: string): string => {
  if (!Number.isSafeInteger(amount)) throw new RangeError(`Money is integer minor units, not ${amount}.`)
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount / 10 ** moneyDigits(currency))
}

/** Minor units as a field shows them to be edited: "49.00", or "4900" for yen. */
export const moneyText = ({ amount, currency }: Money): string => (amount / 10 ** moneyDigits(currency)).toFixed(moneyDigits(currency))

/**
 * What was typed in major units ("49", "49.00", or "49,50" from a comma keyboard) as the currency's minor units; empty is
 * unpriced; anything else, including more decimals than the currency has and a thousands separator, is invalid.
 */
export const minorOf = (text: string, currency: string): number | null | 'invalid' => {
  const trimmed = text.trim().replace(/^(\d+),(\d+)$/, '$1.$2')
  if (trimmed === '') return null
  const digits = moneyDigits(currency)
  if (!new RegExp(`^\\d{1,9}${digits > 0 ? `(\\.\\d{1,${digits}})?` : ''}$`).test(trimmed)) return 'invalid'
  const [whole = '0', fraction = ''] = trimmed.split('.')
  return Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0')
}
