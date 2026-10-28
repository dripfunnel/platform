import { ConfirmDialog, ErrorState, LoadingState, PermissionDenied, StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import { useEffect, useId, useState } from 'react'
import { addAiKey, aiProviders, beginAiOauth, finishAiOauth, loadAiKeys, loadAiSignIn, removeAiKey, setDefaultAiKey, testAiKey, type AiKey, type AiKeyResult, type AiProvider } from '../../api/aiKeys'
import { fill, locale, messages } from '../../messages'
import { isHttps } from './aiSignInBack'
const words = messages.settings.integrations
const look: Record<AiKey['status'], [StatusTone, StatusIconName]> = { ok: ['success', 'ok'], untested: ['neutral', 'clock'], rejected: ['danger', 'cross'] }
const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
const shapes: Record<AiProvider, RegExp> = { anthropic: /^sk-ant-[A-Za-z0-9_-]{20,200}$/, openai: /^sk-[A-Za-z0-9_-]{20,200}$/ }

export interface IntegrationsTabProps {
  // False for a role other than Owner and Admin, and for a read-only console.
  mayChange: boolean
  onToast: (message: string) => void
}

type Loaded = { state: 'loading' } | { state: 'error' } | { state: 'ready'; keys: readonly AiKey[]; available: Record<AiProvider, boolean> }
type Flow = 'redirect' | 'finish' | 'failed' | null

const AddDialog = ({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) => {
  const ids = { provider: useId(), name: useId(), key: useId() }
  const [provider, setProvider] = useState<AiProvider>('anthropic')
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const save = () => {
    setError(null)
    addAiKey({ provider, name: name.trim(), key: key.trim() }).then(
      (r) => (r.ok ? onDone() : setError(words.refusals[r.reason])),
      () => setError(words.toasts.failed),
    )
  }
  return (
    <ConfirmDialog
      open
      title={words.addDialog.title}
      target={words.addDialog.target}
      consequence={provider === 'openai' ? words.addDialog.consequenceOpenai : words.addDialog.consequenceAnthropic}
      confirmLabel={provider === 'openai' ? words.addDialog.save : words.addDialog.testAndSave}
      cancelLabel={words.cancel}
      blocked={name.trim() !== '' && shapes[provider].test(key.trim()) ? null : words.addDialog.incomplete}
      error={error}
      onConfirm={save}
      onCancel={onCancel}
    >
      <div className="df-field">
        <label htmlFor={ids.provider}>{words.addDialog.provider}</label>
        <select id={ids.provider} value={provider} onChange={(event) => setProvider(event.target.value === 'openai' ? 'openai' : 'anthropic')}>
          {aiProviders.map((p) => (
            <option key={p} value={p}>
              {words.providers[p]}
            </option>
          ))}
        </select>
      </div>
      <div className="df-field">
        <label htmlFor={ids.name}>{words.addDialog.name}</label>
        <input id={ids.name} type="text" autoComplete="off" maxLength={60} placeholder={words.addDialog.namePlaceholder} value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="df-field">
        <label htmlFor={ids.key}>{words.addDialog.key}</label>
        <input id={ids.key} type="password" autoComplete="off" spellCheck={false} maxLength={256} value={key} onChange={(event) => setKey(event.target.value)} />
        <p className="df-field-hint">{words.addDialog.hint}</p>
      </div>
    </ConfirmDialog>
  )
}

const RemoveDialog = ({ target, keys, onDone, onCancel }: { target: AiKey; keys: readonly AiKey[]; onDone: () => void; onCancel: () => void }) => {
  const [error, setError] = useState<string | null>(null)
  const next = keys.find((k) => k.id !== target.id)
  const signIn = target.authType === 'oauth'
  const rest = !next ? words.removeDialog.last : target.isDefault ? fill(words.removeDialog.default, { next: next.name }) : words.removeDialog.other
  const consequence = signIn ? words.removeDialog.signInLead + rest : rest
  return (
    <ConfirmDialog
      open
      danger
      title={fill(signIn ? words.removeDialog.signInTitle : words.removeDialog.title, { name: target.name })}
      target={words.removeDialog.target}
      consequence={consequence}
      confirmLabel={signIn ? words.removeDialog.signInConfirm : words.removeDialog.confirm}
      cancelLabel={words.cancel}
      error={error}
      onConfirm={() =>
        void removeAiKey(target.id).then(
          (r) => (r.ok ? onDone() : setError(words.refusals[r.reason])),
          () => setError(words.toasts.failed),
        )
      }
      onCancel={onCancel}
    />
  )
}

// Integrations (§14.5): the partner's AI key profiles. The key is typed once and never read back.
export const IntegrationsTab = ({ mayChange, onToast }: IntegrationsTabProps) => {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState<{ kind: 'add' } | { kind: 'remove'; key: AiKey } | null>(null)
  const [busy, setBusy] = useState(false)
  const [flow, setFlow] = useState<Flow>(null)
  const [flowFor, setFlowFor] = useState<string | null>(null)
  const [pending, setPending] = useState<AiProvider | null>(null)
  const [pasted, setPasted] = useState('')
  const pasteId = useId()
  const [failure, setFailure] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    Promise.all([loadAiKeys(), loadAiSignIn()]).then(
      ([keys, signIn]) => current && setLoaded({ state: 'ready', keys, available: { anthropic: signIn.some((p) => p.provider === 'anthropic' && p.available), openai: signIn.some((p) => p.provider === 'openai' && p.available) } }),
      () => current && setLoaded({ state: 'error' }),
    )
    return () => {
      current = false
    }
  }, [attempt])
  const reload = () => setAttempt((n) => n + 1)
  if (loaded.state === 'loading') return <div className="df-panels"><LoadingState label={words.loading} rows={3} /></div>
  if (loaded.state === 'error')
    return (
      <div className="df-panels">
        <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: () => (setLoaded({ state: 'loading' }), reload()) }} />
      </div>
    )
  const { keys, available } = loaded
  const working = busy || flow === 'redirect' || flow === 'finish'
  const hasSignIn = (provider: AiProvider) => keys.some((k) => k.authType === 'oauth' && k.provider === provider)
  const signIn = (provider: AiProvider, id: string | null) => {
    setFlow('redirect')
    setFlowFor(id)
    setFailure(null)
    beginAiOauth(provider, id).then(
      (r) => {
        setFlow(null)
        if (r.ok && r.url && isHttps(r.url)) {
          window.open(r.url, '_blank', 'noopener,noreferrer')
          setPending(provider)
          return setPasted('')
        }
        onToast(r.ok ? words.toasts.failed : words.refusals[r.reason])
      },
      () => (setFlow(null), onToast(words.toasts.failed)),
    )
  }
  const finishSignIn = () => {
    const answer = pasted.trim()
    if (!answer) return setFailure(words.signIn.missing)
    setFlow('finish')
    setFailure(null)
    finishAiOauth(answer).then(
      (r) => {
        if (!r.ok) return (setFlow('failed'), setFailure(words.refusals[r.reason]))
        setFlow(null)
        setPending(null)
        setPasted('')
        onToast(words.toasts.connected)
        reload()
      },
      () => setFlow('failed'),
    )
  }
  const act = (work: Promise<AiKeyResult<{ status: string | null }>>, done: (status: string | null) => string) => {
    setBusy(true)
    work
      .then((r) => onToast(r.ok ? done(r.status) : words.refusals[r.reason]), () => onToast(words.toasts.failed))
      .finally(() => {
        setBusy(false)
        reload()
      })
  }
  const testToast = (key: AiKey) => (status: string | null) => (status === 'ok' ? fill(words.toasts.ok, { name: key.name }) : status === 'rejected' ? fill(words.toasts.rejected, { name: key.name }) : words.toasts.untested)
  return (
    <div className="df-panels">
      <section className="df-panel df-panel--wide" aria-labelledby="settings-ai-keys">
        <div className="df-settings-row-actions">
          <h2 id="settings-ai-keys">{words.title}</h2>
          {mayChange && (
            <button type="button" className="df-button df-button--primary" disabled={working} onClick={() => setOpen({ kind: 'add' })}>
              {words.add}
            </button>
          )}
        </div>
        <p className="df-muted">{words.note}</p>
        {!mayChange && <PermissionDenied actionLabel={words.title} reason={words.mayNot} />}
        {mayChange && (
          <div className="df-settings-signin">
            {(['anthropic', 'openai'] as const).map((p) => {
              const card = p === 'anthropic' ? words.signIn.claude : words.signIn.chatgpt
              return (
                !hasSignIn(p) && (
                  <div key={p} aria-busy={working}>
                    <div className="df-settings-onfile">
                      <strong>{card.title}</strong>
                      {!available[p] && <StatusPill tone="neutral" icon="ban" label={words.signIn.badge} />}
                    </div>
                    <p className="df-muted">{available[p] ? card.text : words.signIn.off}</p>
                    <p className="df-muted">{card.risk}</p>
                    <div className="df-settings-onfile">
                      <button type="button" className="df-button df-button--primary" disabled={!available[p] || working} onClick={() => signIn(p, null)}>
                        {flow === 'redirect' && flowFor === null ? words.signIn.opening : card.button}
                      </button>
                    </div>
                  </div>
                )
              )
            })}
          </div>
        )}
        {mayChange && pending && (
          <div className="df-settings-paste" aria-busy={flow === 'finish'}>
            <strong>{fill(words.signIn.pasteTitle, { provider: words.signInProviders[pending] })}</strong>
            <p className="df-muted">{words.signIn.pasteBody}</p>
            <div className="df-field">
              <label htmlFor={pasteId}>{words.signIn.pasteLabel}</label>
              <input id={pasteId} type="password" autoComplete="off" spellCheck={false} maxLength={4000} value={pasted} disabled={working} onChange={(e) => setPasted(e.target.value)} />
            </div>
            <div className="df-settings-onfile">
              <button type="button" className="df-button df-button--primary" disabled={working} onClick={finishSignIn}>
                {flow === 'finish' ? words.signIn.finishing : words.signIn.finish}
              </button>
              <button type="button" className="df-button" disabled={working} onClick={() => (setPending(null), setPasted(''), setFailure(null), setFlow(null))}>
                {words.cancel}
              </button>
            </div>
          </div>
        )}
        {(flow === 'failed' || failure) && <p role="alert">{failure ?? words.signIn.failed}</p>}
        {keys.length === 0 && <p className="df-muted">{words.empty}</p>}
        <ul className="df-settings-keys">
          {keys.map((key) => {
            const so = key.authType === 'oauth'
            return (
              <li key={key.id}>
                <div className="df-settings-onfile">
                  <strong>{key.name}</strong>
                  <span className="df-muted">{words.kinds[key.authType]}</span>
                  <span className="df-muted">{so ? fill(words.signInAccount, { account: key.accountLabel ?? words.signInNoAccount }) : `${words.providers[key.provider]} · ${key.keyPrefix}`}</span>
                  <StatusPill tone={look[key.status][0]} icon={look[key.status][1]} label={(so ? words.signInStatuses : words.statuses)[key.status]} />
                  {key.isDefault && <StatusPill tone="info" icon="ok" label={words.default} />}
                </div>
                {key.status === 'rejected' && (so || key.isDefault) && <p className="df-muted">{so ? words.signInRejectedNote : words.rejectedNote}</p>}
                <span className="df-muted">{key.lastTestedAt ? fill(words.lastTested, { when: when.format(new Date(key.lastTestedAt)) }) : words.neverTested}</span>
                {mayChange && (
                  <div className="df-settings-row-actions">
                    <button type="button" className="df-button" disabled={working} onClick={() => act(testAiKey(key.id), testToast(key))}>
                      {words.test}
                    </button>
                    {so && (
                      <button type="button" className={key.status === 'ok' ? 'df-button' : 'df-button df-button--primary'} disabled={!available[key.provider] || working} onClick={() => signIn(key.provider, key.id)}>
                        {flow === 'redirect' && flowFor === key.id ? words.signIn.opening : words.reconnect}
                      </button>
                    )}
                    <button type="button" className="df-button" disabled={working || key.isDefault} onClick={() => act(setDefaultAiKey(key.id), () => fill(words.toasts.default, { name: key.name }))}>
                      {words.makeDefault}
                    </button>
                    <button type="button" className="df-button" disabled={working} onClick={() => setOpen({ kind: 'remove', key })}>
                      {so ? words.disconnect : words.remove}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>
      {open?.kind === 'add' && (
        <AddDialog
          onDone={() => {
            setOpen(null)
            onToast(words.toasts.added)
            reload()
          }}
          onCancel={() => setOpen(null)}
        />
      )}
      {open?.kind === 'remove' && (
        <RemoveDialog
          target={open.key}
          keys={keys}
          onDone={() => {
            setOpen(null)
            onToast(fill(open.key.authType === 'oauth' ? words.toasts.disconnected : words.toasts.removed, { name: open.key.name }))
            reload()
          }}
          onCancel={() => setOpen(null)}
        />
      )}
    </div>
  )
}
