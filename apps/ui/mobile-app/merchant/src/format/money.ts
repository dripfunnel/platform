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

/** Minor units, as the API's digit string, shown to be edited: "49.00", or "4900" for yen. Digit arithmetic, so no amount loses precision. */
export const moneyText = ({ amount, currency }: { amount: string; currency: string }): string => {
  const digits = moneyDigits(currency)
  if (digits === 0) return amount
  const negative = amount.startsWith('-')
  const padded = amount.replace(/^-/, '').padStart(digits + 1, '0')
  return `${negative ? '-' : ''}${padded.slice(0, -digits)}.${padded.slice(-digits)}`
}

/**
 * What was typed in major units ("49", "49.00", or "49,50" from a comma keyboard) as the currency's minor units, in the digits the
 * API takes; empty is unpriced; anything else, including more decimals than the currency has and a thousands separator, is invalid.
 */
export const minorOf = (text: string, currency: string): string | null | 'invalid' => {
  const trimmed = text.trim().replace(/^(\d+),(\d+)$/, '$1.$2')
  if (trimmed === '') return null
  const digits = moneyDigits(currency)
  const shape = digits > 0 ? new RegExp(`^\\d{1,15}(\\.\\d{1,${digits}})?$`) : /^\d{1,15}$/
  if (!shape.test(trimmed)) return 'invalid'
  const [whole = '0', fraction = ''] = trimmed.split('.')
  return `${whole}${fraction.padEnd(digits, '0')}`.replace(/^0+(?=\d)/, '')
}
