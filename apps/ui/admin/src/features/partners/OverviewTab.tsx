import type { HistoryEntry, Partner, SetupRow } from '../../api/partners'
import { fill, formatCountry, formatDate, formatCount, messages } from '../../messages'
import { StatusPill, type StatusTone } from '../common/StatusPill'
import type { StatusIconName } from '../shell/Icon'
import './partners.css'

const words = messages.partner.overview
const listWords = messages.partners

const statusLook: Record<SetupRow['status'], { tone: StatusTone; icon: StatusIconName }> = {
  done: { tone: 'success', icon: 'ok' },
  waitingForDns: { tone: 'warning', icon: 'clock' },
  notStarted: { tone: 'neutral', icon: 'pen' },
  waitingOnPartner: { tone: 'info', icon: 'hour' },
  invitationSent: { tone: 'info', icon: 'hour' },
  invitationHeld: { tone: 'neutral', icon: 'pause' },
}

const byLine = (row: SetupRow, partnerName: string) => {
  if (row.status === 'waitingOnPartner') return fill(words.partnerEnters, { org: partnerName })
  if (!row.by) return null
  return fill(row.status === 'done' ? words.doneBy : words.addedBy, row.by)
}

const eventText = (entry: HistoryEntry) => {
  const text = fill(words.events[entry.event], { by: entry.by ?? '' })
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
          <dd>{formatCountry(partner.country)}</dd>
          <dt>{words.created}</dt>
          <dd>{formatDate(partner.createdAt)}</dd>
          <dt>{words.owner}</dt>
          <dd>{partner.owner.name ? `${partner.owner.name} · ${partner.owner.email}` : partner.owner.email}</dd>
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
            const by = byLine(row, partner.name)
            return (
              <li key={row.item}>
                <div>
                  <p>{words.items[row.item]}</p>
                  {by && <p className="df-muted">{by}</p>}
                </div>
                <StatusPill {...statusLook[row.status]} label={fill(words.status[row.status], { org: partner.name })} />
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
