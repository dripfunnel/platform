import { StatusPill, type StatusTone } from '@dripfunnel/shared/ui'
import type { StatusIconName } from '@dripfunnel/shared/ui'
import type { HistoryEntry, Partner, SetupRow } from '../../api/partners'
import { fill, formatCountry, formatDate, formatCount, messages } from '../../messages'
import './partners.css'
import '../common/records.css'

const words = messages.partner.overview
const listWords = messages.partners

const statusLook: Record<SetupRow['status'], { tone: StatusTone; icon: StatusIconName }> = {
  done: { tone: 'success', icon: 'ok' },
  progress: { tone: 'info', icon: 'hour' },
  missing: { tone: 'neutral', icon: 'pen' },
}

const byLine = (row: SetupRow) => (row.by ? fill(row.status === 'done' ? words.doneBy : words.addedBy, row.by) : null)

const isWorded = (action: string): action is keyof typeof words.events => action in words.events

// The activity log's code, in the console's words; one it has no words for yet shows the code.
const eventText = (entry: HistoryEntry) => {
  const values = { by: entry.by ?? '', action: entry.action }
  const text = fill(isWorded(entry.action) ? words.events[entry.action] : words.events.other, values)
  return entry.note ? fill(words.eventNote, { event: text, note: entry.note }) : text
}

export const OverviewTab = ({ partner }: { partner: Partner }) => {
  const { setup } = partner
  return (
    <div className="df-panels">
      <section className="df-panel" aria-labelledby="partner-details">
        <h2 id="partner-details">{words.details}</h2>
        <dl className="df-facts">
          <dt>{words.kind}</dt>
          <dd>{partner.kind}</dd>
          <dt>{words.region}</dt>
          <dd>{partner.region}</dd>
          <dt>{words.country}</dt>
          <dd>{partner.country && formatCountry(partner.country)}</dd>
          <dt>{words.created}</dt>
          <dd>{formatDate(partner.createdAt)}</dd>
          <dt>{words.owner}</dt>
          <dd>{[partner.owner.name, partner.owner.email].filter(Boolean).join(' · ')}</dd>
        </dl>
        <h3>{words.contacts}</h3>
        <ul className="df-plain-list">
          {partner.contacts.map((contact) => (
            <li key={contact.email}>
              <span>
                <strong>{contact.name}</strong> · {contact.role}
              </span>
              <span className="df-muted">{contact.email}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="df-panel" aria-labelledby="partner-checklist">
        <div className="df-panel-head">
          <h2 id="partner-checklist">{words.checklist}</h2>
          <span className="df-muted">
            {setup.done === setup.total
              ? listWords.setupComplete
              : fill(listWords.setupProgress, { done: formatCount(setup.done), total: formatCount(setup.total) })}
          </span>
        </div>
        <ul className="df-checklist">
          {partner.checklist.map((row) => {
            const by = byLine(row)
            return (
              <li key={row.item}>
                <div>
                  <p>{words.items[row.item]}</p>
                  {row.detail && <p className="df-muted">{row.detail}</p>}
                  {by && <p className="df-muted">{by}</p>}
                </div>
                <StatusPill {...statusLook[row.status]} label={words.status[row.status]} />
              </li>
            )
          })}
        </ul>
      </section>
      <section className="df-panel df-panel--wide" aria-labelledby="partner-history">
        <h2 id="partner-history">{words.history}</h2>
        <ol className="df-history">
          {[...partner.history].reverse().map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              <time dateTime={entry.at} className="df-muted">
                {formatDate(entry.at)}
              </time>
              <span>{eventText(entry)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
