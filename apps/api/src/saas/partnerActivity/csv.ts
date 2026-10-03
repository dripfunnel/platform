import { csvLine } from '#core/csv'
import type { ActivityRow } from '#db/schema/activity'

// One row per entry, as the screen expands it (FIRST-RELEASE §13): when, who, action, result,
// store, target, the changes and the reason. Never an address or a user agent (LOGGING §4).
const header = ['When (UTC)', 'Who', 'Who kind', 'Through', 'Action', 'Result', 'Store id', 'Target', 'Changes', 'Reason']

export const activityCsvHeader = csvLine(header)

export const activityCsvLine = (row: ActivityRow): string =>
  csvLine([
    row.occurred_at.toISOString(),
    row.actor_label,
    row.actor_kind,
    row.access_kind,
    row.action,
    row.result,
    row.store_id,
    row.target_label ?? row.target_id,
    row.changes.length > 0 ? JSON.stringify(row.changes) : null,
    row.reason,
  ])
