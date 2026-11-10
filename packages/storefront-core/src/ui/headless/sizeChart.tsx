'use client'

import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react'
import { useStorefront } from '../../platform/store/context'
import type { SizeChart as Chart } from '../../products/product'
import type { SizeChartDialogProps } from './sizeChartDialog'

// The product page's size chart (storefront ARCHITECTURE §2.1 `ui/headless`): a link that opens the chart's table in a modal.
// Core draws the <dialog>, since a theme may write none; opened with showModal it sits in the top layer, traps focus and closes on Escape.

export type SizeChartProps = {
  /** `useProduct().product.sizeChart`; draw nothing while it is null. */
  chart: Chart | null
  /** The link's own class. */
  className?: string
}

// Its own chunk, fetched on the first click: every page counts what it downloads (guard/gate/checks.ts pageBudgets).
// A chunk that fails to arrive closes at once, so the next click tries again.
const Failed = ({ onClose }: SizeChartDialogProps) => {
  useEffect(onClose, [onClose])
  return null
}
const Dialog = lazy<ComponentType<SizeChartDialogProps>>(() => import('./sizeChartDialog').then((m) => ({ default: m.SizeChartDialog }), () => ({ default: Failed })))

/** A "Size chart" link and, once chosen, the chart in a modal. Only the link is in built HTML. */
export const SizeChart = ({ chart, className }: SizeChartProps) => {
  const { t } = useStorefront()
  const [open, setOpen] = useState(false)
  const link = useRef<HTMLButtonElement>(null)
  if (!chart) return null

  const shut = () => {
    setOpen(false)
    link.current?.focus()
  }

  return (
    <>
      <button ref={link} type="button" className={className} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {t('sizeChart.open')}
      </button>
      {open ? (
        <Suspense fallback={null}>
          <Dialog chart={chart} onClose={shut} />
        </Suspense>
      ) : null}
    </>
  )
}
