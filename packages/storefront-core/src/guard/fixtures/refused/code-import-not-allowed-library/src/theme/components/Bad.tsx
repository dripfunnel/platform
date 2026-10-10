import pick from 'lodash'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const n = pick(1)
  return <p>{t('pages.home.title')}</p>
}
