'use client'

import { useEffect, useRef, useState } from 'react'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

type Place = { location: string; history: number; top: number }

export const Sticky = ({ place }: { place: Place }) => {
  const { t } = useStorefront()
  const box = useRef<HTMLDivElement>(null)
  const [high, setHigh] = useState(false)
  useEffect(() => {
    if (!box.current) return
    const rect = box.current.getBoundingClientRect()
    const { top } = rect
    setHigh(rect.top < 0 || top < place.top || place.history > 1)
  }, [place])
  return (
    <div ref={box} data-high={high} data-at={place.location}>
      {t('pages.home.title')}
    </div>
  )
}
