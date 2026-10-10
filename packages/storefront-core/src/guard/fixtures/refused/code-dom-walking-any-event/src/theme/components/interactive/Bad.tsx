'use client'

import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  return (
    <button type="button" onClick={(e: any) => {
      e.target.onclick = null
    }}>
      {t('pages.home.title')}
    </button>
  )
}
