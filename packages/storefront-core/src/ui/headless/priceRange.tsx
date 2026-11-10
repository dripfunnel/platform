'use client'

import { lazy, Suspense, type ComponentType } from 'react'
import type { PriceRangeProps } from './priceRangeSlider'

export type { PriceRangeParts, PriceRangeProps } from './priceRangeSlider'

// Its own chunk, fetched by the first page that shows it: only listings do, and every page counts what it downloads (guard/gate/checks.ts pageBudgets).
// A chunk that fails to arrive (offline, or gone after a new build) leaves the filter out instead of breaking the page.
const Slider = lazy<ComponentType<PriceRangeProps>>(() => import('./priceRangeSlider').then((m) => ({ default: m.PriceRangeSlider }), () => ({ default: () => null })))

/** The price filter: a two-thumb slider over round prices, with a lowest and highest choice under it. Nothing until it loads. */
export const PriceRange = (props: PriceRangeProps) => (
  <Suspense fallback={null}>
    <Slider {...props} />
  </Suspense>
)
