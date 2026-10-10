'use client'

import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const tell = () => postMessage('x')
  return <p>{t('pages.home.title')}</p>
}
