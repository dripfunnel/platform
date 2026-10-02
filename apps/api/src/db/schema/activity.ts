import type { RecordedChange } from '#core/redaction'

// The entry of LOGGING.md §4, as the `activity_log` table stores it (migrations/0006).

export const activityCategories = ['auth', 'write', 'support', 'system', 'security'] as const
export type ActivityCategory = (typeof activityCategories)[number]

export const activityResults = ['success', 'denied', 'failed'] as const
export type ActivityResult = (typeof activityResults)[number]

export const actorKinds = [
  'staff',
  'partner_user',
  'person',
  'customer',
  'api_key',
  'app_grant',
  'support_session',
  'job',
  'provider',
  'anonymous',
] as const
export type ActorKind = (typeof actorKinds)[number]

export const agentKinds = ['staff', 'partner_user'] as const
export type AgentKind = (typeof agentKinds)[number]

export const accessKinds = ['impersonation', 'setup_session', 'support_session'] as const
export type AccessKind = (typeof accessKinds)[number]

export const activityApis = ['admin', 'platform', 'store', 'shop', 'system'] as const
export type ActivityApi = (typeof activityApis)[number]

/** The lowest audience allowed to see the entry (LOGGING.md §4, §6). */
export const visibilities = ['staff', 'partner', 'store', 'self'] as const
export type Visibility = (typeof visibilities)[number]

export interface ActivityRow {
  id: string
  occurred_at: Date
  category: ActivityCategory
  action: string
  result: ActivityResult
  actor_kind: ActorKind
  actor_id: string | null
  actor_label: string | null
  on_behalf_of_kind: AgentKind | null
  on_behalf_of_id: string | null
  on_behalf_of_label: string | null
  access_kind: AccessKind | null
  access_ref: string | null
  partner_id: string | null
  store_id: string | null
  seller_id: string | null
  customer_id: string | null
  target_type: string | null
  target_id: string | null
  target_label: string | null
  changes: RecordedChange[]
  reason: string | null
  api: ActivityApi | null
  host: string | null
  request_id: string | null
  ip: string | null
  user_agent: string | null
  visibility: Visibility
}

export type NewActivityRow = Omit<ActivityRow, 'id' | 'occurred_at'> & { occurred_at: Date | null }
