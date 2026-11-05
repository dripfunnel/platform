'use client'

import { animate } from 'motion/react'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()

  const press = () => {
    void animate('.card', { opacity: 0 })
  }
  return (
    <button type="button" onClick={press}>
      {t('pages.home.title')}
    </button>
  )
}
