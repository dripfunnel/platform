import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const n = 1
  return <p id={`df-${n}`}>{t('pages.home.title')}</p>
}
