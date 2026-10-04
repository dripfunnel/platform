import { StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import type { Store, StorePerson, StoreSession } from '../../../api/stores'
import { fill, formatTime, messages } from '../../../messages'
import { roleOf } from '../../common/storeRoles'

const words = messages.store.support

const personLook: Record<StorePerson['status'], { tone: StatusTone; icon: StatusIconName }> = {
  active: { tone: 'success', icon: 'ok' },
  invited: { tone: 'info', icon: 'hour' },
  suspended: { tone: 'solid', icon: 'ban' },
}

const sessionLook: Record<StoreSession['how'], { tone: StatusTone; icon: StatusIconName }> = {
  open: { tone: 'info', icon: 'clock' },
  expired: { tone: 'neutral', icon: 'clock' },
  ended: { tone: 'success', icon: 'ok' },
}

// Support (§6.3): the merchant's consent, its people, past sessions. A session starts through
// Support's own flow (§12.2); `onStart` is absent for a role or a staff session that can't start one.
export const SupportTab = ({ store, partner, onStart }: { store: Store; partner: string; onStart?: ((person: StorePerson) => void) | undefined }) => {
  const canStart = onStart !== undefined && store.support.allowed
  const owner = store.owner.name.split(' ')[0] ?? store.owner.name
  return (
    <div className="df-panels">
      <p className={`df-store-notice df-panel--wide ${store.support.allowed ? 'df-store-notice--success' : 'df-store-notice--warning'}`}>
        {store.support.allowed ? fill(words.on, { name: store.name, partner: partner.split(' ')[0] ?? partner }) : fill(words.off, { owner, name: store.name })}
      </p>
      <section className="df-panel df-panel--wide" aria-labelledby="store-people">
        <div className="df-panel-head">
          <h2 id="store-people">{fill(words.people, { name: store.name })}</h2>
          {!canStart && <span className="df-muted">{words.readOnly}</span>}
        </div>
        <ul className="df-rows">
          {store.support.people.map((person) => (
            <li key={person.id}>
              <span className="df-stack df-rows-lead">
                <strong>{person.name}</strong>
                <span className="df-muted">{person.email}</span>
              </span>
              <span>{roleOf(person.role, person.supplier)}</span>
              <StatusPill {...personLook[person.status]} label={words.statuses[person.status]} />
              <span className="df-muted">{person.lastSignInAt ? fill(words.lastSignIn, { time: formatTime(person.lastSignInAt) }) : words.neverSignedIn}</span>
              {canStart && (
                <button type="button" className="df-button df-button--small" aria-label={fill(words.startFor, { name: person.name })} onClick={() => onStart(person)}>
                  {messages.support.open}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="df-panel df-panel--wide" aria-labelledby="store-sessions">
        <h2 id="store-sessions">{words.sessions}</h2>
        {store.support.sessions.length === 0 ? (
          <p className="df-muted">{words.noSessions}</p>
        ) : (
          <ul className="df-rows">
            {store.support.sessions.map((session) => (
              <li key={`${session.at}-${session.who}`}>
                <strong className="df-rows-lead">{session.who}</strong>
                <span>{session.reason}</span>
                <span className="df-muted">{formatTime(session.at)}</span>
                <StatusPill {...sessionLook[session.how]} label={words.how[session.how]} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
