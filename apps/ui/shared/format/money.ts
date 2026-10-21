export type Money = { amount: number; currency: string }

export const formatMoney = ({ amount, currency }: Money, locale: string) => {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency })
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2
  return formatter.format(amount / 10 ** digits)
}

const digitsByCurrency = new Map<string, number>()

/**
 * How many minor-unit digits a currency has, from Intl, so a 0-decimal currency is typed and shown in whole units.
 * Remembered per currency: forms ask on every keystroke, and building a formatter each time is slow.
 */
export const moneyDigits = (currency: string): number => {
  const known = digitsByCurrency.get(currency)
  if (known !== undefined) return known
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  digitsByCurrency.set(currency, digits)
  return digits
}

/** Minor units as a form field shows them: "49.00", or "4900" for yen. */
export const moneyText = ({ amount, currency }: Money): string => {
  const digits = moneyDigits(currency)
  return (amount / 10 ** digits).toFixed(digits)
}

/** "49" or "49.00" in major units to the currency's minor units; empty is unpriced; anything else is invalid. */
export const minorOf = (text: string, currency: string): number | null | 'invalid' => {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const digits = moneyDigits(currency)
  if (!new RegExp(`^\\d{1,7}${digits > 0 ? `(\\.\\d{1,${digits}})?` : ''}$`).test(trimmed)) return 'invalid'
  const [whole = '0', fraction = ''] = trimmed.split('.')
  return Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0')
}
