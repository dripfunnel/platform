'use client'

import { useRef } from 'react'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const box = useRef<HTMLDivElement>(null)
  const paint = () => { if (box.current) box.current.style.backgroundImage = 'none' }
  return <div ref={box}>{t('pages.home.title')}</div>
}
