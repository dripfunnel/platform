'use client'

import { useEffect, useRef } from 'react'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!box.current) return
    box.current.style.setProperty('z-index', '2147483647')
  }, [])
  return <div ref={box}>{t('pages.home.title')}</div>
}
