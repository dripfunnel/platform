import en from '../../../content/en/pages.json'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const words = en.home
  return <p>{t('pages.home.title')}</p>
}
