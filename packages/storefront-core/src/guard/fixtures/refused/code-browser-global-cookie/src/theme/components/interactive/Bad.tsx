'use client'

import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const read = () => document.cookie
  return <p>{t('pages.home.title')}</p>
}
