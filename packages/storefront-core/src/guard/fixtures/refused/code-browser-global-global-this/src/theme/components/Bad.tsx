import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const g = globalThis
  return <p>{t('pages.home.title')}</p>
}
