'use client'

import type { ReactNode } from 'react'
import type { CheckoutPage } from './checkout'

// "Place order" (DESIGN §6: placing the order is core's): the theme words and styles it; core places the order, or asks for
// another attempt after a declined or abandoned payment, and marks it for the checkout smoke test (ARCHITECTURE §4.2).

export const PlaceOrder = ({ checkout, children, again, className }: { checkout: CheckoutPage; children: ReactNode; again: ReactNode; className?: string }) => {
  const { phase } = checkout
  const retry = phase.kind === 'failed' && phase.orderId !== null
  if (phase.kind === 'paying' || phase.kind === 'confirming') return null
  return (
    <button type="button" className={className} data-df-action="place-order" disabled={checkout.mode === 'studio' || phase.kind === 'placing' || !checkout.chosen} onClick={() => void (retry ? checkout.payAgain() : checkout.place())}>
      {retry ? again : children}
    </button>
  )
}
