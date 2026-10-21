import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const look = (o: Record<string, number>, k: string) => o[k]
  return <p>{t('pages.home.title')}</p>
}
