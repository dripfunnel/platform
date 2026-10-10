import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <p>{t('pages.home.title', { count: 3 })}</p>
}
