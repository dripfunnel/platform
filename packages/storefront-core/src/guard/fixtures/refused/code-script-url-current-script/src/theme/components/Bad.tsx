import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const here = document.currentScript
  return <p>{t('pages.home.title')}</p>
}
