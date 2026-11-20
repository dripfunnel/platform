import { ConfirmDialog, ErrorState, LoadingState, PermissionDenied, StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import { useEffect, useId, useState } from 'react'
import { loadMaps, removeMaps, saveMaps, setMapsChoice, testMaps, type MapsChoice, type MapsKey, type MapsProblem, type MapsRefusal, type MapsResult, type MapsStatus } from '../../api/maps'
import { fill, locale, messages } from '../../messages'
import { hooksHostFor } from './hooksHost'

const words = messages.settings.integrations.maps
const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
const look: Record<MapsKey['status'], [StatusTone, StatusIconName]> = { ok: ['success', 'ok'], untested: ['neutral', 'clock'], rejected: ['danger', 'cross'] }
const keyShape = /^AIza[0-9A-Za-z_-]{35}$/

type Loaded = { state: 'loading' } | { state: 'error' } | { state: 'ready'; status: MapsStatus }
type Open = 'save' | 'remove' | 'choice' | null

const refusalText = (r: { reason: MapsRefusal; problem: MapsProblem | null }): string => (r.reason === 'KEY_REJECTED' && r.problem ? words.problems[r.problem] : words.refusals[r.reason])

const Instructions = ({ host }: { host: string }) => (
  <details className="df-settings-help">
    <summary>{words.how.title}</summary>
    <ol>
      <li>{words.how.project}</li>
      <li>
        {words.how.enable}
        <ul>
          {words.how.apis.map((api) => (
            <li key={api}>{api}</li>
          ))}
        </ul>
      </li>
      <li>{words.how.create}</li>
      <li>{fill(words.how.websites, { referrer: `https://${host}/*` })}</li>
      <li>{words.how.restrictApis}</li>
      <li>{words.how.quota}</li>
      <li>{words.how.paste}</li>
    </ol>
    <p className="df-muted">{words.how.roles}</p>
    <ul>
      {words.how.links.map((link) => (
        <li key={link.href}>
          <a href={link.href} target="_blank" rel="noopener noreferrer">
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  </details>
)

const SaveDialog = ({ replacing, onDone, onCancel }: { replacing: boolean; onDone: () => void; onCancel: () => void }) => {
  const id = useId()
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const valid = keyShape.test(key.trim())
  const save = () => {
    setError(null)
    saveMaps(key.trim()).then(
      (r) => (r.ok ? onDone() : setError(refusalText(r))),
      () => setError(words.toasts.failed),
    )
  }
  return (
    <ConfirmDialog
      open
      title={replacing ? words.dialog.replaceTitle : words.dialog.title}
      target={words.dialog.target}
      consequence={words.dialog.consequence}
      confirmLabel={words.dialog.save}
      cancelLabel={messages.settings.integrations.cancel}
      blocked={valid ? null : words.dialog.incomplete}
      error={error}
      onConfirm={save}
      onCancel={onCancel}
    >
      <div className="df-field">
        <label htmlFor={id}>{words.keyLabel}</label>
        <input id={id} type="password" autoComplete="off" spellCheck={false} maxLength={80} value={key} onChange={(event) => setKey(event.target.value)} />
        <p className="df-field-hint">{words.dialog.hint}</p>
      </div>
    </ConfirmDialog>
  )
}

export interface MapsPanelProps {
  // False for a read-only console: the key shows, nothing changes.
  mayChange: boolean
  // Why an impersonation can't use it, or null: every Maps field is refused to one, the read included (ACCESS §8.1).
  blocked: string | null
  onToast: (message: string) => void
}

// Integrations, Google Maps (#1614): drawn from the tab's own parts, as WhatsApp is (docs/ui/platform/FIRST-RELEASE.md §14.5).
export const MapsPanel = ({ mayChange, blocked, onToast }: MapsPanelProps) => {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState<Open>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [problem, setProblem] = useState<MapsProblem | null>(null)
  useEffect(() => {
    if (blocked) return
    let current = true
    loadMaps().then(
      (status) => current && setLoaded({ state: 'ready', status }),
      () => current && setLoaded({ state: 'error' }),
    )
    return () => {
      current = false
    }
  }, [attempt, blocked])
  const reload = () => setAttempt((n) => n + 1)
  const header = (on: boolean | null) => (
    <>
      <div className="df-settings-row-actions">
        <h2 id="settings-maps">{words.title}</h2>
        {on !== null && <StatusPill tone={on ? 'success' : 'neutral'} icon={on ? 'ok' : 'ban'} label={on ? words.on : words.off} />}
      </div>
      <p className="df-muted">{words.note}</p>
    </>
  )
  if (blocked)
    return (
      <section className="df-panel df-panel--wide" aria-labelledby="settings-maps">
        {header(null)}
        <PermissionDenied actionLabel={words.setUp} reason={blocked} />
      </section>
    )
  if (loaded.state === 'loading') return <LoadingState label={words.loading} rows={2} />
  if (loaded.state === 'error') return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: () => (setLoaded({ state: 'loading' }), reload()) }} />
  const { key, dripfunnel, choice, sender } = loaded.status
  const ours = sender === 'dripfunnel'
  const openDialog = (kind: Exclude<Open, null>) => (setDialogError(null), setOpen(kind))
  const test = () => {
    setTesting(true)
    testMaps()
      .then(
        (r) => {
          if (!r.ok) return onToast(refusalText(r))
          setProblem(r.status === 'rejected' ? r.problem : null)
          onToast(r.status === 'rejected' ? words.toasts.rejected : words.toasts.ok)
        },
        () => onToast(words.toasts.failed),
      )
      .finally(() => {
        setTesting(false)
        reload()
      })
  }
  // Each confirmed change: its toast and a fresh read, or its refusal in words with the dialog left open.
  const confirm = (work: () => Promise<MapsResult>, done: string) => () => {
    setDialogError(null)
    work().then(
      (r) => {
        if (!r.ok) return setDialogError(refusalText(r))
        setOpen(null)
        setProblem(null)
        onToast(done)
        reload()
      },
      () => setDialogError(words.toasts.failed),
    )
  }
  const host = hooksHostFor(window.location.hostname)
  const senderText = ours ? words.sender.ours : sender === 'own' ? words.sender.own : words.sender.none
  return (
    <section className="df-panel df-panel--wide" aria-labelledby="settings-maps" aria-busy={testing}>
      {header(sender !== null)}
      {key ? (
        <ul className="df-settings-keys">
          <li>
            <div className="df-settings-onfile">
              <strong>{words.keyLabel}</strong>
              <code>{key.hint}</code>
            </div>
            <div className="df-settings-onfile">
              <StatusPill tone={look[key.status][0]} icon={look[key.status][1]} label={words.statuses[key.status]} />
              <span className="df-muted">{key.lastTestedAt ? fill(words.lastTested, { when: when.format(new Date(key.lastTestedAt)) }) : words.neverTested}</span>
            </div>
          </li>
        </ul>
      ) : (
        <p className="df-muted">{dripfunnel ? words.noneOurs : words.none}</p>
      )}
      {dripfunnel && (
        <div className="df-settings-onfile">
          <strong>{words.sender.label}</strong>
          <span>{senderText}</span>
          {mayChange && (
            <button type="button" className="df-button" disabled={testing} onClick={() => openDialog('choice')}>
              {words.choiceDialog.change}
            </button>
          )}
        </div>
      )}
      {dripfunnel && <p className="df-muted">{words.available}</p>}
      {sender === null && <p className="df-muted">{words.noMap}</p>}
      {key?.status === 'rejected' && <p role="alert">{problem ? words.problems[problem] : words.rejectedNote}</p>}
      {mayChange && (
        <div className="df-settings-row-actions">
          <button type="button" className={key ? 'df-button' : 'df-button df-button--primary'} disabled={testing} onClick={() => openDialog('save')}>
            {key ? words.replace : words.setUp}
          </button>
          {key && (
            <button type="button" className="df-button" disabled={testing} onClick={test}>
              {testing ? words.testing : words.test}
            </button>
          )}
          {key && (
            <button type="button" className="df-button" disabled={testing} onClick={() => openDialog('remove')}>
              {words.remove}
            </button>
          )}
        </div>
      )}
      <Instructions host={host} />
      {open === 'save' && (
        <SaveDialog
          replacing={key !== null}
          onDone={() => {
            setOpen(null)
            setProblem(null)
            onToast(words.toasts.saved)
            reload()
          }}
          onCancel={() => setOpen(null)}
        />
      )}
      {open === 'remove' && (
        <ConfirmDialog
          open
          danger
          title={words.removeDialog.title}
          target={words.removeDialog.target}
          consequence={dripfunnel ? words.removeDialog.consequenceOurs : words.removeDialog.consequence}
          confirmLabel={words.removeDialog.confirm}
          cancelLabel={messages.settings.integrations.cancel}
          error={dialogError}
          onConfirm={confirm(removeMaps, words.toasts.removed)}
          onCancel={() => setOpen(null)}
        />
      )}
      {open === 'choice' && (
        <ConfirmDialog
          open
          title={words.choiceDialog.title}
          target=""
          consequence={(_, picked) => (picked.account === 'dripfunnel' ? words.choiceDialog.consequenceOurs : key?.status === 'ok' ? words.choiceDialog.consequenceOwn : words.choiceDialog.consequenceNoOwn)}
          confirmLabel={words.choiceDialog.confirm}
          cancelLabel={messages.settings.integrations.cancel}
          choices={[
            {
              key: 'account',
              label: words.choiceDialog.label,
              options: [
                { value: 'own', label: words.choiceDialog.own, hint: key?.status === 'ok' ? words.choiceDialog.ownHint : words.choiceDialog.ownMissing },
                { value: 'dripfunnel', label: words.choiceDialog.ours, hint: words.choiceDialog.oursHint },
              ],
              initial: choice ?? (ours ? 'dripfunnel' : 'own'),
              error: () => null,
            },
          ]}
          error={dialogError}
          onConfirm={(_, __, picked) => {
            const next: MapsChoice = picked.account === 'dripfunnel' ? 'dripfunnel' : 'own'
            confirm(() => setMapsChoice(next), next === 'dripfunnel' ? words.toasts.chosenOurs : words.toasts.chosenOwn)()
          }}
          onCancel={() => setOpen(null)}
        />
      )}
    </section>
  )
}
