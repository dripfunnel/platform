import { StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import type { Store, StoreActivityEntry } from '../../../api/stores'
import { fill, formatTime, messages } from '../../../messages'

const words = messages.store.activity

// An action the console has no words for yet shows as its code, never as nothing.
const actionWords = (action: string): string => (Object.hasOwn(words.actions, action) ? words.actions[action as keyof typeof words.actions] : action)

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
        <span>{actionWords(entry.action)}</span>
        <StatusPill {...resultLook[entry.result]} label={words.results[entry.result]} />
      </button>
      {open && (
        <dl className="df-record df-store-activity-facts" aria-label={fill(words.details, { text: actionWords(entry.action) })}>
          <div>
            <dt>{words.who}</dt>
            <dd>{entry.who}</dd>
          </div>
        </dl>
      )}
    </li>
  )
}

// Activity (§6.3): this account's newest entries; all of them are the Activity log filtered to the store (§13).
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
      <Link to="/activity" search={{ storeId: store.id }} className="df-row-link">
        {words.all}
      </Link>
    </section>
  </div>
)
