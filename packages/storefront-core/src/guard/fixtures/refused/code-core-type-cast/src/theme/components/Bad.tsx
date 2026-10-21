import { Price, useStorefront, type Money } from '@dripfunnel/storefront-core/theme'

export const Bad = ({ money }: { money: Money }) => {
  const { t, locale } = useStorefront()
  const cheaper = { amount: money.currency, currency: money.currency } as Money

  return <Price money={cheaper} includesTax={false} locale={locale} t={t} />
}
