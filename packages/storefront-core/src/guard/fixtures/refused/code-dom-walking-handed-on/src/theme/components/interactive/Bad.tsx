'use client'

import { useRef } from 'react'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const box = useRef<HTMLDivElement>(null)
  const first = (n: { children: unknown[] }) => n.children[0]
  const peek = () => box.current && first(box.current)
  return <div ref={box}>{t('pages.home.title')}</div>
}
