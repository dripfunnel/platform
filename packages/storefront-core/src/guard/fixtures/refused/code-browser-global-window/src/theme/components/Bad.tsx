import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const wide = window.innerWidth > 900
  return <p>{t('pages.home.title')}</p>
}
