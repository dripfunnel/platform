'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
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

// The switch changes only when this boundary catches, and the boundary then shows the baseline itself.
const unchanging = () => () => undefined
const stored = () => (switched() ? 'baseline' : 'theme')
const unknownOnServer = () => 'unknown' as const

/**
 * The theme's checkout, until it throws: then that shopper gets the baseline checkout for the rest of
 * their visit (ARCHITECTURE §2.1 `checkout`, §3.3). `baseline` is the checkout #313 writes. The server's
 * HTML holds neither, since the switch lives in the browser; there the choice is made before either renders.
 */
export const CheckoutBoundary = ({ baseline, children }: { baseline: ReactNode; children: ReactNode }) => {
  const choice = useSyncExternalStore(unchanging, stored, unknownOnServer)
  if (choice === 'unknown') return null
  if (choice === 'baseline') return baseline
  return (
    <Boundary kind="checkout" name="checkout" baseline={baseline} onFail={rememberSwitch}>
      {children}
    </Boundary>
  )
}
