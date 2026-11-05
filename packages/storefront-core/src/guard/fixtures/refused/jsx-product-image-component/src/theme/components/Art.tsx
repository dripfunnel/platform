import { MerchantImage as Picture, useStorefront } from '@dripfunnel/storefront-core/theme'

export const Art = () => {
  const { t } = useStorefront()
  return <Picture asset={t('pages.home.lead')} alt={t('pages.home.title')} ratio={1} />
}
