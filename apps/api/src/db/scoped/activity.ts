import type { Keyset } from '#core/cursor'
import type { ActivityResult, ActivityRow, ActorKind, NewActivityRow } from '../schema/activity'
import { pageLimit, type ScopedSql } from './index'

export const insertActivity = async (tx: ScopedSql, row: NewActivityRow): Promise<string> => {
  const rows = await tx<{ id: string }[]>`
    insert into activity_log (
      occurred_at, category, action, result, actor_kind, actor_id, actor_label,
      on_behalf_of_kind, on_behalf_of_id, on_behalf_of_label, access_kind, access_ref,
      partner_id, store_id, seller_id, customer_id, target_type, target_id, target_label,
      changes, reason, api, host, request_id, ip, user_agent, visibility
    ) values (
      coalesce(${row.occurred_at}, now()), ${row.category}, ${row.action}, ${row.result}, ${row.actor_kind},
      ${row.actor_id}, ${row.actor_label},
      ${row.on_behalf_of_kind}, ${row.on_behalf_of_id}, ${row.on_behalf_of_label}, ${row.access_kind}, ${row.access_ref},
      ${row.partner_id}, ${row.store_id}, ${row.seller_id}, ${row.customer_id},
      ${row.target_type}, ${row.target_id}, ${row.target_label},
      ${JSON.stringify(row.changes)}::text::jsonb, ${row.reason}, ${row.api}, ${row.host}, ${row.request_id},
      ${row.ip}, ${row.user_agent}, ${row.visibility}
    ) returning id
  `
  const inserted = rows[0]
  if (!inserted) throw new Error('activity_log insert returned no row')
  return inserted.id
}

/** Many rows in one statement, as `insertActivity` writes one. */
export const insertActivities = async (tx: ScopedSql, rows: readonly NewActivityRow[]): Promise<void> => {
  if (rows.length === 0) return
  await tx`
    insert into activity_log (
      occurred_at, category, action, result, actor_kind, actor_id, actor_label,
      on_behalf_of_kind, on_behalf_of_id, on_behalf_of_label, access_kind, access_ref,
      partner_id, store_id, seller_id, customer_id, target_type, target_id, target_label,
      changes, reason, api, host, request_id, ip, user_agent, visibility
    )
    select coalesce(x.occurred_at, now()), x.category, x.action, x.result, x.actor_kind, x.actor_id, x.actor_label,
      x.on_behalf_of_kind, x.on_behalf_of_id, x.on_behalf_of_label, x.access_kind, x.access_ref,
      x.partner_id, x.store_id, x.seller_id, x.customer_id, x.target_type, x.target_id, x.target_label,
      x.changes, x.reason, x.api, x.host, x.request_id, x.ip, x.user_agent, x.visibility
    from jsonb_to_recordset(${tx.json(rows as unknown as Parameters<typeof tx.json>[0])}) as x(
      occurred_at timestamptz, category text, action text, result text, actor_kind text, actor_id text, actor_label text,
      on_behalf_of_kind text, on_behalf_of_id text, on_behalf_of_label text, access_kind text, access_ref text,
      partner_id uuid, store_id uuid, seller_id uuid, customer_id uuid, target_type text, target_id text, target_label text,
      changes jsonb, reason text, api text, host text, request_id text, ip text, user_agent text, visibility text
    )
  `
}

export interface ActivityQuery {
  actorKind?: ActorKind | undefined
  actorId?: string | undefined
  targetType?: string | undefined
  targetId?: string | undefined
  partnerId?: string | undefined
  storeId?: string | undefined
  customerId?: string | undefined
  action?: string | undefined
  from?: Date | undefined
  to?: Date | undefined
  /** A Partner manager reads entries of their assigned partners only (ACCESS.md §5.4). */
  assignedTo?: string | undefined
  /** The partner console's "Who" chip (ui/platform/FIRST-RELEASE.md §13). */
  who?: ActivityWho | undefined
  result?: ActivityResult | undefined
  /** The admin console's level (FIRST-RELEASE §9): every security or system entry, or an API's other ones, as each entry is labelled. */
  level?: ActivityLevel | undefined
  ip?: string | undefined
  /** An impersonation, setup session or support session: everything done under it. */
  accessRef?: string | undefined
  /** One person's timeline: what they did, and what was done in their name (LOGGING §6). */
  person?: { kind: ActorKind; id: string } | undefined
}

export const activityLevels = ['admin', 'partner', 'store', 'storefront', 'system', 'security'] as const
export type ActivityLevel = (typeof activityLevels)[number]
const apiOfLevel = { admin: 'admin', partner: 'platform', store: 'store', storefront: 'shop' } as const

export const activityWhos = ['team', 'staff', 'setup', 'support', 'events'] as const
export type ActivityWho = (typeof activityWhos)[number]

export interface KeysetPage {
  after?: Keyset | undefined
  before?: Keyset | undefined
}

/**
 * Newest first by (occurred_at, id), one more row than asked so the caller knows whether
 * there is another page. `before` reads the page the other way round and the caller flips it.
 * The plain bound beside each row comparison is what lets Postgres prune partitions.
 */
export const selectActivity = async (tx: ScopedSql, query: ActivityQuery, page: KeysetPage, limit: number): Promise<ActivityRow[]> => {
  const backwards = page.before !== undefined
  const rows = await tx<ActivityRow[]>`
    select * from activity_log
    where true
      ${query.actorKind !== undefined ? tx`and actor_kind = ${query.actorKind}` : tx``}
      ${query.actorId !== undefined ? tx`and actor_id = ${query.actorId}` : tx``}
      ${query.targetType !== undefined ? tx`and target_type = ${query.targetType}` : tx``}
      ${query.targetId !== undefined ? tx`and target_id = ${query.targetId}` : tx``}
      ${query.partnerId !== undefined ? tx`and partner_id = ${query.partnerId}` : tx``}
      ${query.storeId !== undefined ? tx`and store_id = ${query.storeId}` : tx``}
      ${query.customerId !== undefined ? tx`and customer_id = ${query.customerId}` : tx``}
      ${query.action !== undefined ? tx`and action = ${query.action}` : tx``}
      ${query.from !== undefined ? tx`and occurred_at >= ${query.from}` : tx``}
      ${query.to !== undefined ? tx`and occurred_at < ${query.to}` : tx``}
      ${query.result !== undefined ? tx`and result = ${query.result}` : tx``}
      ${query.level === 'security' ? tx`and category = 'security'` : tx``}
      ${query.level === 'system' ? tx`and category = 'system'` : tx``}
      ${query.level !== undefined && query.level !== 'security' && query.level !== 'system' ? tx`and api = ${apiOfLevel[query.level]} and category not in ('security', 'system')` : tx``}
      ${query.ip !== undefined ? tx`and ip = ${query.ip}` : tx``}
      ${query.accessRef !== undefined ? tx`and access_ref = ${query.accessRef}` : tx``}
      ${
        query.person !== undefined
          ? tx`and ((actor_kind = ${query.person.kind} and actor_id = ${query.person.id}) or (on_behalf_of_kind = ${query.person.kind} and on_behalf_of_id = ${query.person.id}))`
          : tx``
      }
      ${query.who === 'team' ? tx`and actor_kind = 'partner_user' and access_kind is null` : tx``}
      ${query.who === 'staff' ? tx`and actor_kind = 'staff' and access_kind is null` : tx``}
      ${query.who === 'setup' ? tx`and access_kind = 'setup_session'` : tx``}
      ${query.who === 'support' ? tx`and access_kind = 'support_session'` : tx``}
      ${query.who === 'events' ? tx`and actor_kind in ('job', 'provider', 'person')` : tx``}
      ${query.assignedTo !== undefined ? tx`and partner_id in (select partner_id from staff_partner_assignment a where a.staff_user_id = ${query.assignedTo} and a.removed_at is null)` : tx``}
      ${page.after !== undefined ? tx`and occurred_at <= ${page.after.occurredAt} and (occurred_at, id) < (${page.after.occurredAt}, ${page.after.id}::uuid)` : tx``}
      ${page.before !== undefined ? tx`and occurred_at >= ${page.before.occurredAt} and (occurred_at, id) > (${page.before.occurredAt}, ${page.before.id}::uuid)` : tx``}
    ${backwards ? tx`order by occurred_at asc, id asc` : tx`order by occurred_at desc, id desc`}
    limit ${pageLimit(limit) + 1}
  `
  return backwards ? rows.reverse() : rows
}
