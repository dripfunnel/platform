import { createElement } from 'react'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const el = createElement('script')
  return <p>{t('pages.home.title')}</p>
}
