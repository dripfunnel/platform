'use client'

import { useEffect, useRef } from 'react'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Bad = () => {
  const { t } = useStorefront()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let up: HTMLElement | null = null
    if (!box.current) return
    ;({ parentElement: up } = box.current)
    up?.focus()
  }, [])
  return <div ref={box}>{t('pages.home.title')}</div>
}
