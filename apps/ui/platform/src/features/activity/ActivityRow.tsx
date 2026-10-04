import { ActivityFact, activityResultLook, StatusPill } from '@dripfunnel/shared/ui'
import { useId } from 'react'
import type { ActivityEntry } from '../../api/activity'
import { fill, formatTime, messages } from '../../messages'
import { entryText, kindOf, whoOf } from './activityText'

const words = messages.activity

export interface ActivityRowProps {
  entry: ActivityEntry
  open: boolean
  onToggle: () => void
}

const fieldNames: Record<string, string> = words.fields

// A changed field in words; one this console has no words for shows as the API names it.
export const fieldName = (field: string): string => fieldNames[field] ?? field

// One entry as the prototype draws it: the time, the sentence and the result, opening to When ·
// Who (kind) · Store · Before · After · Reason (§13).
export const ActivityRow = ({ entry, open, onToggle }: ActivityRowProps) => {
  const detailsId = useId()
  const time = formatTime(entry.at)
  const tag = entry.through === 'setup_session' ? words.tags.setup_session : entry.through === 'support_session' ? words.tags.support_session : null
  return (
    <li className="df-log-row">
      <button type="button" className="df-log-line" aria-expanded={open} aria-controls={detailsId} onClick={onToggle}>
        <span className="df-log-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="df-log-time">{time}</span>
        <span className="df-log-text">
          {tag && <span className="df-log-tag">{tag}</span>}
          {entryText(entry)}
        </span>
        <StatusPill {...activityResultLook[entry.result]} label={words.filters.results[entry.result]} />
      </button>
      {open && (
        <dl id={detailsId} className="df-activity-facts">
          <ActivityFact label={words.facts.when}>{time}</ActivityFact>
          <ActivityFact label={words.facts.who}>{fill(words.facts.whoValue, { who: whoOf(entry), kind: kindOf(entry) })}</ActivityFact>
          {entry.storeName && <ActivityFact label={words.facts.store}>{entry.storeName}</ActivityFact>}
          {entry.changes.map((change) => (
            <ActivityFact key={`before-${change.field}`} label={`${words.facts.before} · ${fieldName(change.field)}`}>
              {change.before ?? words.facts.empty}
            </ActivityFact>
          ))}
          {entry.changes.map((change) => (
            <ActivityFact key={`after-${change.field}`} label={`${words.facts.after} · ${fieldName(change.field)}`}>
              {change.after ?? words.facts.empty}
            </ActivityFact>
          ))}
          {entry.reason && <ActivityFact label={words.facts.reason}>{entry.reason}</ActivityFact>}
        </dl>
      )}
    </li>
  )
}
