import { storeConfig } from '../../../store.config'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const key = storeConfig.shopApi
  return <p>{t('pages.home.title')}</p>
}
