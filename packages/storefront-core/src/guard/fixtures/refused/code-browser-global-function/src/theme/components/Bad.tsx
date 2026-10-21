import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const run = new Function('return 1')
  return <p>{t('pages.home.title')}</p>
}
