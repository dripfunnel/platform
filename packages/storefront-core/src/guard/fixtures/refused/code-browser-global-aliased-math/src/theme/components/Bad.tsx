import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const M = Math
  const pick = M.random()
  return <p data-pick={pick > 0.5 ? 'a' : 'b'}>{t('pages.home.title')}</p>
}
