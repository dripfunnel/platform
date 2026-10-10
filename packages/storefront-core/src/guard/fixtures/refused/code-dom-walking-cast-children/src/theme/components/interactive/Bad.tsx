'use client'

import { useRef } from 'react'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const box = useRef<HTMLDivElement>(null)
  const kids = () => (box.current as unknown as { children: unknown[] }).children
  return <div ref={box}>{t('pages.home.title')}</div>
}
