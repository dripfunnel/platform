import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const where = location.pathname
  return <p>{t('pages.home.title')}</p>
}
