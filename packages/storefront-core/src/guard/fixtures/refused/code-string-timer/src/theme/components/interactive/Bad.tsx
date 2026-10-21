'use client'

import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const later = () => setTimeout('alert(1)', 10)
  return <p>{t('pages.home.title')}</p>
}
