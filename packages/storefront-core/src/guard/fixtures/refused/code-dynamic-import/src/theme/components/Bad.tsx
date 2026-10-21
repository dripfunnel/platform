import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const later = () => import('./Shell')
  return <p>{t('pages.home.title')}</p>
}
