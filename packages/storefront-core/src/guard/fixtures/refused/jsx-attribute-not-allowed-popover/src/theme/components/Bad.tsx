import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <div popover="manual">{t('pages.home.title')}</div>
}
