import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <p className="before:content-['Sale']">{t('pages.home.title')}</p>
}
