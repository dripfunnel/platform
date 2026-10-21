import type { ActivityEntry, ActivityLog } from '#auth/activity'
import { redactChanges } from '#core/redaction'
import type { NewActivityRow } from '#db/schema/activity'
import { insertActivities, insertActivity } from '#db/scoped/activity'

// LOGGING.md §4: the address and user agent belong to `auth` and `security` entries only.
const keepsRequestFacts = (entry: ActivityEntry): boolean => entry.category === 'auth' || entry.category === 'security'

export const toRow = (entry: ActivityEntry): NewActivityRow => ({
  occurred_at: entry.occurredAt ?? null,
  category: entry.category,
  action: entry.action,
  result: entry.result,
  actor_kind: entry.actorKind,
  actor_id: entry.actorId,
  actor_label: entry.actorLabel,
  on_behalf_of_kind: entry.onBehalfOf?.kind ?? null,
  on_behalf_of_id: entry.onBehalfOf?.id ?? null,
  on_behalf_of_label: entry.onBehalfOf?.label ?? null,
  access_kind: entry.access?.kind ?? null,
  access_ref: entry.access?.id ?? null,
  partner_id: entry.partnerId ?? null,
  store_id: entry.storeId ?? null,
  seller_id: entry.sellerId ?? null,
  customer_id: entry.customerId ?? null,
  target_type: entry.target?.type ?? null,
  target_id: entry.target?.id ?? null,
  target_label: entry.target?.label ?? null,
  changes: redactChanges(entry.changes ?? []),
  reason: entry.reason,
  api: entry.api ?? null,
  host: entry.host ?? null,
  request_id: entry.requestId,
  ip: keepsRequestFacts(entry) ? entry.ip : null,
  user_agent: keepsRequestFacts(entry) ? entry.userAgent : null,
  visibility: entry.visibility,
})

/** Writes in the caller's transaction, so the entry commits or rolls back with the change (LOGGING.md §5). */
export const activityLog: ActivityLog = {
  record: async (tx, entry) => {
    await insertActivity(tx, toRow(entry))
  },
  recordAll: async (tx, entries) => {
    await insertActivities(tx, entries.map(toRow))
  },
}
