import { ConfirmDialog } from '@dripfunnel/shared/ui'
import type { Stripe, StripeCardElement } from '@stripe/stripe-js'
import { loadStripe } from '@stripe/stripe-js/pure'
import { useEffect, useId, useRef, useState } from 'react'
import { setPaymentMethod, setPayoutAccount, type BillingRefusal } from '../../api/billing'
import { messages } from '../../messages'
import { bankComplete, bankTokenData, needsRouting, type BankFields } from './bankDetails'
const words = messages.settings.payout
const refusals: Record<BillingRefusal, string> = messages.billing.refusals

// Stripe.js is fetched from js.stripe.com when the tab opens, with the key the API answered (#278).
export const stripeFor = (publishableKey: string): Promise<Stripe | null> => loadStripe(publishableKey)

interface DialogProps {
  changing: boolean
  stripe: Promise<Stripe | null>
  onSaved: () => void
  onCancel: () => void
}

// Each dialog sends only Stripe's token; what was typed stays in Stripe.js (THIRD-PARTY-ACCESS §2.7).
const useSave = (onSaved: () => void) => {
  const [error, setError] = useState<string | null>(null)
  const run = async (work: () => Promise<{ ok: true } | { ok: false; reason: BillingRefusal } | string>) => {
    setError(null)
    try {
      const outcome = await work()
      if (typeof outcome === 'string') setError(outcome)
      else if (outcome.ok) onSaved()
      else setError(refusals[outcome.reason])
    } catch {
      setError(words.failed)
    }
  }
  return { error, run }
}

export const BankDialog = ({ changing, country, currency, stripe, onSaved, onCancel }: DialogProps & { country: string; currency: string }) => {
  const ids = { holder: useId(), routing: useId(), number: useId() }
  const [fields, setFields] = useState<BankFields>({ holder: '', routing: '', number: '' })
  const { error, run } = useSave(onSaved)
  const iban = !needsRouting(country)
  const set = (key: keyof BankFields) => (event: { target: { value: string } }) => setFields((f) => ({ ...f, [key]: event.target.value }))
  const save = () =>
    run(async () => {
      const client = await stripe
      if (!client) return words.failed
      const { token, error: refused } = await client.createToken('bank_account', bankTokenData(country, currency, fields))
      return token ? setPayoutAccount(token.id) : (refused?.message ?? words.failed)
    })
  return (
    <ConfirmDialog
      open
      title={changing ? words.account.changeTitle : words.account.addTitle}
      target={words.account.target}
      consequence={words.account.consequence}
      confirmLabel={words.account.save}
      cancelLabel={words.cancel}
      blocked={bankComplete(country, fields) ? null : words.account.incomplete}
      error={error}
      onConfirm={() => void save()}
      onCancel={onCancel}
    >
      <div className="df-field">
        <label htmlFor={ids.holder}>{words.account.holder}</label>
        <input id={ids.holder} type="text" autoComplete="off" maxLength={120} value={fields.holder} onChange={set('holder')} />
      </div>
      {!iban && (
        <div className="df-field">
          <label htmlFor={ids.routing}>{words.account.routing}</label>
          <input id={ids.routing} type="text" inputMode="numeric" autoComplete="off" maxLength={20} value={fields.routing} onChange={set('routing')} />
        </div>
      )}
      <div className="df-field">
        <label htmlFor={ids.number}>{iban ? words.account.iban : words.account.number}</label>
        <input id={ids.number} type="text" autoComplete="off" spellCheck={false} maxLength={40} value={fields.number} onChange={set('number')} />
        <p className="df-field-hint">{words.account.hint}</p>
      </div>
    </ConfirmDialog>
  )
}

export const CardDialog = ({ changing, stripe, onSaved, onCancel }: DialogProps) => {
  const mount = useRef<HTMLDivElement>(null)
  const label = useId()
  const element = useRef<{ client: Stripe; card: StripeCardElement } | null>(null)
  const [complete, setComplete] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const { error, run } = useSave(onSaved)
  useEffect(() => {
    let gone = false
    let card: StripeCardElement | undefined
    stripe
      .then((client) => {
        if (!client || gone || !mount.current) throw new Error('no Stripe.js')
        card = client.elements().create('card')
        card.mount(mount.current)
        card.on('change', (event) => setComplete(event.complete))
        element.current = { client, card }
      })
      .catch(() => !gone && setUnavailable(true))
    return () => {
      gone = true
      card?.destroy()
    }
  }, [stripe])
  const save = () =>
    run(async () => {
      if (!element.current) return words.failed
      const { paymentMethod, error: refused } = await element.current.client.createPaymentMethod({ type: 'card', card: element.current.card })
      return paymentMethod ? setPaymentMethod(paymentMethod.id) : (refused?.message ?? words.failed)
    })
  return (
    <ConfirmDialog
      open
      title={changing ? words.card.changeTitle : words.card.addTitle}
      target={words.card.target}
      consequence={words.card.consequence}
      confirmLabel={words.card.save}
      cancelLabel={words.cancel}
      blocked={unavailable ? words.card.unavailable : complete ? null : words.card.incomplete}
      error={error}
      onConfirm={() => void save()}
      onCancel={onCancel}
    >
      <div className="df-field">
        <span id={label}>{words.card.field}</span>
        <div ref={mount} className="df-card-field" role="group" aria-labelledby={label} />
        <p className="df-field-hint">{words.card.hint}</p>
      </div>
    </ConfirmDialog>
  )
}
