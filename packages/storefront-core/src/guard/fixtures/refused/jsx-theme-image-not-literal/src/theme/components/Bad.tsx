import { ThemeImage, useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = ({ name }: { name: string }) => {
  const { t } = useStorefront()
  return <ThemeImage src={name} alt={t('pages.home.title')} ratio={1.5} />
}
