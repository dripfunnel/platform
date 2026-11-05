import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <p className="duration-300">{t('pages.home.title')}</p>
}
