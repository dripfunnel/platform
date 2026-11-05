import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <p className="flex shiny-card">{t('pages.home.title')}</p>
}
