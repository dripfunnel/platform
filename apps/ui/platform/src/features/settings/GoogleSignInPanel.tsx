import { ConfirmDialog, ErrorState, LoadingState, StatusPill } from '@dripfunnel/shared/ui'
import { useEffect, useId, useState } from 'react'
import { googleClientIdShape, googleSecretShape, loadGoogleSignIn, saveGoogleSignIn, turnOffGoogleSignIn, type GoogleSignInStatus } from '../../api/googleSignIn'
import { fill, locale, messages } from '../../messages'

const words = messages.settings.integrations.google
const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })

type Loaded = { state: 'loading' } | { state: 'error' } | { state: 'ready'; status: GoogleSignInStatus }

const SaveDialog = ({ current, onDone, onCancel }: { current: string | null; onDone: () => void; onCancel: () => void }) => {
  const ids = { client: useId(), secret: useId() }
  const [clientId, setClientId] = useState(current ?? '')
  const [secret, setSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ready = googleClientIdShape.test(clientId.trim()) && googleSecretShape.test(secret.trim())
  return (
    <ConfirmDialog
      open
      title={words.dialog.title}
      target={words.dialog.target}
      consequence={words.dialog.consequence}
      confirmLabel={words.dialog.save}
      cancelLabel={messages.settings.integrations.cancel}
      blocked={ready ? null : words.dialog.incomplete}
      error={error}
      onConfirm={() =>
        void saveGoogleSignIn({ clientId: clientId.trim(), clientSecret: secret.trim() }).then(
          (r) => (r.ok ? onDone() : setError(words.refusals[r.reason])),
          () => setError(words.toasts.failed),
        )
      }
      onCancel={onCancel}
    >
      <div className="df-field">
        <label htmlFor={ids.client}>{words.clientLabel}</label>
        <input id={ids.client} type="text" autoComplete="off" spellCheck={false} maxLength={200} value={clientId} onChange={(event) => setClientId(event.target.value)} />
        <p className="df-field-hint">{words.dialog.clientHint}</p>
      </div>
      <div className="df-field">
        <label htmlFor={ids.secret}>{words.secretLabel}</label>
        <input id={ids.secret} type="password" autoComplete="off" spellCheck={false} maxLength={100} value={secret} onChange={(event) => setSecret(event.target.value)} />
        <p className="df-field-hint">{words.dialog.secretHint}</p>
      </div>
    </ConfirmDialog>
  )
}

// Integrations, Google sign-in (#1046): the partner's own Google client for "Continue with Google" on its portal.
// Drawn from this tab's own parts: no prototype has the screen (docs/ui/platform/FIRST-RELEASE.md §14.5).
export const GoogleSignInPanel = ({ mayChange, onToast }: { mayChange: boolean; onToast: (message: string) => void }) => {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState<'save' | 'off' | null>(null)
  const [offError, setOffError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null)
  useEffect(() => {
    let current = true
    loadGoogleSignIn().then(
      (status) => current && setLoaded({ state: 'ready', status }),
      () => current && setLoaded({ state: 'error' }),
    )
    return () => {
      current = false
    }
  }, [attempt])
  const reload = () => setAttempt((n) => n + 1)
  // No Clipboard API outside a secure context, and a write can be refused: either way the partner is told to copy it by hand.
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied('ok')
    } catch {
      setCopied('failed')
    }
  }
  if (loaded.state === 'loading') return <LoadingState label={words.loading} rows={2} />
  if (loaded.state === 'error') return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: () => (setLoaded({ state: 'loading' }), reload()) }} />
  const { status } = loaded
  return (
    <section className="df-panel df-panel--wide" aria-labelledby="settings-google-sign-in">
      <div className="df-settings-row-actions">
        <h2 id="settings-google-sign-in">{words.title}</h2>
        <StatusPill tone={status.enabled ? 'success' : 'neutral'} icon={status.enabled ? 'ok' : 'ban'} label={status.enabled ? words.on : words.turnedOff} />
      </div>
      <p className="df-muted">{words.note}</p>
      <div className="df-field">
        <span>{words.redirectLabel}</span>
        {status.redirectUri ? (
          <div className="df-settings-onfile">
            <code>{status.redirectUri}</code>
            <button type="button" className="df-button df-button--small" onClick={() => void copy(status.redirectUri ?? '')}>
              {words.copy}
            </button>
            <span role="status" className={copied === 'failed' ? 'df-muted' : 'df-visually-hidden'}>
              {copied === 'ok' ? words.copied : copied === 'failed' ? words.copyFailed : ''}
            </span>
          </div>
        ) : (
          <p className="df-muted">{words.noHost}</p>
        )}
        <p className="df-field-hint">{words.redirectHint}</p>
      </div>
      {status.clientId ? (
        <ul className="df-settings-keys">
          <li>
            <div className="df-settings-onfile">
              <strong>{words.clientLabel}</strong>
              <code>{status.clientId}</code>
            </div>
            <div className="df-settings-onfile">
              <strong>{words.secretLabel}</strong>
              <span className="df-muted">{status.secretHint}</span>
            </div>
            {status.setBy && status.setAt && <span className="df-muted">{fill(words.setBy, { name: status.setBy, when: when.format(new Date(status.setAt)) })}</span>}
          </li>
        </ul>
      ) : (
        <p className="df-muted">{words.off}</p>
      )}
      {mayChange && (
        <div className="df-settings-row-actions">
          <button type="button" className={status.enabled ? 'df-button' : 'df-button df-button--primary'} onClick={() => setOpen('save')}>
            {status.clientId ? words.replace : words.setUp}
          </button>
          {status.enabled && (
            <button type="button" className="df-button" onClick={() => (setOffError(null), setOpen('off'))}>
              {words.turnOff}
            </button>
          )}
        </div>
      )}
      {open === 'save' && (
        <SaveDialog
          current={status.clientId}
          onDone={() => {
            setOpen(null)
            onToast(words.toasts.saved)
            reload()
          }}
          onCancel={() => setOpen(null)}
        />
      )}
      {open === 'off' && (
        <ConfirmDialog
          open
          danger
          title={words.offDialog.title}
          target={words.offDialog.target}
          consequence={words.offDialog.consequence}
          confirmLabel={words.offDialog.confirm}
          cancelLabel={messages.settings.integrations.cancel}
          error={offError}
          onConfirm={() =>
            void turnOffGoogleSignIn().then(
              (r) => {
                if (!r.ok) return setOffError(words.refusals[r.reason])
                setOpen(null)
                onToast(words.toasts.off)
                reload()
              },
              () => setOffError(words.toasts.failed),
            )
          }
          onCancel={() => setOpen(null)}
        />
      )}
    </section>
  )
}
