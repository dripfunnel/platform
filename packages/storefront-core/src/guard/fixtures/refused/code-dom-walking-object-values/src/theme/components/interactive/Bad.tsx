'use client'

import { useEffect, useRef } from 'react'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!box.current) return
    for (const v of Object.values(box.current)) v.return.stateNode.remove()
  }, [])
  return <div ref={box}>{t('pages.home.title')}</div>
}
