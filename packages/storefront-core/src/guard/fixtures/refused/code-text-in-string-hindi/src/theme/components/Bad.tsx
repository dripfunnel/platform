import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const words = ['नया']
  return <p>{t('pages.home.title')}</p>
}
