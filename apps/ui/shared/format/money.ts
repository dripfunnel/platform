export type Money = { amount: number; currency: string }

export const formatMoney = ({ amount, currency }: Money, locale: string) => {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency })
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2
  return formatter.format(amount / 10 ** digits)
}
