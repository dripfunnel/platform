export type Money = { amount: number; currency: string }

/** Integer minor units and their currency as a price. A fraction of a minor unit is a bug upstream, so it throws. */
export const formatMoney = ({ amount, currency }: Money, locale: string): string => {
  if (!Number.isSafeInteger(amount)) throw new RangeError(`Money is integer minor units, not ${amount}.`)
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency })
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2
  return formatter.format(amount / 10 ** digits)
}
