import { ConfirmDialog, ErrorState, LoadingState, PermissionDenied, StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import { useEffect, useId, useState } from 'react'
import {
  loadSms,
  removeSms,
  routeProviders,
  saveSms,
  setSmsEnabled,
  setSmsRoute,
  smsMessages,
  smsProviders,
  smsRoutes,
  smsShapes,
  testSms,
  type SmsAccount,
  type SmsInput,
  type SmsMessage,
  type SmsPick,
  type SmsProvider,
  type SmsRefusal,
  type SmsResult,
  type SmsRoute,
  type SmsStatus,
} from '../../api/sms'
import { accountForRoute, senderOf, servesRoute } from '@dripfunnel/shared/messaging'
import { fill, locale, messages } from '../../messages'

const words = messages.settings.integrations.sms
const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
const look: Record<SmsAccount['status'], [StatusTone, StatusIconName]> = { ok: ['success', 'ok'], untested: ['neutral', 'clock'], rejected: ['danger', 'cross'] }

type Loaded = { state: 'loading' } | { state: 'error' } | { state: 'ready'; status: SmsStatus }
type Open = { kind: 'save' | 'remove'; provider: SmsProvider } | { kind: 'route'; route: SmsRoute } | { kind: 'on' | 'off' } | null
type Field = 'authKey' | 'accountSid' | 'authToken' | 'messagingServiceSid' | 'accessKeyId' | 'secretAccessKey' | 'region' | 'senderId' | 'entityId'

const name = (provider: SmsProvider) => words.providers[provider]
const refusalText = (reason: SmsRefusal, provider: SmsPick | null) => fill(words.refusals[reason], { provider: provider && provider !== 'dripfunnel' ? name(provider) : words.title })

type Sender = SmsProvider | 'dripfunnel' | null

/** Whose account sends the route, by the API's own rule (THIRD-PARTY-ACCESS §4); `ours` is DripFunnel's serving it for the partner. */
const senderFor = (accounts: readonly SmsAccount[], pick: SmsPick | null, route: SmsRoute, ours: boolean): Sender => {
  const own = accountForRoute(accounts, route, pick)?.provider ?? null
  const sender = senderOf(pick, own !== null, ours)
  return sender === 'own' ? own : sender
}
const who = (sender: Sender) => (sender === 'dripfunnel' ? words.sentBy.ours : sender ? fill(words.sentBy.yours, { provider: name(sender) }) : words.sentBy.none)
const routeOf = (status: SmsStatus, route: SmsRoute) => status.routes.find((r) => r.route === route)
const pickOf = (status: SmsStatus, route: SmsRoute) => routeOf(status, route)?.provider ?? null
const oursOn = (status: SmsStatus, route: SmsRoute) => routeOf(status, route)?.dripfunnel === true
// "Texts to {numbers} will go through {who}", or that none will where no account sends them.
const through = (template: string, numbers: string, sender: Sender) => (sender ? fill(template, { numbers, who: who(sender) }) : fill(words.noneTo, { numbers }))
const routeLine = (sender: Sender) => (sender ? fill(words.sentByLine, { who: who(sender) }) : words.unsent)

const SaveDialog = ({ provider, onDone, onCancel }: { provider: SmsProvider; onDone: () => void; onCancel: () => void }) => {
  const prefix = useId()
  const [values, setValues] = useState<Partial<Record<Field, string>>>({})
  const [templates, setTemplates] = useState<Partial<Record<SmsMessage, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const typed = (f: Field) => values[f]?.trim() ?? ''
  const ok = (f: Field) => smsShapes[f].test(typed(f))
  const ids = smsMessages.map((message) => ({ message, templateId: templates[message]?.trim() ?? '' }))
  const allTemplates = ids.every((t) => smsShapes.templateId.test(t.templateId))
  const indiaBlank = typed('senderId') === '' && typed('entityId') === '' && ids.every((t) => t.templateId === '')
  const input: SmsInput | null =
    provider === 'msg91'
      ? ok('authKey') && allTemplates
        ? { provider, authKey: typed('authKey'), templates: ids }
        : null
      : provider === 'twilio'
        ? ok('accountSid') && ok('authToken') && ok('messagingServiceSid')
          ? { provider, accountSid: typed('accountSid'), authToken: typed('authToken'), messagingServiceSid: typed('messagingServiceSid') }
          : null
        : ok('accessKeyId') && ok('secretAccessKey') && ok('region') && (indiaBlank || (ok('senderId') && ok('entityId') && allTemplates))
          ? { provider, accessKeyId: typed('accessKeyId'), secretAccessKey: typed('secretAccessKey'), region: typed('region'), ...(indiaBlank ? {} : { senderId: typed('senderId'), entityId: typed('entityId'), templates: ids }) }
          : null
  const save = () => {
    if (!input) return
    setError(null)
    saveSms(input).then(
      (r) => (r.ok ? onDone() : setError(refusalText(r.reason, provider))),
      () => setError(words.toasts.failed),
    )
  }
  const field = (f: Field) => (
    <div className="df-field" key={f}>
      <label htmlFor={`${prefix}-${f}`}>{words.fields[f]}</label>
      <input
        id={`${prefix}-${f}`}
        type={f === 'authKey' || f === 'authToken' || f === 'secretAccessKey' ? 'password' : 'text'}
        autoComplete="off"
        spellCheck={false}
        maxLength={80}
        value={values[f] ?? ''}
        onChange={(event) => setValues((v) => ({ ...v, [f]: event.target.value }))}
      />
      <p className="df-field-hint">{words.dialog.hints[f]}</p>
    </div>
  )
  const templateFields = smsMessages.map((message) => (
    <div className="df-field" key={message}>
      <label htmlFor={`${prefix}-${message}`}>{words.messages[message]}</label>
      <input id={`${prefix}-${message}`} type="text" autoComplete="off" spellCheck={false} maxLength={64} value={templates[message] ?? ''} onChange={(event) => setTemplates((t) => ({ ...t, [message]: event.target.value }))} />
    </div>
  ))
  return (
    <ConfirmDialog
      open
      wide
      title={fill(words.dialog.title, { provider: name(provider) })}
      target={fill(words.dialog.target, { provider: name(provider) })}
      consequence={fill(words.dialog.consequence, { provider: name(provider) })}
      confirmLabel={words.dialog.save}
      cancelLabel={messages.settings.integrations.cancel}
      blocked={input ? null : words.dialog.incomplete[provider]}
      error={error}
      onConfirm={save}
      onCancel={onCancel}
    >
      {provider === 'msg91' && [field('authKey'), <p key="templates" className="df-muted">{words.dialog.templatesMsg91}</p>, ...templateFields]}
      {provider === 'twilio' && [field('accountSid'), field('authToken'), field('messagingServiceSid')]}
      {provider === 'sns' && [field('accessKeyId'), field('secretAccessKey'), field('region'), <p key="india" className="df-muted">{words.dialog.indiaSns}</p>, field('senderId'), field('entityId'), ...templateFields]}
    </ConfirmDialog>
  )
}

const RouteDialog = ({ status, route, onDone, onCancel }: { status: SmsStatus; route: SmsRoute; onDone: (pick: SmsPick | null) => void; onCancel: () => void }) => {
  const [error, setError] = useState<string | null>(null)
  const numbers = words.routeNumbers[route]
  const [first, second] = routeProviders[route]
  const ours = oursOn(status, route)
  const pickFrom = (value: string): SmsPick | null => (ours && value === 'dripfunnel' ? 'dripfunnel' : (smsProviders.find((p) => p === value) ?? null))
  const hintOf = (provider: SmsProvider) => {
    const account = status.accounts.find((a) => a.provider === provider)
    return !account ? words.routeDialog.hints.missing : servesRoute(account, route) ? words.routeDialog.hints.complete : words.routeDialog.hints.incomplete
  }
  const options = [
    { value: '', label: fill(words.routeDialog.automatic, { first: name(first), second: name(second) }), hint: fill(words.routeDialog.today, { who: who(senderFor(status.accounts, null, route, ours)) }) },
    ...routeProviders[route].map((p) => ({ value: p, label: name(p), hint: hintOf(p) })),
    ...(ours ? [{ value: 'dripfunnel', label: words.routeDialog.ours, hint: fill(words.routeDialog.oursHint, { numbers }) }] : []),
  ]
  const current = pickOf(status, route)
  return (
    <ConfirmDialog
      open
      title={fill(words.routeDialog.title, { numbers })}
      target=""
      consequence={(_, picked) => through(words.routeDialog.consequence, numbers, senderFor(status.accounts, pickFrom(picked.provider ?? ''), route, ours))}
      confirmLabel={words.routeDialog.confirm}
      cancelLabel={messages.settings.integrations.cancel}
      choices={[
        {
          key: 'provider',
          label: words.routeDialog.label,
          options,
          // A pick of DripFunnel's that Admin has since turned off isn't offered, so the dialog starts on "whichever".
          initial: current && options.some((o) => o.value === current) ? current : '',
          error: (picked) => {
            const provider = smsProviders.find((p) => p === picked)
            const account = status.accounts.find((a) => a.provider === provider)
            return provider && !(account && servesRoute(account, route)) ? refusalText('ACCOUNT_INCOMPLETE', provider) : null
          },
        },
      ]}
      error={error}
      onConfirm={(_, __, picked) => {
        const provider = pickFrom(picked.provider ?? '')
        setError(null)
        setSmsRoute(route, provider).then(
          (r) => (r.ok ? onDone(provider) : setError(refusalText(r.reason, provider))),
          () => setError(words.toasts.failed),
        )
      }}
      onCancel={onCancel}
    />
  )
}

export interface SmsPanelProps {
  // False for a read-only console: the accounts show, nothing changes.
  mayChange: boolean
  // Why an impersonation can't use it, or null: every SMS field is refused to one, the read included (ACCESS §8.1).
  blocked: string | null
  onToast: (message: string) => void
}

// Integrations, SMS (#1018): drawn from the tab's own parts, as WhatsApp is (docs/ui/platform/FIRST-RELEASE.md §14.5).
export const SmsPanel = ({ mayChange, blocked, onToast }: SmsPanelProps) => {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState<Open>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [testing, setTesting] = useState<SmsProvider | null>(null)
  useEffect(() => {
    if (blocked) return
    let current = true
    loadSms().then(
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
        <h2 id="settings-sms">{words.title}</h2>
        {on !== null && <StatusPill tone={on ? 'success' : 'neutral'} icon={on ? 'ok' : 'ban'} label={on ? words.on : words.off} />}
      </div>
      <p className="df-muted">{words.note}</p>
    </>
  )
  if (blocked)
    return (
      <section className="df-panel df-panel--wide" aria-labelledby="settings-sms">
        {header(null)}
        <PermissionDenied actionLabel={words.blockedAction} reason={blocked} />
      </section>
    )
  if (loaded.state === 'loading') return <LoadingState label={words.loading} rows={3} />
  if (loaded.state === 'error') return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: () => (setLoaded({ state: 'loading' }), reload()) }} />
  const { status } = loaded
  const { enabled, accounts } = status
  const accountOf = (provider: SmsProvider) => accounts.find((a) => a.provider === provider) ?? null
  const close = () => setOpen(null)
  const finish = (toast: string) => {
    setOpen(null)
    onToast(toast)
    reload()
  }
  const test = (provider: SmsProvider) => {
    setTesting(provider)
    testSms(provider)
      .then(
        (r) => onToast(r.ok ? fill(r.status === 'rejected' ? words.toasts.rejected : words.toasts.ok, { provider: name(provider) }) : refusalText(r.reason, provider)),
        () => onToast(words.toasts.failed),
      )
      .finally(() => {
        setTesting(null)
        reload()
      })
  }
  // A confirmed change: its toast and a fresh read, or its refusal in words with the dialog left open.
  const confirm = (work: () => Promise<SmsResult>, provider: SmsProvider | null, done: string) => () => {
    setDialogError(null)
    work().then(
      (r) => (r.ok ? finish(done) : setDialogError(refusalText(r.reason, provider))),
      () => setDialogError(words.toasts.failed),
    )
  }
  const openDialog = (next: Open) => (setDialogError(null), setOpen(next))
  // What removing an account changes on each route it sends now, by the same rule the API sends by.
  const removeConsequence = (provider: SmsProvider) => {
    const left = accounts.filter((a) => a.provider !== provider)
    const changes = smsRoutes.flatMap((route) => {
      const pick = pickOf(status, route)
      const ours = oursOn(status, route)
      return senderFor(accounts, pick, route, ours) === provider ? [through(words.removeDialog.route, words.routeNumbers[route], senderFor(left, pick, route, ours))] : []
    })
    return [words.removeDialog.deleted, ...(changes.length ? changes : [words.removeDialog.none])].join(' ')
  }
  return (
    <section className="df-panel df-panel--wide" aria-labelledby="settings-sms" aria-busy={testing !== null}>
      {header(enabled)}
      <ul className="df-settings-keys">
        {smsRoutes.map((route) => (
          <li key={route}>
            <div className="df-settings-onfile">
              <strong>{words.routes[route]}</strong>
              <span className="df-muted">{enabled ? routeLine(senderFor(accounts, pickOf(status, route), route, oursOn(status, route))) : words.offRoute}</span>
              {mayChange && (routeProviders[route].some((p) => accountOf(p)) || oursOn(status, route)) && (
                <button type="button" className="df-button" aria-label={fill(words.change, { route: words.routes[route] })} disabled={testing !== null} onClick={() => openDialog({ kind: 'route', route })}>
                  {words.short.change}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="df-muted">{status.dripfunnel ? words.available : words.fallback}</p>
      <div className="df-settings-signin">
        {smsProviders.map((provider) => {
          const account = accountOf(provider)
          return (
            <div key={provider} aria-busy={testing === provider}>
              <div className="df-settings-onfile">
                <strong>{name(provider)}</strong>
                {account && <StatusPill tone={look[account.status][0]} icon={look[account.status][1]} label={words.statuses[account.status]} />}
              </div>
              <p className="df-muted">{words.serves[provider]}</p>
              {account ? (
                <>
                  <div className="df-settings-onfile">
                    <span>{words.secretLabels[provider]}</span>
                    <code>{account.hint}</code>
                  </div>
                  {account.templatesComplete !== null && <p className="df-muted">{account.templatesComplete ? words.india.complete : words.india.incomplete}</p>}
                  <span className="df-muted">{account.lastTestedAt ? fill(words.lastTested, { when: when.format(new Date(account.lastTestedAt)) }) : words.neverTested}</span>
                  {account.status === 'rejected' && <p className="df-muted">{fill(words.rejectedNote, { provider: name(provider) })}</p>}
                </>
              ) : (
                <p className="df-muted">{words.notSetUp}</p>
              )}
              {mayChange && (
                <div className="df-settings-onfile">
                  <button
                    type="button"
                    className={account ? 'df-button' : 'df-button df-button--primary'}
                    aria-label={fill(account ? words.replace : words.setUp, { provider: name(provider) })}
                    disabled={testing !== null}
                    onClick={() => openDialog({ kind: 'save', provider })}
                  >
                    {account ? words.short.replace : words.short.setUp}
                  </button>
                  {account && (
                    <button type="button" className="df-button" aria-label={testing === provider ? undefined : fill(words.test, { provider: name(provider) })} disabled={testing !== null} onClick={() => test(provider)}>
                      {testing === provider ? words.testing : words.short.test}
                    </button>
                  )}
                  {account && (
                    <button type="button" className="df-button" aria-label={fill(words.remove, { provider: name(provider) })} disabled={testing !== null} onClick={() => openDialog({ kind: 'remove', provider })}>
                      {words.short.remove}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {!enabled && <p className="df-muted">{words.offNote}</p>}
      {mayChange && (
        <div className="df-settings-row-actions">
          {enabled ? (
            <button type="button" className="df-button" disabled={testing !== null} onClick={() => openDialog({ kind: 'off' })}>
              {words.turnOff}
            </button>
          ) : (
            <button type="button" className="df-button df-button--primary" disabled={testing !== null} onClick={() => openDialog({ kind: 'on' })}>
              {words.turnOn}
            </button>
          )}
        </div>
      )}
      {open?.kind === 'save' && <SaveDialog provider={open.provider} onDone={() => finish(fill(words.toasts.saved, { provider: name(open.provider) }))} onCancel={close} />}
      {open?.kind === 'route' && (
        <RouteDialog status={status} route={open.route} onDone={(pick) => finish(through(words.toasts.route, words.routeNumbers[open.route], senderFor(accounts, pick, open.route, oursOn(status, open.route))))} onCancel={close} />
      )}
      {open?.kind === 'remove' && (
        <ConfirmDialog
          open
          danger
          title={fill(words.removeDialog.title, { provider: name(open.provider) })}
          target={fill(words.removeDialog.target, { provider: name(open.provider) })}
          consequence={removeConsequence(open.provider)}
          confirmLabel={words.removeDialog.confirm}
          cancelLabel={messages.settings.integrations.cancel}
          error={dialogError}
          onConfirm={confirm(() => removeSms(open.provider), open.provider, fill(words.toasts.removed, { provider: name(open.provider) }))}
          onCancel={close}
        />
      )}
      {(open?.kind === 'on' || open?.kind === 'off') && (
        <ConfirmDialog
          open
          danger={open.kind === 'off'}
          title={words[`${open.kind}Dialog`].title}
          target={words[`${open.kind}Dialog`].target}
          consequence={words[`${open.kind}Dialog`].consequence}
          confirmLabel={words[`${open.kind}Dialog`].confirm}
          cancelLabel={messages.settings.integrations.cancel}
          error={dialogError}
          onConfirm={confirm(() => setSmsEnabled(open.kind === 'on'), null, words.toasts[open.kind])}
          onCancel={close}
        />
      )}
    </section>
  )
}
