import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <p className="relative z-[999]">{t('pages.home.title')}</p>
}
