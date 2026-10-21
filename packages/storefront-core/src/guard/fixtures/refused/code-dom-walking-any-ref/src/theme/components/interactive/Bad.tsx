'use client'

import { useEffect, useRef } from 'react'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const box = useRef<any>(null)
  useEffect(() => {
    box.current.style.position = 'fixed'
  }, [])
  return <div ref={box}>{t('pages.home.title')}</div>
}
