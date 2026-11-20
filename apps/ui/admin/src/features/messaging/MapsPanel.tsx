import { StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import { useId } from 'react'
import type { MapsProblem, PlatformMaps } from '../../api/messaging'
import { fill, formatTime, messages } from '../../messages'
import type { MessagingProps } from './Messaging'
import { Button, Fact } from './parts'

const words = messages.messaging.maps
const look: Record<NonNullable<PlatformMaps['key']>['status'], { tone: StatusTone; icon: StatusIconName }> = {
  ok: { tone: 'success', icon: 'ok' },
  untested: { tone: 'neutral', icon: 'clock' },
  rejected: { tone: 'danger', icon: 'cross' },
}

/** The map page's host in this environment, where the key's website restriction must allow: `admin.x` becomes `hooks.x` and `dev-admin.x` becomes `dev-hooks.x`. */
export const hooksHostFor = (hostname: string): string => {
  const host = hostname.toLowerCase()
  const swapped = host.replace(/^([^.]*?)admin(?=\.)/, '$1hooks')
  return swapped !== host ? swapped : `hooks.${host}`
}

const HowToGetKey = ({ hooksHost }: { hooksHost: string }) => {
  const referrer = `https://${hooksHost}/*`
  return (
    <details className="df-messaging-howto">
      <summary>{words.howTo.summary}</summary>
      <div className="df-messaging-howto-body">
        <p className="df-muted">{words.howTo.intro}</p>
        <ol className="df-messaging-steps">
          {words.howTo.steps.map((step) => {
            const [before = '', after = ''] = step.split('{referrer}')
            return (
              <li key={step}>
                {before}
                {step.includes('{referrer}') && <code>{referrer}</code>}
                {after}
              </li>
            )
          })}
        </ol>
        <p className="df-muted">{fill(words.howTo.hostNote, { host: hooksHost })}</p>
        <div className="df-messaging-howto-more">
          <section>
            <h3>{words.howTo.rolesTitle}</h3>
            <ul>
              {words.howTo.roles.map((role) => (
                <li key={role}>{role}</li>
              ))}
            </ul>
          </section>
          <section>
            <h3>{words.howTo.linksTitle}</h3>
            <ul>
              {words.howTo.links.map((link) => (
                <li key={link.href}>
                  <a href={link.href} target="_blank" rel="noreferrer">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </details>
  )
}

/** DripFunnel's Google Maps browser key (#1613): shown as its last four, set up and checked with Google, switched On or Off. */
export const MapsPanel = ({ data, manage, testing, problem, hooksHost, onAction, onTest }: { data: PlatformMaps; manage: boolean; problem: MapsProblem | null; hooksHost: string } & Pick<MessagingProps, 'testing' | 'onAction' | 'onTest'>) => {
  const noteId = useId()
  const { enabled, key } = data
  const busy = testing !== null
  const canTurnOn = key?.status === 'ok'
  const why = key?.status === 'rejected' ? words.rejectedNote : key && !enabled && !canTurnOn ? words.needsWorking : null
  return (
    <section className="df-panel df-panel--wide" aria-labelledby="messaging-maps" aria-busy={testing === 'maps'}>
      <div className="df-panel-head">
        <h2 id="messaging-maps">{words.title}</h2>
        <StatusPill tone={enabled ? 'success' : 'neutral'} icon={enabled ? 'ok' : 'ban'} label={enabled ? words.on : words.off} />
      </div>
      <p className="df-muted df-messaging-note">{words.note}</p>
      {key ? (
        <dl className="df-facts">
          <Fact term={words.keyLabel}>
            <code>{key.hint}</code>
          </Fact>
          <Fact term={words.statusLabel}>
            <span className="df-messaging-status">
              <StatusPill {...look[key.status]} label={words.statuses[key.status]} />
              <span className="df-muted">{key.lastTestedAt ? fill(words.lastChecked, { when: formatTime(key.lastTestedAt) }) : words.neverChecked}</span>
            </span>
          </Fact>
        </dl>
      ) : (
        <p className="df-muted">{words.none}</p>
      )}
      {problem && key?.status === 'rejected' && <p role="alert">{words.problems[problem]}</p>}
      {why && (
        <p id={noteId} className="df-muted">
          {why}
        </p>
      )}
      {key?.status === 'ok' && <p className="df-muted">{words.restrictedNote}</p>}
      {manage && (
        <div className="df-messaging-actions">
          <Button label={key ? words.replace : words.setUp} primary={!key} disabled={busy} onClick={() => onAction({ kind: 'mapsSave' })} />
          {key && <Button label={testing === 'maps' ? messages.messaging.testing : words.test} disabled={busy} onClick={() => onTest('maps')} />}
          {key &&
            (enabled ? (
              <Button label={words.turnOff} disabled={busy} onClick={() => onAction({ kind: 'mapsOff' })} />
            ) : (
              <button type="button" className="df-button df-button--primary" disabled={busy || !canTurnOn} aria-describedby={why ? noteId : undefined} onClick={() => onAction({ kind: 'mapsOn' })}>
                {words.turnOn}
              </button>
            ))}
          {key && <Button label={words.remove} disabled={busy} onClick={() => onAction({ kind: 'mapsRemove' })} />}
        </div>
      )}
      <HowToGetKey hooksHost={hooksHost} />
    </section>
  )
}
