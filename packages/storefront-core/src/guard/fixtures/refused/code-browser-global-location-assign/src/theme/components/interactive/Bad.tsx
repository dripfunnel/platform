'use client'

import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const go = () => { location.href = '/our-story' }
  return <p>{t('pages.home.title')}</p>
}
