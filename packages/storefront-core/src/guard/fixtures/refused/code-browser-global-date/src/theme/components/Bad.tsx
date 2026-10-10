import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const now = Date.now()
  return <p>{t('pages.home.title')}</p>
}
