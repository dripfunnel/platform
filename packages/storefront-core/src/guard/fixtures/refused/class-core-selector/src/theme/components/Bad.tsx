import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <p className="[&_.df-price]:hidden">{t('pages.home.title')}</p>
}
