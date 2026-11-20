import { ConfirmDialog, LoadingState, PermissionDenied, StatusPill } from '@dripfunnel/shared/ui'
import { useEffect, useState } from 'react'
import { loadPartnerSwitches, setPartnerSwitch, type MessagingChannel, type PartnerSwitches } from '../../api/messaging'
import { fill, messages } from '../../messages'
import { failureText } from '../common/failure'
import '../common/records.css'

const words = messages.partner.overview.dfMessaging
const channels: readonly MessagingChannel[] = ['sms', 'whatsapp', 'maps']

type Loaded = { state: 'loading' } | { state: 'error' } | { state: 'ready'; switches: PartnerSwitches | null }

export interface DfMessagingPanelProps {
  partner: { id: string; name: string }
  // Super admin, or a Partner manager (the API keeps one to its assigned partners); everyone else sees the state.
  mayChange: boolean
  onToast: (message: string) => void
}

/** Admin's three switches for one partner (#1543, #1613): whether it may use DripFunnel's SMS and WhatsApp accounts and Google Maps key, each with a reason. */
export const DfMessagingPanel = ({ partner, mayChange, onToast }: DfMessagingPanelProps) => {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState<{ channel: MessagingChannel; enabled: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    loadPartnerSwitches(partner.id).then(
      (switches) => current && setLoaded({ state: 'ready', switches }),
      () => current && setLoaded({ state: 'error' }),
    )
    return () => {
      current = false
    }
  }, [partner.id, attempt])

  const confirm = (reason: string | null) => {
    if (!open) return
    setError(null)
    setPartnerSwitch(partner.id, open.channel, open.enabled, reason ?? '').then(
      (switches) => {
        setLoaded({ state: 'ready', switches })
        setOpen(null)
        onToast(fill(words.done[open.enabled ? 'on' : 'off'], { channel: words.channels[open.channel], name: partner.name }))
      },
      (failure: unknown) => setError(failureText(failure, messages.partner.toasts.failed)),
    )
  }
  const text = open ? words.dialogs[open.channel] : null
  const label = (on: boolean) => (on ? words.turnOff : words.turnOn)

  return (
    <section className="df-panel" aria-labelledby="partner-df-messaging" aria-busy={loaded.state === 'loading'}>
      <h2 id="partner-df-messaging">{words.title}</h2>
      <p className="df-muted">{words.note}</p>
      {loaded.state === 'loading' && <LoadingState label={words.loading} rows={2} />}
      {loaded.state === 'error' && (
        <div>
          <p className="df-muted">{words.error}</p>
          <button type="button" className="df-button" onClick={() => (setLoaded({ state: 'loading' }), setAttempt((n) => n + 1))}>
            {words.retry}
          </button>
        </div>
      )}
      {loaded.state === 'ready' && loaded.switches && (
        <ul className="df-checklist">
          {channels.map((channel) => {
            const on = loaded.switches?.[channel] ?? false
            return (
              <li key={channel}>
                <div>
                  <p>{words.channels[channel]}</p>
                  <StatusPill tone={on ? 'success' : 'neutral'} icon={on ? 'ok' : 'ban'} label={on ? words.on : words.off} />
                </div>
                {mayChange ? (
                  <button type="button" className="df-button" aria-label={`${label(on)}: ${words.channels[channel]}`} onClick={() => (setError(null), setOpen({ channel, enabled: !on }))}>
                    {label(on)}
                  </button>
                ) : (
                  <PermissionDenied actionLabel={label(on)} reason={words.denied} />
                )}
              </li>
            )
          })}
        </ul>
      )}
      {open && text && (
        <ConfirmDialog
          open
          danger={!open.enabled}
          title={fill(open.enabled ? text.onTitle : text.offTitle, { name: partner.name })}
          target={partner.name}
          consequence={fill(open.enabled ? text.onConsequence : text.offConsequence, { name: partner.name })}
          confirmLabel={open.enabled ? words.turnOn : words.turnOff}
          cancelLabel={words.cancel}
          reason={words.reason}
          error={error}
          onConfirm={confirm}
          onCancel={() => setOpen(null)}
        />
      )}
    </section>
  )
}
