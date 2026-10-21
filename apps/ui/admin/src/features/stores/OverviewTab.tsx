import type { Store, StoreHistoryEntry } from '../../api/stores'
import { fill, formatCount, formatCountry, formatDate, messages } from '../../messages'
import { InfoNote } from '@dripfunnel/shared/ui'
import { StatusSub, StoreStatusPill } from './storeLook'
import './stores.css'
import '../common/records.css'

const words = messages.store.overview
const events = words.events

const countKeys = ['owners', 'managers', 'staff', 'suppliers'] as const

const isWorded = (action: string): action is keyof typeof events => action in events

// The activity log's code, in the console's words; one it has no words for yet shows the code.
const eventText = ({ action, by, note }: StoreHistoryEntry) => {
  const values = { by: by ?? '', note: note ?? '', action }
  if (action === 'store.past_due' && note) return fill(events['store.past_due_after'], values)
  return fill(isWorded(action) ? events[action] : events.other, values)
}

// The prototype's Overview: Details, Plan and status with its history, and who is in the store.
export const OverviewTab = ({ store }: { store: Store }) => {
  const details = [
    [words.name, store.name],
    [words.code, store.code],
    [words.partner, store.partner.name],
    [words.owner, [store.owner.name, store.owner.email].filter(Boolean).join(' · ') || messages.stores.noOwner],
    [words.country, store.country ? formatCountry(store.country) : ''],
    [words.created, formatDate(store.createdAt)],
  ] as const
  return (
    <div className="df-panels">
      <section className="df-panel" aria-labelledby="store-details">
        <h2 id="store-details">{words.details}</h2>
        <dl className="df-facts">
          {details.flatMap(([label, value]) => [<dt key={`${label}-label`}>{label}</dt>, <dd key={label}>{value}</dd>])}
        </dl>
      </section>
      <section className="df-panel" aria-labelledby="store-plan">
        <h2 id="store-plan">{words.planStatus}</h2>
        <div className="df-plan-line">
          <strong>{store.plan.name ?? messages.stores.noPlan}</strong>
          <span className="df-muted">{fill(words.planOf, { partner: store.partner.name })}</span>
          <StoreStatusPill state={store.state} />
        </div>
        <StatusSub state={store.state} />
        <ol className="df-history">
          {[...store.history].reverse().map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              <time dateTime={entry.at} className="df-muted">
                {formatDate(entry.at)}
              </time>
              <span>{eventText(entry)}</span>
            </li>
          ))}
        </ol>
      </section>
      <section className="df-panel df-panel--wide" aria-labelledby="store-counts">
        <h2 id="store-counts">{words.inStore}</h2>
        <dl className="df-counts">
          {countKeys.map((key) => (
            <div key={key}>
              <dt>{words.counts[key]}</dt>
              <dd>{formatCount(store.counts[key])}</dd>
            </div>
          ))}
        </dl>
        <InfoNote>{words.seeInside}</InfoNote>
      </section>
    </div>
  )
}
