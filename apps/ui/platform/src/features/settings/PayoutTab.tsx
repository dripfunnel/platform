import { ErrorState, InfoNote, LoadingState, PermissionDenied, StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import { useEffect, useMemo, useState } from 'react'
import { loadBillingClientConfig, loadPayoutSettings, type PaymentMethod, type PayoutAccount } from '../../api/billing'
import { fill, locale, messages } from '../../messages'
import { BankDialog, CardDialog, stripeFor } from './PayoutDialogs'
import type { PayoutState } from './settingsHarness'
const words = messages.settings.payout
const refusals = messages.billing.refusals
const accountLook: Record<PayoutAccount['status'], [StatusTone, StatusIconName]> = { missing: ['warning', 'alert'], verifying: ['info', 'clock'], verified: ['success', 'ok'], failed: ['danger', 'cross'] }
const cardLook: Record<PaymentMethod['status'], [StatusTone, StatusIconName]> = { missing: ['warning', 'alert'], on_file: ['success', 'ok'], declined: ['danger', 'cross'] }
const expiry = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' })
const titled = (brand: string) => brand.charAt(0).toUpperCase() + brand.slice(1)

export interface PayoutData {
  publishableKey: string | null
  account: PayoutAccount
  card: PaymentMethod
}

export interface PayoutPanelsProps {
  data: PayoutData
  // Why this person can't change either, or null: a staff session, or a role other than Owner and Finance.
  refusal: string | null
  // Why the bank account can't be added yet, or null.
  accountBlock: string | null
  onAccount: () => void
  onCard: () => void
}

export const PayoutPanels = ({ data: { publishableKey, account, card }, refusal, accountBlock, onAccount, onCard }: PayoutPanelsProps) => {
  const connected = publishableKey !== null
  const act = (label: string, run: () => void, block: string | null = null) =>
    refusal !== null ? (
      <PermissionDenied actionLabel={label} reason={refusal} />
    ) : (
      <>
        <button type="button" className="df-button df-button--primary" disabled={!connected || block !== null} onClick={run}>
          {label}
        </button>
        {block && <span className="df-muted">{block}</span>}
      </>
    )
  return (
    <>
      <section className="df-panel" aria-labelledby="settings-payout">
        <h2 id="settings-payout">{words.payoutAccount}</h2>
        <div className="df-settings-onfile">
          <strong>{account.last4 ? fill(account.bank ? words.accountEnding : words.accountEndingPlain, { bank: account.bank ?? '', last4: account.last4 }) : words.noAccount}</strong>
          <StatusPill tone={accountLook[account.status][0]} icon={accountLook[account.status][1]} label={words.statuses[account.status]} />
        </div>
        {account.failure && <p className="df-muted">{account.failure}</p>}
        <p className="df-muted">{words.payoutNote}</p>
        <div className="df-settings-row-actions">{act(account.last4 ? words.changeAccount : words.addAccount, onAccount, accountBlock)}</div>
      </section>
      <section className="df-panel" aria-labelledby="settings-payment">
        <h2 id="settings-payment">{words.paymentMethod}</h2>
        <div className="df-settings-onfile">
          <strong>{card.last4 ? fill(words.cardEnding, { brand: titled(card.brand ?? ''), last4: card.last4 }) : words.noCard}</strong>
          <StatusPill tone={cardLook[card.status][0]} icon={cardLook[card.status][1]} label={words.statuses[card.status]} />
        </div>
        {card.expires && <p className="df-muted">{fill(words.cardExpires, { date: expiry.format(new Date(`${card.expires}-01T00:00:00Z`)) })}</p>}
        <p className="df-muted">{words.paymentNote}</p>
        <div className="df-settings-row-actions">{act(card.last4 ? words.changeCard : words.addCard, onCard)}</div>
      </section>
    </>
  )
}

type Loaded = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: PayoutData }

const fetchPayout = async (): Promise<PayoutData> => {
  const [publishableKey, settings] = await Promise.all([loadBillingClientConfig(), loadPayoutSettings()])
  return { publishableKey, account: settings.payoutAccount, card: settings.paymentMethod }
}

export interface PayoutTabProps {
  // A staff session of either kind: payout and card details stay with the partner (ACCESS §8.1, §8.2).
  staffSession: boolean
  partner: string
  mayChange: boolean
  // Support has no Billing, so nothing here is read for it (§2.1).
  denied: boolean
  // The partner's company country and contract currency, which Stripe needs to make a bank account token.
  country: string | null
  currency: string | null
  forced: PayoutState | null
  onToast: (message: string) => void
}

// Payout and payment (§14.3): what is on file, and Stripe's own fields to add or change it. The API answers
// the publishable key at runtime (#278); Stripe.js is loaded from js.stripe.com only once it has.
export const PayoutTab = ({ staffSession, partner, mayChange, denied, country, currency, forced, onToast }: PayoutTabProps) => {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState<'account' | 'card' | null>(null)
  useEffect(() => {
    if (denied || staffSession) return
    let current = true
    fetchPayout().then(
      (data) => current && setLoaded({ state: 'ready', data }),
      () => current && setLoaded({ state: 'error' }),
    )
    return () => {
      current = false
    }
  }, [attempt, denied, staffSession])
  const key = loaded.state === 'ready' ? loaded.data.publishableKey : null
  const stripe = useMemo(() => (key ? stripeFor(key) : null), [key])
  if (denied) return <PermissionDenied actionLabel={words.title} reason={messages.billing.denied} />
  const retry = () => (setLoaded({ state: 'loading' }), setAttempt((n) => n + 1))
  // Stays with the partner (ACCESS §8.2): a staff session neither loads nor draws it.
  if (staffSession)
    return (
      <div className="df-panels">
        <InfoNote>{fill(words.staffSession, { partner })}</InfoNote>
      </div>
    )
  if (loaded.state !== 'ready')
    return (
      <div className="df-panels">
        {loaded.state === 'loading' ? <LoadingState label={words.loading} rows={3} /> : <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: retry }} />}
      </div>
    )
  const { data } = loaded
  const shown: PayoutData = {
    ...data,
    publishableKey: forced === 'notconnected' ? null : data.publishableKey,
    account: forced === 'verifying' ? { ...data.account, last4: data.account.last4 ?? '1180', status: 'verifying' } : data.account,
    card: forced === 'declined' ? { ...data.card, last4: data.card.last4 ?? '3009', brand: data.card.brand ?? 'visa', status: 'declined' } : data.card,
  }
  const saved = (kind: 'account' | 'card') => {
    setOpen(null)
    onToast(words.saved[kind])
    setAttempt((n) => n + 1)
  }
  return (
    <div className="df-panels">
      {shown.publishableKey === null && <InfoNote>{words.notConnected}</InfoNote>}
      <PayoutPanels data={shown} refusal={mayChange ? null : words.mayNot} accountBlock={country && currency ? null : refusals.NO_COUNTRY} onAccount={() => setOpen('account')} onCard={() => setOpen('card')} />
      {stripe && open === 'account' && country && currency && <BankDialog changing={shown.account.last4 !== null} country={country} currency={currency} stripe={stripe} onSaved={() => saved('account')} onCancel={() => setOpen(null)} />}
      {stripe && open === 'card' && <CardDialog changing={shown.card.last4 !== null} stripe={stripe} onSaved={() => saved('card')} onCancel={() => setOpen(null)} />}
    </div>
  )
}
