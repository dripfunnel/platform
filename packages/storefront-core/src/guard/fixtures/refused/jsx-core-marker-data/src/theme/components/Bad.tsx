import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <p data-df-required="price">{t('pages.home.title')}</p>
}
