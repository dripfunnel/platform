import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const helpers = [Object].map((o) => o.assign({}, { a: 1 }))
  return <p data-n={helpers.length}>{t('pages.home.title')}</p>
}
