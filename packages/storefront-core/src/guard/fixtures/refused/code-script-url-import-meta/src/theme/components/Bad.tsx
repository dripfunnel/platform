import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const here = import.meta.url
  return <p>{t('pages.home.title')}</p>
}
