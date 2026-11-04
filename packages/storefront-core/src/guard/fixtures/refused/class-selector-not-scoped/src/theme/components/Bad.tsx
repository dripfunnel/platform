import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <p className="[body_&]:hidden">{t('pages.home.title')}</p>
}
