'use client'

import type { ReactNode } from 'react'
import { useStorefront } from '../platform/store/context'
import { DrawnByCore, useThemePlacedAgeBox } from '../sealed/ageBox'
import { AgeConfirmation } from '../sealed/components'
import type { CheckoutPage } from './checkout'

// "Place order" (DESIGN §6: placing the order is core's): the theme words and styles it; core places the order, or asks for
// another attempt after a declined or abandoned payment, and marks it for the checkout smoke test (ARCHITECTURE §4.2).

// A theme that doesn't place <AgeConfirmation> still gets the box, drawn just above the button (#1443).
const AgeFallback = ({ checkout }: { checkout: CheckoutPage }) => {
  const { t } = useStorefront()
  return (
    <DrawnByCore.Provider value>
      <AgeConfirmation needed checked={checkout.ageConfirmed} onChange={checkout.confirmAge} t={t} />
    </DrawnByCore.Provider>
  )
}

export const PlaceOrder = ({ checkout, children, again, className }: { checkout: CheckoutPage; children: ReactNode; again: ReactNode; className?: string }) => {
  const { phase } = checkout
  const themePlacedBox = useThemePlacedAgeBox()
  const retry = phase.kind === 'failed' && phase.orderId !== null
  if (phase.kind === 'paying' || phase.kind === 'confirming' || phase.kind === 'leaving') return null
  return (
    <>
      {checkout.needsAgeConfirmation && !themePlacedBox ? <AgeFallback checkout={checkout} /> : null}
      <button type="button" className={className} data-df-action="place-order" disabled={checkout.mode === 'studio' || phase.kind === 'placing' || !checkout.chosen || (checkout.needsAgeConfirmation && !checkout.ageConfirmed)} onClick={() => void (retry ? checkout.payAgain() : checkout.place())}>
        {retry ? again : children}
      </button>
    </>
  )
}
