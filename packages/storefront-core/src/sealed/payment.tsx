'use client'

import { useCallback } from 'react'
import { useCheckoutState } from '../checkout/checkout'
import type { Translate } from '../platform/i18n/i18n'
import { useStorefront } from '../platform/store/context'
import { formatMoney } from '../pricing/money'
import { Sealed } from './Sealed'

// The payment element (storefront ARCHITECTURE §2.1 `sealed`, §3.3 "Broken checkout"): where the provider draws its own
// field or buttons, core's Pay, the preview's test-mode note and how the payment stands. In the studio frame, which loads
// no payment provider (§3.5), only its placeholder. Parts: panel, test, instructions, field, button, status.

export const PaymentElement = ({ t, className }: { t: Translate; className?: string }) => {
  const { mode, locale } = useStorefront()
  const { store, state } = useCheckoutState()
  const host = useCallback((el: HTMLDivElement | null) => store.set({ host: el }), [store])
  if (mode === 'studio') {
    return (
      <Sealed part="payment" className={className}>
        <p part="panel status">{t('payment.studio')}</p>
      </Sealed>
    )
  }
  const { phase } = state
  return (
    <Sealed part="payment" className={className}>
      <section part="panel" aria-label={t('payment.label')}>
        {mode !== 'live' ? (
          <p part="test">
            {t('payment.test')} {state.chosen === 'stripe' ? t('payment.testCard') : null}
          </p>
        ) : null}
        {state.instructions && phase.kind === 'idle' ? <p part="instructions">{state.instructions}</p> : null}
        <div part="field" ref={host} />
        {phase.kind === 'paying' && phase.submit ? (
          <button type="button" part="button" onClick={phase.submit}>
            {t('payment.pay', { amount: formatMoney(phase.amount, locale) })}
          </button>
        ) : null}
        {phase.kind === 'placing' || phase.kind === 'confirming' ? (
          <p part="status" role="status">
            {t(phase.kind === 'placing' ? 'payment.placing' : 'payment.processing')}
          </p>
        ) : null}
        {phase.kind === 'failed' ? (
          <p part="status" role="alert">
            {phase.message ?? t('payment.failed')}
          </p>
        ) : null}
      </section>
    </Sealed>
  )
}
