import { Icon, type StatusIconName } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import { Fragment, useId, type ReactNode } from 'react'
import type { ActivityEntry, ActivityResult, PersonKind } from '../../api/activity'
import { fill, formatTime, messages } from '../../messages'
import { changeText, entryParts, whoOf } from './activityText'
import { StatusPill, type StatusTone } from './StatusPill'
import './activity.css'

const words = messages.activity
const personKinds: readonly string[] = ['staff', 'partner_user', 'person', 'customer'] satisfies PersonKind[]

const resultLook: Record<ActivityResult, { tone: StatusTone; icon: StatusIconName }> = {
  success: { tone: 'success', icon: 'ok' },
  denied: { tone: 'warning', icon: 'ban' },
  failed: { tone: 'danger', icon: 'alert' },
}

const PersonLink = ({ id, children }: { id: string; children: ReactNode }) => (
  <Link to="/activity" search={{ person: id }} className="df-row-link">
    {children}
  </Link>
)

const TargetLink = ({ target }: { target: NonNullable<ActivityEntry['target']> }) => {
  switch (target.type) {
    case 'partner':
      return <Link to="/partners/$partnerId" params={{ partnerId: target.id }} className="df-row-link">{target.label}</Link>
    case 'store':
      return <Link to="/stores/$storeId" params={{ storeId: target.id }} className="df-row-link">{target.label}</Link>
    case 'customer':
      return <Link to="/customers/$customerId" params={{ customerId: target.id }} className="df-row-link">{target.label}</Link>
    default:
      return <>{target.label}</>
  }
}

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="df-activity-fact">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
)

const sessionLabel = { impersonation: words.facts.impersonation, setupSession: words.facts.setupSession, supportSession: words.facts.supportSession }

// Staff sessions have a page (#46); a partner's support session is the merchant's to show.
const SessionFact = ({ access }: { access: NonNullable<ActivityEntry['access']> }) => (
  <Fact label={sessionLabel[access.kind]}>
    <span className="df-activity-session">
      {access.kind === 'supportSession' ? (
        <span>{fill(words.facts.session, { id: access.id })}</span>
      ) : (
        <Link to="/impersonate/sessions/$sessionId" params={{ sessionId: access.id }} className="df-row-link">
          {fill(words.facts.session, { id: access.id })}
        </Link>
      )}
      {access.kind === 'impersonation' && (
        <Link to="/activity" search={{ imp: access.id }} className="df-row-link">{words.facts.allEntries}</Link>
      )}
      {access.kind === 'setupSession' && (
        <Link to="/activity" search={{ su: access.id }} className="df-row-link">{words.facts.allEntries}</Link>
      )}
    </span>
  </Fact>
)

const Details = ({ entry, id }: { entry: ActivityEntry; id: string }) => (
  <dl id={id} className="df-activity-facts">
    <Fact label={words.facts.exactTime}>{fill(words.facts.exactValue, { time: entry.occurredAt.replace('T', ' ').slice(0, 19) })}</Fact>
    <Fact label={words.facts.level}>{words.levels[entry.level]}</Fact>
    {entry.reason && <Fact label={words.facts.reason}>{entry.reason}</Fact>}
    {entry.changes.length > 0 && (
      <Fact label={words.facts.changes}>
        <ul className="df-activity-changes">
          {entry.changes.map((change) => (
            <li key={change.field}>{changeText(change)}</li>
          ))}
        </ul>
      </Fact>
    )}
    {entry.onBehalfOf && (
      <>
        <Fact label={words.facts.agent}>
          <PersonLink id={entry.onBehalfOf.id}>{entry.onBehalfOf.label}</PersonLink>
        </Fact>
        <Fact label={words.facts.actingAs}>{entry.actor.label}</Fact>
      </>
    )}
    {entry.access && <SessionFact access={entry.access} />}
    {entry.ip && <Fact label={words.facts.ip}>{entry.ip}</Fact>}
    {entry.userAgent && <Fact label={words.facts.userAgent}>{entry.userAgent}</Fact>}
    <Fact label={words.facts.requestId}>{entry.requestId}</Fact>
    <Fact label={words.facts.entry}>{entry.id}</Fact>
  </dl>
)

export interface ActivityRowProps {
  entry: ActivityEntry
  open: boolean
  onToggle: () => void
}

// One entry as the prototype draws it; read-only, so the only control opens its details.
export const ActivityRow = ({ entry, open, onToggle }: ActivityRowProps) => {
  const detailsId = useId()
  const time = formatTime(entry.occurredAt)
  const personId = entry.actor.kind === 'support_session' ? entry.onBehalfOf?.id : personKinds.includes(entry.actor.kind) ? entry.actor.id : null
  const who = whoOf(entry)
  const kind = entry.access?.kind === 'impersonation' && entry.onBehalfOf ? words.facts.impersonation : words.actorKinds[entry.actor.kind]
  return (
    <li className={entry.level === 'security' ? 'df-activity-row df-activity-row--security' : 'df-activity-row'}>
      <div className="df-activity-line">
        <span className="df-activity-time">{time}</span>
        <span className="df-activity-who">
          {personId ? <PersonLink id={personId}>{who}</PersonLink> : <strong>{who}</strong>}
          <span className="df-muted">{kind}</span>
        </span>
        <span className="df-activity-text">
          {entry.level === 'security' && (
            <span className="df-activity-badge">
              <Icon name="shield" size={11} strokeWidth={2.4} />
              {words.row.security}
            </span>
          )}
          <span>
            {entryParts(entry).map((part, index, parts) => (
              <Fragment key={index}>
                {part}
                {entry.target && index < parts.length - 1 && <TargetLink target={entry.target} />}
              </Fragment>
            ))}
          </span>
        </span>
        <span className="df-activity-where">
          {entry.partner ? (
            <Link to="/partners/$partnerId" params={{ partnerId: entry.partner.id }} className="df-row-link">{entry.partner.name}</Link>
          ) : (
            <span className="df-muted">{words.row.platform}</span>
          )}
          {entry.store && (
            <>
              <span className="df-muted" aria-hidden="true"> › </span>
              <Link to="/stores/$storeId" params={{ storeId: entry.store.id }} className="df-row-link">{entry.store.name}</Link>
            </>
          )}
        </span>
        <StatusPill {...resultLook[entry.result]} label={words.results[entry.result]} />
        <button
          type="button"
          className="df-activity-toggle"
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={fill(words.row.detailsLabel, { time })}
          onClick={onToggle}
        >
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>
      </div>
      {open && <Details entry={entry} id={detailsId} />}
    </li>
  )
}
