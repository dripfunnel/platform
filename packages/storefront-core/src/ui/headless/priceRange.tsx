'use client'

import { lazy, Suspense } from 'react'
import type { PriceRangeProps } from './priceRangeSlider'

export type { PriceRangeParts, PriceRangeProps } from './priceRangeSlider'

// Its own chunk, fetched by the first page that shows it: only listings do, and every page counts what it downloads (guard/gate/checks.ts pageBudgets).
const Slider = lazy(async () => ({ default: (await import('./priceRangeSlider')).PriceRangeSlider }))

/** The price filter: a two-thumb slider over round prices, with a lowest and highest choice under it. Nothing until it loads. */
export const PriceRange = (props: PriceRangeProps) => (
  <Suspense fallback={null}>
    <Slider {...props} />
  </Suspense>
)
