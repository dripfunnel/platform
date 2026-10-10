import { ConfirmDialog, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import { useId, useRef, useState } from 'react'
import { addWebhook, removeWebhook, replayDelivery, turnOnWebhook, type WebhookDelivery, type WebhookEndpoint } from '../../api/developers'
import { fill, formatCount, formatTime, messages, plural } from '../../messages'
import { isHttps } from '../common/https'
import { refusalIn } from '../common/refusal'
import { SecretOnce } from './SecretOnce'
import { useFreshList } from './useFreshList'

const words = messages.settings.developers.hooks
const refusalOf = refusalIn(words.refused)

/** SetDev ticks this one on a new endpoint. */
const firstEvent = 'order.placed'

type Ask = Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel'>

interface HookForm {
  url: string
  events: readonly string[]
  error: string | null
}

type Log = { id: string; kind: 'loading' } | { id: string; kind: 'error' } | { id: string; kind: 'ready'; deliveries: readonly WebhookDelivery[] }

export interface WebhooksCardProps {
  initial: readonly WebhookEndpoint[]
  events: readonly string[]
  read: () => Promise<WebhookEndpoint[]>
  deliveries: (endpointId: string) => Promise<WebhookDelivery[]>
  canEdit: boolean
  onToast: (text: string) => void
}

const tone = { active: 'ok', failing: 'warn', disabled: 'bad' } as const

/** A delivery's answer: the server's status code, or what stopped it, in words (apps/api/src/apis/store/webhooks.ts). */
export const outcomeOf = (d: WebhookDelivery): { text: string; ok: boolean } => {
  if (d.status === 'pending' || d.status === 'held') return { text: words.outcome[d.status], ok: false }
  if (d.responseCode !== null && (d.status === 'delivered' || d.error === 'status')) return { text: String(d.responseCode), ok: d.status === 'delivered' }
  return { text: (words.outcome as Record<string, string>)[d.error ?? 'failed'] ?? words.outcome.failed, ok: false }
}

export const durationOf = (ms: number | null): string => (ms === null ? '' : ms < 1000 ? fill(words.duration.ms, { count: formatCount(ms) }) : fill(words.duration.s, { count: (ms / 1000).toFixed(1) }))

/** Developers › Webhooks (SetDev): endpoints with their events and state, the signing secret once, deliveries and sending again. */
export const WebhooksCard = ({ initial, events, read, deliveries, canEdit, onToast }: WebhooksCardProps) => {
  const id = useId()
  const { list: hooks, stale, refresh } = useFreshList(initial, read)
  const [form, setForm] = useState<HookForm | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<Log | null>(null)
  const latestLog = useRef(0)
  const ro = !canEdit || busy

  const readLog = (endpointId: string) => {
    const ask = ++latestLog.current
    setLog({ id: endpointId, kind: 'loading' })
    void deliveries(endpointId).then(
      (list) => ask === latestLog.current && setLog({ id: endpointId, kind: 'ready', deliveries: list }),
      () => ask === latestLog.current && setLog({ id: endpointId, kind: 'error' }),
    )
  }
  const toggleLog = (endpointId: string) => {
    if (log?.id !== endpointId) return readLog(endpointId)
    latestLog.current++
    setLog(null)
  }

  const open = () => {
    setNote(null)
    setSecret(null)
    setForm({ url: '', events: events.includes(firstEvent) ? [firstEvent] : [], error: null })
  }

  const add = async (f: HookForm) => {
    const url = f.url.trim()
    const problem = !isHttps(url) ? words.notHttps : f.events.length === 0 ? words.eventsMissing : null
    if (problem) return setForm({ ...f, error: problem })
    setForm({ ...f, error: null })
    setBusy(true)
    try {
      const saved = await addWebhook(url, f.events)
      setForm(null)
      setSecret(saved.secret)
      onToast(words.added)
      void refresh()
    } catch (error) {
      setForm({ ...f, error: refusalOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const act = async (work: () => Promise<string>, after: () => void) => {
    setBusy(true)
    setNote(null)
    try {
      onToast(await work())
      after()
    } catch (error) {
      setNote(refusalOf(error))
    } finally {
      setBusy(false)
    }
  }

  const turnOn = (hook: WebhookEndpoint) =>
    void act(
      async () => {
        const sent = await turnOnWebhook(hook.id)
        return sent === 0 ? words.turnedOnNone : fill(plural(words.turnedOn, sent), { count: formatCount(sent) })
      },
      () => void refresh(),
    )

  const replay = (hook: WebhookEndpoint, d: WebhookDelivery) =>
    void act(
      async () => (await replayDelivery(d.id), fill(words.replayed, { event: d.event })),
      () => readLog(hook.id),
    )

  const askRemove = (hook: WebhookEndpoint) =>
    setAsk({
      title: fill(words.removeName, { url: hook.url }) + '?',
      target: hook.url,
      consequence: words.removeBody,
      confirmLabel: words.removeGo,
      danger: true,
      onConfirm: () =>
        void act(
          async () => (await removeWebhook(hook.id), words.removed),
          () => {
            if (log?.id === hook.id) setLog(null)
            void refresh()
          },
        ),
    })

  const toggleEvent = (f: HookForm, event: string) => setForm({ ...f, events: f.events.includes(event) ? f.events.filter((e) => e !== event) : [...f.events, event], error: null })

  const deliveriesOf = (hook: WebhookEndpoint) => {
    if (log?.id !== hook.id) return null
    if (log.kind === 'loading') return <p className="df-set-help">{words.logLoading}</p>
    if (log.kind === 'error')
      return (
        <p className="df-set-problem" role="alert">
          {words.logFailed}{' '}
          <button type="button" className="df-set-link" onClick={() => readLog(hook.id)}>
            {messages.settings.error.retry}
          </button>
        </p>
      )
    if (log.deliveries.length === 0) return <p className="df-set-help">{words.logEmpty}</p>
    return (
      <ul className="df-dev-log" aria-label={fill(words.logLabel, { url: hook.url })}>
        {log.deliveries.map((d) => {
          const outcome = outcomeOf(d)
          return (
            <li key={d.id}>
              <span className="df-dev-muted">{formatTime(d.createdAt)}</span>
              <code className="df-dev-mono">{d.event}</code>
              <span className={outcome.ok ? 'df-dev-ok' : 'df-dev-bad'}>{outcome.text}</span>
              <span className="df-dev-muted">{durationOf(d.durationMs)}</span>
              <button type="button" className="df-set-link" disabled={ro} aria-label={fill(words.replayName, { event: d.event })} onClick={() => replay(hook, d)}>
                {words.replay}
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <section className="df-dev-section" aria-labelledby={`${id}-hooks`}>
      <div className="df-dev-head">
        <div>
          <h2 id={`${id}-hooks`} className="df-dev-h2">
            {words.title}
          </h2>
          <p className="df-set-sub">{words.sub}</p>
        </div>
        <button type="button" className="df-button" disabled={ro || form !== null} onClick={open}>
          {words.add}
        </button>
      </div>
      {secret && <SecretOnce title={words.secretTitle} warning={words.secretWarn} secret={secret} onStored={() => setSecret(null)} />}
      {form && (
        <form
          className="df-set-card df-dev-new"
          aria-label={words.add}
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void add(form)
          }}
        >
          {form.error && (
            <p className="df-set-failure" role="alert">
              {form.error}
            </p>
          )}
          <div className="df-set-field">
            <label htmlFor={`${id}-url`}>{words.url}</label>
            <input id={`${id}-url`} type="url" inputMode="url" value={form.url} placeholder={words.urlPlaceholder} onChange={(event) => setForm({ ...form, url: event.target.value, error: null })} />
          </div>
          <fieldset className="df-dev-checks">
            <legend className="df-set-label">{words.events}</legend>
            {events.map((event) => (
              <label key={event} className="df-tax-check">
                <input type="checkbox" checked={form.events.includes(event)} onChange={() => toggleEvent(form, event)} />
                <code className="df-dev-mono">{event}</code>
              </label>
            ))}
          </fieldset>
          <div className="df-dev-buttons">
            <button type="submit" className="df-button df-button--primary" disabled={busy}>
              {words.add}
            </button>
            <button type="button" className="df-button" disabled={busy} onClick={() => setForm(null)}>
              {messages.settings.developers.cancel}
            </button>
          </div>
        </form>
      )}
      {note && (
        <p className="df-set-failure" role="alert">
          {note}
        </p>
      )}
      {stale && (
        <p className="df-set-warning" role="status">
          {words.stale}
        </p>
      )}
      {hooks.length === 0 && <p className="df-dev-empty">{words.empty}</p>}
      {hooks.map((hook) => (
        <article key={hook.id} className="df-set-card df-dev-hook" aria-label={hook.url}>
          <div className="df-dev-hook-top">
            <span className="df-dev-cell">
              <code className="df-dev-url">{hook.url}</code>
              <span className="df-dev-muted">{hook.events.join(' · ')}</span>
            </span>
            <span className={`df-dev-pill df-dev-pill--${tone[hook.status]}`}>{words.status[hook.status]}</span>
          </div>
          {hook.status === 'failing' && hook.failingSince && <p className="df-set-help">{fill(words.failingSince, { time: formatTime(hook.failingSince) })}</p>}
          {hook.status === 'disabled' && (
            <div className="df-set-warning df-dev-warn df-dev-off">
              <span>{fill(words.disabled, { time: hook.disabledAt ? formatTime(hook.disabledAt) : '' })}</span>
              <button type="button" className="df-button df-button--small" disabled={ro} onClick={() => turnOn(hook)}>
                {words.turnOn}
              </button>
            </div>
          )}
          <div className="df-dev-buttons">
            <button type="button" className="df-set-link" aria-expanded={log?.id === hook.id} onClick={() => toggleLog(hook.id)}>
              {log?.id === hook.id ? words.hideLog : words.showLog}
            </button>
            <button type="button" className="df-set-link df-dev-danger" disabled={ro} aria-label={fill(words.removeName, { url: hook.url })} onClick={() => askRemove(hook)}>
              {words.remove}
            </button>
          </div>
          {deliveriesOf(hook)}
        </article>
      ))}
      {ask && (
        <ConfirmDialog
          key={`${ask.title}|${ask.confirmLabel}`}
          {...ask}
          open
          cancelLabel={messages.settings.developers.cancel}
          onCancel={() => setAsk(null)}
          onConfirm={(...args) => {
            setAsk(null)
            ask.onConfirm(...args)
          }}
        />
      )}
    </section>
  )
}
