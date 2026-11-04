import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  return <p className="transition hover:opacity-80">{t('pages.home.title')}</p>
}
