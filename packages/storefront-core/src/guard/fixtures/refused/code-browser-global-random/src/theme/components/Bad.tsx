import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const pick = Math.random()
  return <p>{t('pages.home.title')}</p>
}
