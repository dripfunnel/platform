import type { PageWindow } from '#core/paging'
import { deliveryColumns, type DeliveryRow } from './dispatch'
import { pgArray, type ScopedSql } from './index'

type Ref = Pick<DeliveryRow, 'id' | 'store_id'>

// The handover code and its attempts are the engine's, in system scope: no request role reads or writes them (migration 0364).
export const setHandoverCode = (tx: ScopedSql, d: Ref, sealed: string | null) =>
  tx`update delivery set handover_code_enc = ${sealed}, code_attempts = 0 where id = ${d.id} and store_id = ${d.store_id}`.then(() => undefined)

export const selectHandoverCode = async (tx: ScopedSql, d: Ref) =>
  (await tx<{ handover_code_enc: string | null; code_attempts: number }[]>`select handover_code_enc, code_attempts from delivery where id = ${d.id} and store_id = ${d.store_id}`)[0] ?? null

export const countWrongCode = async (tx: ScopedSql, d: Ref): Promise<number> =>
  (await tx<{ code_attempts: number }[]>`update delivery set code_attempts = code_attempts + 1, revision = revision + 1 where id = ${d.id} and store_id = ${d.store_id} returning code_attempts`)[0]?.code_attempts ?? 0

/** The order's earlier `local` shipments: a retry after `failed` carries the parcel they already took out (DELIVERY §3). */
export const localFulfilments = async (tx: ScopedSql, storeId: string, orderId: string): Promise<string[]> =>
  (await tx<{ id: string }[]>`select id from fulfilment where store_id = ${storeId} and order_id = ${orderId} and kind = 'local' order by shipped_at, id`).map((r) => r.id)

export const setPickedUp = (tx: ScopedSql, d: Ref, fulfilmentId: string | null, now: Date) =>
  tx`update delivery set state = 'picked_up', picked_up_at = ${now}, fulfilment_id = ${fulfilmentId}, revision = revision + 1 where id = ${d.id} and store_id = ${d.store_id}`.then(() => undefined)

export const setDelivered = (tx: ScopedSql, d: Ref, s: { at: Date; cashAt: Date | null; key: string | null }) =>
  tx`update delivery set state = 'delivered', delivered_at = ${s.at}, cash_collected_at = coalesce(${s.cashAt}, cash_collected_at), handover_code_enc = null,
    step_key = coalesce(${s.key}, step_key), step_result = 'delivered', revision = revision + 1 where id = ${d.id} and store_id = ${d.store_id}`.then(() => undefined)

export const setFailed = (tx: ScopedSql, d: Ref, s: { at: Date; reason: string; note: string | null; key: string | null }) =>
  tx`update delivery set state = 'failed', failed_at = ${s.at}, failed_reason = ${s.reason}, failed_note = ${s.note}, handover_code_enc = null,
    step_key = coalesce(${s.key}, step_key), step_result = 'failed', revision = revision + 1 where id = ${d.id} and store_id = ${d.store_id}`.then(() => undefined)

export const setUnconfirmed = (tx: ScopedSql, d: Ref, s: { now: Date; cashAt: Date | null; key: string }) =>
  tx`update delivery set code_unconfirmed_at = ${s.now}, cash_collected_at = ${s.cashAt}, step_key = ${s.key}, step_result = 'CODE_UNCONFIRMED', revision = revision + 1
    where id = ${d.id} and store_id = ${d.store_id}`.then(() => undefined)

/** Every `local` shipment of the order reached the customer, at the rider's time; a courier's delivered time is never replaced. */
export const setShipmentsDelivered = (tx: ScopedSql, storeId: string, orderId: string, at: Date): Promise<string[]> =>
  tx<{ id: string }[]>`update fulfilment set delivered_at = coalesce(delivered_at, ${at}) where store_id = ${storeId} and order_id = ${orderId} and kind = 'local' returning id`.then((rows) => rows.map((r) => r.id))

export const carryNotice = async (tx: ScopedSql, d: Ref) =>
  (await tx<{ order_id: string; number: string; customer_id: string | null; partner_id: string; payment_method: string | null; payment_state: string; test: boolean }[]>`
    select o.id as order_id, o.number, o.customer_id, s.partner_id, o.payment_method, o.payment_state,
      exists (select 1 from payment m where m.order_id = o.id and m.mode = 'test') as test
    from delivery d join "order" o on o.id = d.order_id join store s on s.id = d.store_id where d.id = ${d.id} and d.store_id = ${d.store_id}`)[0] ?? null

// The rider's own reads, as app_rider: the policies of migration 0365 hold the lines and the customer to the parcel's job.
export interface RiderDeliveryRow extends DeliveryRow { warehouse_name: string; warehouse_address: Record<string, unknown>; warehouse_latitude: number | null; warehouse_longitude: number | null }

const riderDeliveryColumns = `${deliveryColumns.split(',').map((c) => `d.${c.trim()}`).join(', ')}, w.name as warehouse_name, w.address as warehouse_address, w.latitude as warehouse_latitude, w.longitude as warehouse_longitude`

export const selectRiderDelivery = async (tx: ScopedSql, storeId: string, riderId: string, id: string): Promise<RiderDeliveryRow | null> =>
  (await tx<RiderDeliveryRow[]>`select ${tx.unsafe(riderDeliveryColumns)} from delivery d join warehouse w on w.id = d.warehouse_id and w.store_id = d.store_id
    where d.id = ${id} and d.store_id = ${storeId} and d.rider_id = ${riderId}`)[0] ?? null

export const selectRiderDeliveries = (tx: ScopedSql, storeId: string, riderId: string, states: readonly string[] | null, w: PageWindow): Promise<RiderDeliveryRow[]> =>
  tx<RiderDeliveryRow[]>`select ${tx.unsafe(riderDeliveryColumns)} from delivery d join warehouse w on w.id = d.warehouse_id and w.store_id = d.store_id
    where d.store_id = ${storeId} and d.rider_id = ${riderId} and (${states === null} or d.state = any(${pgArray(states ?? [])}::text[]))
      and ${w.after ? tx`(d.created_at, d.id) < (${w.after.occurredAt}, ${w.after.id})` : tx`true`}
    order by d.created_at desc, d.id desc limit ${w.limit + 1}`

export const selectCarriedLines = (tx: ScopedSql, storeId: string, orderId: string) =>
  tx<{ name: string; version_name: string | null; quantity: number }[]>`select name, version_name, quantity from order_line where store_id = ${storeId} and order_id = ${orderId} order by position limit 100`

export const selectCarriedCustomer = async (tx: ScopedSql, storeId: string, orderId: string) =>
  (await tx<{ phone: string | null; shipping_address: Record<string, unknown> | null; shopper_note: string | null }[]>`
    select phone, shipping_address, shopper_note from "order" where store_id = ${storeId} and id = ${orderId}`)[0] ?? null

/** The rider's delivered counts since the start of the store's day and week, in its time zone (`firstDay` 1 Monday … 7 Sunday). */
export const selectDeliveredCounts = async (tx: ScopedSql, storeId: string, riderId: string, s: { now: Date; timeZone: string; firstDay: number }) =>
  (await tx<{ today: number; week: number }[]>`
    with b as (select date_trunc('day', ${s.now}::timestamptz at time zone ${s.timeZone}) as day)
    select count(d.id) filter (where d.delivered_at >= (b.day at time zone ${s.timeZone}))::int as today,
      count(d.id)::int as week
    from b left join delivery d on d.store_id = ${storeId} and d.rider_id = ${riderId} and d.state = 'delivered'
      and d.delivered_at >= ((b.day - ((extract(isodow from b.day)::int - ${s.firstDay} + 7) % 7) * interval '1 day') at time zone ${s.timeZone})
    group by b.day`)[0] ?? { today: 0, week: 0 }

export const selectStoreClock = async (tx: ScopedSql, storeId: string) =>
  (await tx<{ time_zone: string; main_language: string }[]>`select time_zone, main_language from store where id = ${storeId}`)[0] ?? null
