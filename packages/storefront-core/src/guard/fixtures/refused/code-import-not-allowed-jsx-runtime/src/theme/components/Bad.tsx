import { jsx } from 'react/jsx-runtime'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const el = jsx('script', {})
  return <p>{t('pages.home.title')}</p>
}
