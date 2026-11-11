import { ThemeImage, useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  return <ThemeImage src="haldi-home.webp" alt={t('pages.home.title')} ratio={1.5} />
}
