import { ConfirmDialog, copyText, ErrorState, LoadingState, StatusPill } from '@dripfunnel/shared/ui'
import { useEffect, useId, useState } from 'react'
import { connectRazorpay, disconnectRazorpay, loadRazorpay, type RazorpayAccount as Account, type RazorpayMode, type RazorpayRefusal } from '../../api/razorpay'
import { fill, formatDate, messages } from '../../messages'

const words = messages.billing.razorpay

type Loaded = { state: 'loading' } | { state: 'error' } | { state: 'ready'; account: Account }
type Open = { kind: 'connect' | 'disconnect'; mode: RazorpayMode } | null

const ConnectDialog = ({ mode, onDone, onCancel }: { mode: RazorpayMode; onDone: () => void; onCancel: () => void }) => {
  const id = useId()
  const [keys, setKeys] = useState({ keyId: '', keySecret: '', webhookSecret: '' })
  const [error, setError] = useState<string | null>(null)
  const valid = new RegExp(`^rzp_${mode}_[A-Za-z0-9]{6,40}$`).test(keys.keyId.trim()) && keys.keySecret.trim() !== '' && keys.webhookSecret.trim() !== ''
  const field = (name: keyof typeof keys, secret: boolean) => (
    <div className="df-field">
      <label htmlFor={`${id}-${name}`}>{words.fields[name]}</label>
      <input id={`${id}-${name}`} type={secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} maxLength={200} placeholder={name === 'keyId' ? `rzp_${mode}_…` : undefined} value={keys[name]} onChange={(event) => setKeys({ ...keys, [name]: event.target.value })} />
    </div>
  )
  const save = () => {
    setError(null)
    connectRazorpay(mode, { keyId: keys.keyId.trim(), keySecret: keys.keySecret.trim(), webhookSecret: keys.webhookSecret.trim() }).then(
      (r) => (r.ok ? onDone() : setError(words.refusals[r.reason])),
      () => setError(words.failed),
    )
  }
  return (
    <ConfirmDialog
      open
      title={words.connectTitle[mode]}
      target=""
      consequence={words.connectBody[mode]}
      confirmLabel={words.connectCta}
      cancelLabel={words.cancel}
      blocked={valid ? null : fill(words.incomplete, { mode })}
      error={error}
      onConfirm={save}
      onCancel={onCancel}
    >
      {field('keyId', false)}
      {field('keySecret', true)}
      {field('webhookSecret', true)}
    </ConfirmDialog>
  )
}

export interface RazorpayAccountProps {
  /** Owner and Finance; everyone else sees the account and changes nothing. */
  mayChange: boolean
  onToast: (message: string) => void
}

// Billing › Razorpay account (#1744; designs/DF Platform Prototype, Billing): where the partner's merchants pay their plan.
export const RazorpayAccount = ({ mayChange, onToast }: RazorpayAccountProps) => {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState<Open>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    loadRazorpay().then(
      (account) => current && setLoaded({ state: 'ready', account }),
      () => current && setLoaded({ state: 'error' }),
    )
    return () => {
      current = false
    }
  }, [attempt])
  const reload = () => setAttempt((n) => n + 1)
  const done = (message: string) => {
    setOpen(null)
    setError(null)
    onToast(message)
    reload()
  }
  const refused = (reason: RazorpayRefusal) => setError(words.refusals[reason])

  return (
    <section className="df-panel df-panel--wide df-billing-razorpay" aria-labelledby="billing-razorpay">
      <div className="df-stack">
        <h2 id="billing-razorpay">{words.title}</h2>
        <span className="df-muted">{words.lede}</span>
      </div>
      {loaded.state === 'loading' && <LoadingState label={words.loading} rows={2} />}
      {loaded.state === 'error' && <ErrorState title={words.error} body={words.errorBody} retry={{ label: words.retry, onRetry: reload }} />}
      {loaded.state === 'ready' && (
        <>
          <ul className="df-billing-modes-list">
            {loaded.account.modes.map((m) => (
              <li key={m.mode}>
                <span className="df-stack">
                  <strong>{words.modes[m.mode].label}</strong>
                  <span className="df-muted">{words.modes[m.mode].body}</span>
                  {m.connected && m.keyHint && (
                    <span>
                      <code>{m.keyHint}</code>
                      {m.checkedAt && ` · ${fill(words.checked, { date: formatDate(m.checkedAt) })}`}
                    </span>
                  )}
                </span>
                <StatusPill tone={m.connected ? 'success' : 'neutral'} icon={m.connected ? 'ok' : 'clock'} label={m.connected ? words.connected : words.notConnected} />
                {mayChange && !m.connected && (
                  <button type="button" className="df-button df-button--primary" onClick={() => setOpen({ kind: 'connect', mode: m.mode })}>
                    {words.connect}
                  </button>
                )}
                {mayChange && m.connected && (
                  <button type="button" className="df-button" onClick={() => setOpen({ kind: 'disconnect', mode: m.mode })}>
                    {words.disconnect}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="df-stack df-billing-webhook">
            <strong>{words.webhook}</strong>
            <span className="df-muted">{words.webhookHint}</span>
            <span className="df-billing-webhook-row">
              <code>{loaded.account.webhookUrl}</code>
              <button type="button" className="df-button" onClick={() => void copyText(loaded.account.webhookUrl).then((ok) => onToast(ok ? words.copied : words.copyFailed))}>
                {words.copy}
              </button>
            </span>
          </div>
          {!mayChange && <p className="df-muted">{words.ownersAndFinance}</p>}
        </>
      )}
      {open?.kind === 'connect' && <ConnectDialog mode={open.mode} onDone={() => done(fill(words.connectedToast, { mode: words.modes[open.mode].label }))} onCancel={() => setOpen(null)} />}
      {open?.kind === 'disconnect' && (
        <ConfirmDialog
          open
          danger
          title={fill(words.disconnectTitle, { mode: words.modes[open.mode].label })}
          target=""
          consequence={words.disconnectBody[open.mode]}
          confirmLabel={words.disconnect}
          cancelLabel={words.cancel}
          error={error}
          onConfirm={() =>
            disconnectRazorpay(open.mode).then(
              (r) => (r.ok ? done(fill(words.disconnectedToast, { mode: words.modes[open.mode].label })) : refused(r.reason)),
              () => setError(words.failed),
            )
          }
          onCancel={() => {
            setOpen(null)
            setError(null)
          }}
        />
      )}
    </section>
  )
}
