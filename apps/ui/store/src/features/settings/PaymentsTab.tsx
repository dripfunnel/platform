import { ConfirmDialog, EmptyState, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import { useEffect, useId, useState } from 'react'
import { connectKeys, connectStripe, disconnectGateway, turnOnMethod, type Gateway, type PaymentMode } from '../../api/payments'
import { fill, locale, messages } from '../../messages'
import { isHttps } from '../common/https'
import { productName } from '../common/productName'
import { refusalIn } from '../common/refusal'
import { stripeOutcome, type StripeBack } from './stripeBack'

const words = messages.settings.payments
const refusalOf = refusalIn(words.refused)

type Ask = Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel'>
type Card = 'gateway' | 'other'
type KeyName = keyof typeof words.fields

/** What each provider's merchant pastes (THIRD-PARTY-ACCESS §3.1); Stripe pastes nothing, it connects on Stripe. */
const keyFields: Readonly<Record<string, readonly { name: KeyName; secret: boolean }[]>> = {
  razorpay: [
    { name: 'keyId', secret: false },
    { name: 'keySecret', secret: true },
    { name: 'webhookSecret', secret: true },
  ],
  cashfree: [
    { name: 'appId', secret: false },
    { name: 'secretKey', secret: true },
  ],
  phonepe: [
    { name: 'clientId', secret: false },
    { name: 'clientSecret', secret: true },
    { name: 'clientVersion', secret: false },
    { name: 'webhookUsername', secret: false },
    { name: 'webhookPassword', secret: true },
  ],
  paypal: [
    { name: 'clientId', secret: false },
    { name: 'clientSecret', secret: true },
    { name: 'webhookId', secret: false },
  ],
}

/** The longest bank details the API keeps (apps/api/src/engine/modules/checkout/setup.ts). */
const bankDetailsMax = 1000

const descOf = (g: Gateway): string => (words.desc as Record<string, string>)[g.provider] ?? ''
const connected = (g: Gateway) => g.connections.length > 0

const statusOf = (g: Gateway) => {
  const [tone, text] = g.live ? ['ok', words.status.live] : connected(g) ? ['info', words.status.test] : ['off', g.connectable ? words.status.off : words.status.unavailable]
  return <span className={`df-ops-status df-ops-status--${tone}`}>{text}</span>
}

interface KeysForm {
  gateway: Gateway
  values: Partial<Record<KeyName, string>>
  error: string | null
}

interface BankForm {
  gateway: Gateway
  details: string
  error: string | null
}

export interface PaymentsTabProps {
  gateways: readonly Gateway[]
  country: string | null
  canEdit: boolean
  /** Stripe's answer on the way back, until the tab has acted on it. */
  back: StripeBack | null
  onBackSeen: () => void
  /** A way to pay changed: the tab reads them again. */
  onChanged: (toast: string) => void
}

/** Payment setup (SetOps "payments"): the region's gateways, Stripe by OAuth and the rest by their keys, and the ways paid later. */
export const PaymentsTab = ({ gateways, country, canEdit, back, onBackSeen, onChanged }: PaymentsTabProps) => {
  const id = useId()
  const [ask, setAsk] = useState<Ask | null>(null)
  const [keys, setKeys] = useState<KeysForm | null>(null)
  const [bank, setBank] = useState<BankForm | null>(null)
  const [busy, setBusy] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [finishing, setFinishing] = useState(back?.kind === 'finish')
  const [note, setNote] = useState<{ card: Card; tone: 'alert' | 'status'; text: string } | null>(null)
  const ro = !canEdit || busy || connecting || finishing

  useEffect(() => {
    if (!back) return
    let live = true
    void stripeOutcome(back).then((outcome) => {
      if (!live) return
      setFinishing(false)
      onBackSeen()
      if (outcome.kind === 'connected') return onChanged(words.stripeConnected)
      if (outcome.kind === 'cancelled') return setNote({ card: 'gateway', tone: 'status', text: words.stripeCancelled })
      setNote({ card: 'gateway', tone: 'alert', text: outcome.kind === 'failed' ? words.stripeFailed : outcome.text })
    })
    return () => {
      live = false
    }
  }, [back, onBackSeen, onChanged])

  const write = async (card: Card, work: () => Promise<string>) => {
    setBusy(true)
    setNote(null)
    try {
      onChanged(await work())
    } catch (error) {
      setNote({ card, tone: 'alert', text: refusalOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const goToStripe = async () => {
    setConnecting(true)
    setNote(null)
    try {
      const url = await connectStripe()
      if (!isHttps(url)) throw new Error('not https')
      window.location.assign(url)
    } catch (error) {
      setConnecting(false)
      setNote({ card: 'gateway', tone: 'alert', text: error instanceof Error && error.message === 'not https' ? words.stripeBadLink : refusalOf(error) })
    }
  }

  const askStripe = () => setAsk({ title: words.stripeTitle, target: '', consequence: fill(words.stripeBody, { product: productName() }), confirmLabel: words.stripeGo, onConfirm: () => void goToStripe() })

  const askOff = (g: Gateway) => {
    const card: Card = g.kind === 'gateway' ? 'gateway' : 'other'
    setAsk({
      title: fill(card === 'gateway' ? words.disconnectName : words.turnOffName, { name: g.label }) + '?',
      target: g.label,
      consequence: card === 'gateway' ? words.disconnectBody : words.offBody,
      confirmLabel: card === 'gateway' ? words.disconnect : words.turnOff,
      danger: true,
      onConfirm: () => void write(card, async () => (await disconnectGateway(g.provider), fill(card === 'gateway' ? words.disconnected : words.turnedOff, { name: g.label }))),
    })
  }

  const askCod = (g: Gateway) =>
    setAsk({ title: fill(words.setUpName, { name: g.label }), target: '', consequence: words.codBody, confirmLabel: words.turnOn, onConfirm: () => void write('other', async () => (await turnOnMethod(g.provider, null), fill(words.turnedOn, { name: g.label }))) })

  const saveKeys = async (form: KeysForm, mode: PaymentMode) => {
    setKeys({ ...form, error: null })
    setBusy(true)
    try {
      const fields = keyFields[form.gateway.provider] ?? []
      await connectKeys(form.gateway.provider, mode, Object.fromEntries(fields.map((f) => [f.name, (form.values[f.name] ?? '').trim()])))
      setKeys(null)
      onChanged(fill(mode === 'live' ? words.connectedLive : words.connectedTest, { name: form.gateway.label }))
    } catch (error) {
      setKeys({ ...form, error: refusalOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const saveBank = async (form: BankForm) => {
    setBank({ ...form, error: null })
    setBusy(true)
    try {
      await turnOnMethod(form.gateway.provider, form.details.trim())
      setBank(null)
      onChanged(fill(form.gateway.live ? words.detailsSaved : words.turnedOn, { name: form.gateway.label }))
    } catch (error) {
      setBank({ ...form, error: refusalOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const openKeys = (gateway: Gateway) => {
    setNote(null)
    setKeys({ gateway, values: {}, error: null })
  }
  const openBank = (gateway: Gateway) => {
    setNote(null)
    setBank({ gateway, details: gateway.bankDetails ?? '', error: null })
  }

  const actions = (g: Gateway) => {
    if (!canEdit) return null
    const button = (label: string, aria: string, onClick: () => void) => (
      <button key={label} type="button" className="df-button df-button--small" disabled={ro} aria-label={fill(aria, { name: g.label })} onClick={onClick}>
        {label}
      </button>
    )
    if (g.kind === 'other') {
      if (!g.live) return button(words.setUp, words.setUpName, () => (g.provider === 'bank_transfer' ? openBank(g) : askCod(g)))
      return [...(g.provider === 'bank_transfer' ? [button(words.changeDetails, words.changeDetailsName, () => openBank(g))] : []), button(words.turnOff, words.turnOffName, () => askOff(g))]
    }
    if (connected(g)) return [...(keyFields[g.provider] ? [button(words.changeKeys, words.changeKeysName, () => openKeys(g))] : []), button(words.disconnect, words.disconnectName, () => askOff(g))]
    if (!g.connectable) return null
    if (g.provider === 'stripe') return button(connecting ? words.connecting : words.connect, words.connectName, askStripe)
    return button(words.connect, words.connectName, () => openKeys(g))
  }

  const row = (g: Gateway) => (
    <li key={g.provider} className="df-ops-row">
      <span className="df-ops-mark" aria-hidden="true">
        {g.label.slice(0, 2).toUpperCase()}
      </span>
      <span className="df-ops-text">
        <strong>{g.label}</strong>
        <span>{descOf(g)}</span>
        {!g.connectable && !connected(g) && <span>{fill(words.notOffered, { name: g.label })}</span>}
        {connected(g) && !g.live && <span>{words.testOnly}</span>}
        {g.provider === 'bank_transfer' && g.live && g.bankDetails && <span>{fill(words.bankShown, { details: g.bankDetails })}</span>}
        {g.connections
          .filter((c) => c.webhookUrl)
          .map((c) => (
            <span key={c.mode} className="df-ops-webhook">
              {fill(words.webhook, { mode: words.modes[c.mode], name: g.label })} <code>{c.webhookUrl}</code>
            </span>
          ))}
      </span>
      {statusOf(g)}
      {actions(g)}
    </li>
  )

  const noteOn = (card: Card) =>
    (finishing && card === 'gateway' && (
      <p className="df-set-note" role="status">
        {words.stripeFinishing}
      </p>
    )) ||
    (note?.card === card && (
      <p className={note.tone === 'alert' ? 'df-set-failure' : 'df-set-note'} role={note.tone}>
        {note.text}
      </p>
    ))

  if (gateways.length === 0) return <EmptyState title={words.emptyTitle} body={words.emptyBody} />
  const cards = gateways.filter((g) => g.kind === 'gateway')
  const others = gateways.filter((g) => g.kind === 'other')
  const countryName = country ? (new Intl.DisplayNames([locale], { type: 'region' }).of(country) ?? country) : ''
  const fields = keys ? (keyFields[keys.gateway.provider] ?? []) : []

  return (
    <div className="df-set-store">
      {cards.length > 0 && (
        <section className="df-set-card" aria-labelledby={`${id}-gateways`}>
          <h2 id={`${id}-gateways`}>{words.gatewaysTitle}</h2>
          <p className="df-set-lede">{words.gatewaysSub}</p>
          {noteOn('gateway')}
          <ul className="df-ops-rows">{cards.map(row)}</ul>
          <span className="df-set-help">{fill(words.gatewaysNote, { country: countryName })}</span>
        </section>
      )}
      {others.length > 0 && (
        <section className="df-set-card" aria-labelledby={`${id}-other`}>
          <h2 id={`${id}-other`}>{words.otherTitle}</h2>
          <p className="df-set-lede">{words.otherSub}</p>
          {noteOn('other')}
          <ul className="df-ops-rows">{others.map(row)}</ul>
        </section>
      )}
      {ask && <ConfirmDialog key={`${ask.title}|${ask.target}|${ask.confirmLabel}`} {...ask} open cancelLabel={words.cancel} onCancel={() => setAsk(null)} onConfirm={(...args) => { setAsk(null); ask.onConfirm(...args) }} />}
      {keys && (
        <ConfirmDialog
          open
          title={fill(connected(keys.gateway) ? words.changeKeysName : words.connectName, { name: keys.gateway.label })}
          target=""
          consequence={fill(words.keysBody, { name: keys.gateway.label })}
          confirmLabel={words.connect}
          cancelLabel={words.cancel}
          choices={[{ key: 'mode', label: words.keysMode, options: (['live', 'test'] as const).map((m) => ({ value: m, label: words.keysModes[m] })), initial: connected(keys.gateway) && !keys.gateway.live ? 'test' : 'live', error: () => null }]}
          blocked={fields.every((f) => (keys.values[f.name] ?? '').trim() !== '') ? null : words.keysMissing}
          error={keys.error}
          onCancel={() => setKeys(null)}
          onConfirm={(_, __, picks) => void saveKeys(keys, picks['mode'] === 'test' ? 'test' : 'live')}
        >
          {fields.map((f) => (
            <div key={f.name} className="df-field">
              <label htmlFor={`${id}-key-${f.name}`}>{words.fields[f.name]}</label>
              <input
                id={`${id}-key-${f.name}`}
                type={f.secret ? 'password' : 'text'}
                autoComplete="off"
                spellCheck={false}
                value={keys.values[f.name] ?? ''}
                onChange={(event) => setKeys({ ...keys, values: { ...keys.values, [f.name]: event.target.value } })}
              />
            </div>
          ))}
        </ConfirmDialog>
      )}
      {bank && (
        <ConfirmDialog
          open
          title={fill(bank.gateway.live ? words.changeDetailsName : words.setUpName, { name: bank.gateway.label })}
          target=""
          consequence={words.bankBody}
          confirmLabel={bank.gateway.live ? words.changeDetails : words.turnOn}
          cancelLabel={words.cancel}
          blocked={bank.details.trim() === '' ? words.bankMissing : null}
          error={bank.error}
          onCancel={() => setBank(null)}
          onConfirm={() => void saveBank(bank)}
        >
          <div className="df-field">
            <label htmlFor={`${id}-bank`}>{words.bankLabel}</label>
            <textarea id={`${id}-bank`} rows={4} maxLength={bankDetailsMax} placeholder={country === 'IN' ? words.bankPlaceholderIN : words.bankPlaceholder} value={bank.details} onChange={(event) => setBank({ ...bank, details: event.target.value })} />
          </div>
        </ConfirmDialog>
      )}
    </div>
  )
}
