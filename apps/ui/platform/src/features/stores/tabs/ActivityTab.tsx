import { StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import { useState } from 'react'
import type { Store, StoreActivityEntry } from '../../../api/stores'
import { fill, formatTime, messages } from '../../../messages'

const words = messages.store.activity

const resultLook: Record<StoreActivityEntry['result'], { tone: StatusTone; icon: StatusIconName }> = {
  success: { tone: 'success', icon: 'ok' },
  denied: { tone: 'danger', icon: 'ban' },
  failed: { tone: 'warning', icon: 'alert' },
}

const Entry = ({ entry }: { entry: StoreActivityEntry }) => {
  const [open, setOpen] = useState(false)
  return (
    <li>
      <button type="button" className="df-activity-row" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span aria-hidden="true" className={open ? 'df-activity-chevron df-activity-chevron--open' : 'df-activity-chevron'}>
          ›
        </span>
        <time dateTime={entry.at} className="df-muted">
          {formatTime(entry.at)}
        </time>
        <span>{entry.text}</span>
        <StatusPill {...resultLook[entry.result]} label={words.results[entry.result]} />
      </button>
      {open && (
        <dl className="df-record df-activity-facts" aria-label={fill(words.details, { text: entry.text })}>
          {entry.facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  )
}

// Activity (§6.3): this account's entries from the fixture, newest first, until the Activity log card.
export const ActivityTab = ({ store }: { store: Store }) => (
  <div className="df-panels">
    <section className="df-panel df-panel--wide" aria-label={messages.store.tabs.activity}>
      {store.activity.length === 0 ? (
        <p className="df-muted">{words.none}</p>
      ) : (
        <ul className="df-activity">
          {store.activity.map((entry) => (
            <Entry key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  </div>
)
