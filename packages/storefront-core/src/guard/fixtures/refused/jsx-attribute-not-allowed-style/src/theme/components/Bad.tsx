import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <p style={{ color: 'red' }}>{t('pages.home.title')}</p>
}
