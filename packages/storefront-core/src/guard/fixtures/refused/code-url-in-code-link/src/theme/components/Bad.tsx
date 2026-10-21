import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const to = 'javascript:void(0)'
  return <p>{t('pages.home.title')}</p>
}
