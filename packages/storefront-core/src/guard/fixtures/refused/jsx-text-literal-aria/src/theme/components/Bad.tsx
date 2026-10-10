import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <button type="button" aria-label="Close">{t('pages.home.title')}</button>
}
