'use client'

import { useLayoutEffect, useState, type ReactNode } from 'react'
import { Boundary } from '../platform/render/boundary'

const key = 'df-baseline-checkout'

const switched = (): boolean => {
  try {
    return globalThis.sessionStorage?.getItem(key) === '1'
  } catch {
    return false
  }
}

const rememberSwitch = () => {
  try {
    globalThis.sessionStorage?.setItem(key, '1')
  } catch {
    // Without storage the switch holds until the page reloads, and the boundary catches the theme again.
  }
}

/**
 * The theme's checkout, until it throws: then that shopper gets the baseline checkout for the rest of
 * their visit (ARCHITECTURE §2.1 `checkout`, §3.3). `baseline` is the checkout #313 writes.
 */
export const CheckoutBoundary = ({ baseline, children }: { baseline: ReactNode; children: ReactNode }) => {
  const [baselineOnly, setBaselineOnly] = useState(false)
  // Before paint, so a shopper already switched never sees the theme's checkout; after hydration, so the server's HTML matches.
  useLayoutEffect(() => setBaselineOnly(switched()), [])
  if (baselineOnly) return baseline
  return (
    <Boundary kind="checkout" name="checkout" baseline={baseline} onFail={rememberSwitch}>
      {children}
    </Boundary>
  )
}
