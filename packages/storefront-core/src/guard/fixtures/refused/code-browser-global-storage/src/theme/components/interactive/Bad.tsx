'use client'

import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const keep = () => localStorage.setItem('k', 'v')
  return <p>{t('pages.home.title')}</p>
}
