import type { PageWindow } from '#core/paging'
import { pgArray, type ScopedSql } from './index'

// Webhook endpoints and their deliveries (DATA-MODEL §7.10, migrations/0151). The merchant side's reads and writes run
// in its store's scope; the relay's in system scope.

export type EndpointStatus = 'active' | 'failing' | 'disabled'
export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'held'

export interface EndpointRow {
  id: string
  url: string
  events: string[]
  status: EndpointStatus
  failing_since: Date | null
  disabled_at: Date | null
  created_at: Date
}

const page = (tx: ScopedSql, window: PageWindow, alias: string) => tx`
  ${window.after ? tx`(${tx(alias)}.created_at, ${tx(alias)}.id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
  and ${window.before ? tx`(${tx(alias)}.created_at, ${tx(alias)}.id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}`
const order = (tx: ScopedSql, window: PageWindow, alias: string) => {
  const dir = window.before && !window.after ? tx`asc` : tx`desc`
  return tx`order by ${tx(alias)}.created_at ${dir}, ${tx(alias)}.id ${dir} limit ${window.limit + 1}`
}

export const selectEndpoints = (tx: ScopedSql, storeId: string, window: PageWindow): Promise<EndpointRow[]> =>
  tx<EndpointRow[]>`
    select e.id, e.url, to_jsonb(e.events) as events, e.status, e.failing_since, e.disabled_at, e.created_at from webhook_endpoint e
    where e.store_id = ${storeId} and e.deleted_at is null and ${page(tx, window, 'e')}
    ${order(tx, window, 'e')}
  `

export const countEndpoints = async (tx: ScopedSql, storeId: string): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from webhook_endpoint where store_id = ${storeId} and deleted_at is null`)[0]?.n ?? 0

/** A live endpoint of this store, locked, so saving, removing and turning it on take turns. */
export const lockEndpoint = async (tx: ScopedSql, storeId: string, id: string): Promise<EndpointRow | null> =>
  (
    await tx<EndpointRow[]>`
      select id, url, to_jsonb(events) as events, status, failing_since, disabled_at, created_at from webhook_endpoint
      where id = ${id} and store_id = ${storeId} and deleted_at is null for update
    `
  )[0] ?? null

export const insertEndpoint = async (tx: ScopedSql, e: { id: string; storeId: string; url: string; events: readonly string[]; secretSealed: string; by: string; now: Date }): Promise<void> => {
  await tx`
    insert into webhook_endpoint (id, store_id, url, events, secret_sealed, created_by_user_id, created_at, updated_at)
    values (${e.id}, ${e.storeId}, ${e.url}, ${pgArray(e.events)}::text[], ${e.secretSealed}, ${e.by}, ${e.now}, ${e.now})
  `
}

export const updateEndpoint = async (tx: ScopedSql, id: string, url: string, events: readonly string[], now: Date): Promise<void> => {
  await tx`update webhook_endpoint set url = ${url}, events = ${pgArray(events)}::text[], updated_at = ${now} where id = ${id}`
}

export const removeEndpoint = async (tx: ScopedSql, id: string, now: Date): Promise<void> => {
  await tx`update webhook_endpoint set deleted_at = ${now}, updated_at = ${now} where id = ${id}`
}

/** Working again: its failures forgotten, so the three days start afresh. */
export const markEndpointWorking = async (tx: ScopedSql, id: string, now: Date): Promise<void> => {
  await tx`update webhook_endpoint set status = 'active', failing_since = null, disabled_at = null, updated_at = ${now} where id = ${id} and status <> 'active'`
}

export interface DeliveryRow {
  id: string
  event: string
  event_id: string
  status: DeliveryStatus
  attempts: number
  response_code: number | null
  error: string | null
  duration_ms: number | null
  created_at: Date
  last_attempt_at: Date | null
  delivered_at: Date | null
  replay_of: string | null
}

export const selectDeliveries = (tx: ScopedSql, storeId: string, endpointId: string, window: PageWindow): Promise<DeliveryRow[]> =>
  tx<DeliveryRow[]>`
    select d.id, d.event, d.event_id, d.status, d.attempts, d.response_code, d.error, d.duration_ms, d.created_at, d.last_attempt_at, d.delivered_at, d.replay_of
    from webhook_delivery d
    where d.store_id = ${storeId} and d.endpoint_id = ${endpointId} and ${page(tx, window, 'd')}
    ${order(tx, window, 'd')}
  `

export interface StoredDelivery {
  id: string
  endpoint_id: string
  event: string
  event_id: string
  body: string
  created_at: Date
}

export const selectStoredDelivery = async (tx: ScopedSql, storeId: string, id: string): Promise<StoredDelivery | null> =>
  (await tx<StoredDelivery[]>`select id, endpoint_id, event, event_id, body, created_at from webhook_delivery where id = ${id} and store_id = ${storeId}`)[0] ?? null

export const insertDelivery = async (
  tx: ScopedSql,
  d: { id: string; endpointId: string; storeId: string; event: string; eventId: string; body: string; status: 'pending' | 'held'; replayOf: string | null; now: Date },
): Promise<boolean> =>
  (
    await tx`
      insert into webhook_delivery (id, endpoint_id, store_id, event, event_id, body, status, replay_of, created_at)
      values (${d.id}, ${d.endpointId}, ${d.storeId}, ${d.event}, ${d.eventId}, ${d.body}, ${d.status}, ${d.replayOf}, ${d.now})
      on conflict (endpoint_id, event_id) where replay_of is null do nothing
    `
  ).count > 0

/** The held deliveries still within the replay window, made pending again for an endpoint turned back on. */
export const releaseHeld = async (tx: ScopedSql, endpointId: string, since: Date): Promise<string[]> =>
  (await tx<{ id: string }[]>`update webhook_delivery set status = 'pending' where endpoint_id = ${endpointId} and status = 'held' and created_at >= ${since} returning id`).map((r) => r.id)

// The relay's reads and writes (system scope).

export interface EndpointsForEvent {
  id: string
  status: EndpointStatus
}

export const selectEndpointsFor = (tx: ScopedSql, storeId: string, event: string): Promise<EndpointsForEvent[]> =>
  tx<EndpointsForEvent[]>`select id, status from webhook_endpoint where store_id = ${storeId} and deleted_at is null and ${event} = any(events) order by id`

export interface DeliveryToSend {
  id: string
  store_id: string
  event: string
  body: string
  status: DeliveryStatus
  attempts: number
  endpoint_id: string
  url: string
  secret_sealed: string
  endpoint_status: EndpointStatus
  failing_since: Date | null
  endpoint_gone: boolean
}

export const selectDeliveryToSend = async (tx: ScopedSql, id: string): Promise<DeliveryToSend | null> =>
  (
    await tx<DeliveryToSend[]>`
      select d.id, d.store_id, d.event, d.body, d.status, d.attempts, e.id as endpoint_id, e.url, e.secret_sealed, e.status as endpoint_status, e.failing_since,
        e.deleted_at is not null as endpoint_gone
      from webhook_delivery d join webhook_endpoint e on e.id = d.endpoint_id
      where d.id = ${id} for update of d
    `
  )[0] ?? null

export const recordDeliveryAttempt = async (
  tx: ScopedSql,
  id: string,
  a: { status: DeliveryStatus; responseCode: number | null; error: string | null; durationMs: number | null; now: Date },
): Promise<void> => {
  await tx`
    update webhook_delivery set status = ${a.status}, attempts = attempts + 1, response_code = ${a.responseCode}, error = ${a.error}, duration_ms = ${a.durationMs},
      last_attempt_at = ${a.now}, delivered_at = ${a.status === 'delivered' ? a.now : null}
    where id = ${id}
  `
}

export const holdDelivery = async (tx: ScopedSql, id: string, error: string | null): Promise<void> => {
  await tx`update webhook_delivery set status = 'held', error = coalesce(${error}, error) where id = ${id}`
}

export const failDelivery = async (tx: ScopedSql, id: string, error: string): Promise<void> => {
  await tx`update webhook_delivery set status = 'failed', error = ${error} where id = ${id}`
}

/** The endpoint failed again; answers when its failures began. */
export const markEndpointFailing = async (tx: ScopedSql, id: string, now: Date): Promise<Date> =>
  (
    await tx<{ failing_since: Date }[]>`
      update webhook_endpoint set status = case when status = 'disabled' then status else 'failing' end, failing_since = coalesce(failing_since, ${now}), updated_at = ${now}
      where id = ${id} returning failing_since
    `
  )[0]?.failing_since ?? now

/** Turned off after its days of failures; true for the one call that did it, so the Owners are told once. */
export const disableEndpoint = async (tx: ScopedSql, id: string, now: Date): Promise<boolean> =>
  (await tx`update webhook_endpoint set status = 'disabled', disabled_at = ${now}, updated_at = ${now} where id = ${id} and status <> 'disabled'`).count > 0

export const deleteOldDeliveries = async (tx: ScopedSql, before: Date, limit: number): Promise<number> =>
  (await tx`delete from webhook_delivery where id in (select id from webhook_delivery where created_at < ${before} order by created_at limit ${limit})`).count
