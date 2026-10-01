import type { ActivityEntry } from '../../api/activity'
import { messages } from '../../messages'
import { actionText, changeText, whoOf } from './activityText'

const words = messages.activity
const columns = words.export.columns

// A cell a spreadsheet would run as a formula is prefixed, so an exported label can't execute (OWASP CSV injection).
const cell = (value: string) => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

// The export's columns (decided on #44): no IP, and `changes` as one readable line per entry.
export const activityCsv = (entries: readonly ActivityEntry[]): string =>
  [
    [columns.time, columns.actor, columns.actorKind, columns.action, columns.target, columns.partner, columns.store, columns.result, columns.reason, columns.requestId, columns.changes],
    ...entries.map((entry) => [
      entry.occurredAt.replace('T', ' ').slice(0, 19),
      whoOf(entry),
      words.actorKinds[entry.actor.kind],
      actionText(entry),
      entry.target?.label ?? '',
      entry.partner?.name ?? '',
      entry.store?.name ?? '',
      words.results[entry.result],
      entry.reason ?? '',
      entry.requestId,
      entry.changes.map(changeText).join('; '),
    ]),
  ]
    .map((row) => row.map(cell).join(','))
    .join('\r\n')
