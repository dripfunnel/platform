import type { PageWindow } from '#core/paging'
import { pgArray, type ScopedSql } from './index'

export interface DeliveryRow {
  id: string
  store_id: string
  order_id: string
  warehouse_id: string
  state: string
  rider_id: string | null
  offer_round: number
  excluded_rider_id: string | null
  currency: string
  cash_due_amount: string | null
  created_at: Date
  ready_at: Date | null
  unassigned_at: Date | null
  searching_at: Date | null
  assigned_at: Date | null
  picked_up_at: Date | null
  delivered_at: Date | null
  failed_at: Date | null
  cancelled_at: Date | null
}

/** Every column but the handover code and its attempts, which no request role can read (migration 0364). */
const deliveryColumns = `id, store_id, order_id, warehouse_id, state, rider_id, offer_round, excluded_rider_id, currency, cash_due_amount::text as cash_due_amount, created_at, ready_at, unassigned_at, searching_at, assigned_at, picked_up_at, delivered_at, failed_at, cancelled_at`

export const lockDelivery = async (tx: ScopedSql, storeId: string, id: string): Promise<DeliveryRow | null> =>
  (await tx<DeliveryRow[]>`select ${tx.unsafe(deliveryColumns)} from delivery where store_id = ${storeId} and id = ${id} for update`)[0] ?? null

export const deliveryOrder = async (tx: ScopedSql, storeId: string, orderId: string, lock = true) =>
  (await tx<{ id: string; partner_id: string; number: string; currency: string; payment_method: string; payment_state: string; delivery_warehouse_id: string; dispatch_when: string; cash: string | null }[]>`
    select o.id, s.partner_id, o.number, o.currency, o.payment_method, o.payment_state, o.delivery_warehouse_id, sh.dispatch_when,
      (select p.amount::text from payment p where p.order_id = o.id and p.provider = 'cod' order by p.created_at desc limit 1) as cash
    from "order" o join store s on s.id = o.store_id join store_shipping sh on sh.store_id = s.id
    where o.id = ${orderId} and o.store_id = ${storeId} and o.state = 'placed' and o.shipping_option = 'own_delivery'
      and not exists(select 1 from payment p where p.order_id = o.id and p.mode = 'test')
    ${lock ? tx`for update of o` : tx``}
  `)[0] ?? null

export const insertDelivery = async (tx: ScopedSql, o: { storeId: string; orderId: string; warehouseId: string; currency: string; cash: string | null; searching: boolean; now: Date }): Promise<DeliveryRow | null> =>
  (await tx<DeliveryRow[]>`insert into delivery(store_id, order_id, warehouse_id, currency, cash_due_amount, state, offer_round, searching_at, created_at)
    values(${o.storeId}, ${o.orderId}, ${o.warehouseId}, ${o.currency}, ${o.cash}, ${o.searching ? 'searching' : 'packing'}, ${o.searching ? 1 : 0}, ${o.searching ? o.now : null}, ${o.now})
    on conflict (order_id) where state not in ('failed','cancelled') do nothing returning ${tx.unsafe(deliveryColumns)}`)[0] ?? null

export const startRound = async (tx: ScopedSql, d: DeliveryRow, now: Date, excluded: string | null = null): Promise<DeliveryRow> => {
  const [row] = await tx<DeliveryRow[]>`update delivery set state = 'searching', rider_id = null, excluded_rider_id = ${excluded}, offer_round = offer_round + 1,
    searching_at = ${now}, assigned_at = null, ready_at = case when state = 'packing' then ${now} else ready_at end, unassigned_at = null, revision = revision + 1
    where id = ${d.id} and store_id = ${d.store_id} returning ${tx.unsafe(deliveryColumns)}`
  if (!row) throw new Error('delivery: round returned no row')
  return row
}

export interface OfferRow { id: string; delivery_id: string; store_id: string; rider_id: string; offer_round: number; answer: string | null; distance_m: number; sent_at: Date }

export const closeOffers = (tx: ScopedSql, d: DeliveryRow, answer: 'taken' | 'expired', now: Date): Promise<OfferRow[]> =>
  tx<OfferRow[]>`update delivery_offer set answer = ${answer}, answered_at = ${now} where delivery_id = ${d.id} and answer is null returning *`

export const selectOffer = async (tx: ScopedSql, storeId: string, riderId: string, id: string): Promise<OfferRow | null> =>
  (await tx<OfferRow[]>`select * from delivery_offer where id = ${id} and store_id = ${storeId} and rider_id = ${riderId}`)[0] ?? null

export const answerOffer = (tx: ScopedSql, id: string, answer: 'accepted' | 'declined', now: Date) =>
  tx`update delivery_offer set answer = ${answer}, answered_at = ${now} where id = ${id} and answer is null`

export const assignRider = async (tx: ScopedSql, d: DeliveryRow, riderId: string, now: Date, manual: boolean): Promise<boolean> =>
  (await tx`update delivery set state = 'assigned', rider_id = ${riderId}, assigned_at = ${now}, revision = revision + 1
    where id = ${d.id} and store_id = ${d.store_id} and state = ${manual ? 'unassigned' : 'searching'} returning id`).length === 1

export const activeRider = async (tx: ScopedSql, storeId: string, riderId: string) =>
  (await tx<{ id: string; online_at: Date | null }[]>`select id, online_at from rider where store_id = ${storeId} and id = ${riderId} and status = 'active' for update`)[0] ?? null

export const freshPosition = async (tx: ScopedSql, storeId: string, riderId: string, now: Date): Promise<boolean> =>
  (await tx`select 1 from rider_position where store_id = ${storeId} and rider_id = ${riderId}
    and received_at > ${new Date(now.getTime() - 600_000)} and reported_at > ${new Date(now.getTime() - 600_000)}`).length > 0

export const riderDeliveries = (tx: ScopedSql, storeId: string, riderId: string): Promise<DeliveryRow[]> =>
  tx<DeliveryRow[]>`select ${tx.unsafe(deliveryColumns)} from delivery where store_id = ${storeId} and rider_id = ${riderId} and state in ('assigned','picked_up') order by id for update`

export const setDeliveryState = (tx: ScopedSql, d: DeliveryRow, state: 'unassigned' | 'cancelled', now: Date) =>
  tx`update delivery set state = ${state}, cancelled_at = ${state === 'cancelled' ? now : null}, unassigned_at = ${state === 'unassigned' ? now : tx`unassigned_at`}, revision = revision + 1 where id = ${d.id} and store_id = ${d.store_id}`

export const setOnline = async (tx: ScopedSql, storeId: string, riderId: string, online: boolean, now: Date) => {
  await tx`update rider set online_at = ${online ? tx`coalesce(online_at, ${now})` : null}, updated_at = ${now} where id = ${riderId} and store_id = ${storeId}`
  if (!online) await tx`delete from rider_position where rider_id = ${riderId} and store_id = ${storeId}`
}

export const closeRiderOffers = (tx: ScopedSql, storeId: string, riderId: string, now: Date): Promise<OfferRow[]> =>
  tx<OfferRow[]>`update delivery_offer set answer = 'expired', answered_at = ${now} where store_id = ${storeId} and rider_id = ${riderId} and answer is null returning *`

export const writePosition = async (tx: ScopedSql, p: { storeId: string; riderId: string; lat: number; lng: number; accuracy: number; at: Date; now: Date }): Promise<'saved' | 'old' | 'limited'> => {
  const [before] = await tx<{ reported_at: Date | null; last_position_at: Date | null }[]>`select p.reported_at,r.last_position_at from rider r
    left join rider_position p on p.rider_id = r.id and p.store_id = r.store_id where r.id = ${p.riderId} and r.store_id = ${p.storeId}`
  if (before?.reported_at && before.reported_at >= p.at) return 'old'
  if (before?.last_position_at && p.now.getTime() - before.last_position_at.getTime() < 10_000) return 'limited'
  await tx`insert into rider_position(rider_id, store_id, latitude, longitude, accuracy_m, reported_at, received_at)
    values(${p.riderId}, ${p.storeId}, ${p.lat}, ${p.lng}, ${p.accuracy}, ${p.at}, ${p.now})
    on conflict(rider_id) do update set latitude = excluded.latitude, longitude = excluded.longitude, accuracy_m = excluded.accuracy_m, reported_at = excluded.reported_at, received_at = excluded.received_at`
  await tx`update rider set last_position_at = ${p.now} where id = ${p.riderId} and store_id = ${p.storeId}`
  return 'saved'
}

export const candidates = (tx: ScopedSql, d: DeliveryRow, now: Date): Promise<{ rider_id: string; distance_m: number }[]> =>
  tx<{ rider_id: string; distance_m: number }[]>`select r.id as rider_id, x.distance_m from rider r
    join rider_position p on p.rider_id = r.id and p.store_id = r.store_id
    join warehouse w on w.id = ${d.warehouse_id} and w.store_id = r.store_id
    cross join lateral (select 2 * 6371000 * asin(sqrt(least(1.0, power(sin(radians(w.latitude - p.latitude)/2),2)
      + cos(radians(p.latitude))*cos(radians(w.latitude))*power(sin(radians(w.longitude-p.longitude)/2),2)))) as distance_m) x
    where r.store_id = ${d.store_id} and r.status = 'active' and r.online_at is not null
      and p.received_at > ${new Date(now.getTime() - 600_000)} and p.reported_at > ${new Date(now.getTime() - 600_000)}
      and (${d.excluded_rider_id}::uuid is null or r.id <> ${d.excluded_rider_id}) and x.distance_m <= w.rider_radius_m
      and not exists(select 1 from delivery busy where busy.rider_id = r.id and busy.state in ('assigned','picked_up'))`

export const insertOffers = (tx: ScopedSql, d: DeliveryRow, riders: { rider_id: string; distance_m: number }[], now: Date) =>
  riders.length === 0 ? Promise.resolve() : tx`insert into delivery_offer(delivery_id, store_id, offer_round, rider_id, distance_m, sent_at)
    select ${d.id}, ${d.store_id}, ${d.offer_round}, x.rider, x.distance, ${now}
    from unnest(${pgArray(riders.map((r) => r.rider_id))}::uuid[], ${pgArray(riders.map((r) => String(r.distance_m)))}::float8[]) x(rider,distance)
    on conflict(delivery_id, offer_round, rider_id) do nothing`.then(() => undefined)

export interface OfferView extends OfferRow { warehouse_name: string; area: string; item_count: number; expires_at: Date }
export const listOffers = (tx: ScopedSql, storeId: string, riderId: string, w: PageWindow, now: Date): Promise<OfferView[]> =>
  tx<OfferView[]>`select f.*, d.searching_at + sh.offer_minutes * interval '1 minute' as expires_at, wh.name as warehouse_name, concat_ws(', ', nullif(o.shipping_address->>'postalCode',''), o.shipping_address->>'city') as area,
    (select coalesce(sum(l.quantity),0)::int from order_line l where l.order_id = o.id) as item_count
    from delivery_offer f join delivery d on d.id = f.delivery_id join "order" o on o.id = d.order_id
    join warehouse wh on wh.id = d.warehouse_id join store_shipping sh on sh.store_id = d.store_id
    where f.store_id = ${storeId} and f.rider_id = ${riderId} and f.answer is null and d.state = 'searching' and f.offer_round = d.offer_round
      and d.searching_at + sh.offer_minutes * interval '1 minute' > ${now}
      and ${w.after ? tx`(f.sent_at,f.id) < (${w.after.occurredAt},${w.after.id})` : tx`true`}
    order by f.sent_at desc, f.id desc limit ${w.limit + 1}`

export const dueDeliveries = (tx: ScopedSql, now: Date): Promise<{ id: string; store_id: string; partner_id: string }[]> =>
  tx<{ id: string; store_id: string; partner_id: string }[]>`select d.id,d.store_id,s.partner_id from delivery d join store s on s.id = d.store_id
    join store_shipping sh on sh.store_id = d.store_id where d.state = 'searching' and d.searching_at + sh.offer_minutes * interval '1 minute' <= ${now}
    order by d.searching_at,d.id limit 100 for update of d skip locked`

export const expirePositions = async (tx: ScopedSql, now: Date): Promise<{ id: string; store_id: string; partner_id: string }[]> => {
  const stale = new Date(now.getTime() - 600_000)
  const rows = await tx<{ id: string; store_id: string; partner_id: string }[]>`update rider r set online_at = null from store s
    where s.id = r.store_id and r.id in (select x.id from rider x where x.online_at is not null and x.online_at <= ${stale}
      and not exists(select 1 from rider_position p where p.rider_id = x.id and p.received_at > ${stale} and p.reported_at > ${stale})
      order by x.online_at,x.id limit 500 for update skip locked)
    returning r.id,r.store_id,s.partner_id`
  await tx`delete from rider_position where rider_id in (select rider_id from rider_position where received_at <= ${stale} or reported_at <= ${stale} order by received_at limit 500)`
  return rows
}

export const deliveryExpired = async (tx: ScopedSql, d: DeliveryRow, now: Date): Promise<boolean> =>
  (await tx`select 1 from store_shipping where store_id = ${d.store_id} and ${d.searching_at}::timestamptz + offer_minutes * interval '1 minute' <= ${now}`).length > 0

export const selectOrderDeliveries = (tx: ScopedSql, storeId: string, orderId: string): Promise<DeliveryRow[]> =>
  tx<DeliveryRow[]>`select ${tx.unsafe(deliveryColumns)} from delivery where store_id = ${storeId} and order_id = ${orderId} order by created_at desc,id desc`

export const riderSummary = async (tx: ScopedSql, storeId: string, riderId: string) =>
  (await tx<{ name: string; phone: string | null; photo_asset_id: string | null; vehicle_type: string | null; vehicle_number: string | null }[]>`
    select name,phone,photo_asset_id,vehicle_type,vehicle_number from rider where store_id = ${storeId} and id = ${riderId}`)[0] ?? null

export const ownDeliveryEnabled = async (tx: ScopedSql, storeId: string): Promise<boolean> =>
  (await tx`select 1 from store_shipping where store_id = ${storeId} and own_delivery_enabled`).length > 0

export const dispatchNotice = async (tx: ScopedSql, storeId: string, deliveryId: string) =>
  (await tx<{ number: string; order_id: string; partner_id: string }[]>`select o.number,o.id as order_id,s.partner_id from delivery d join "order" o on o.id = d.order_id
    join store s on s.id = d.store_id where d.store_id = ${storeId} and d.id = ${deliveryId}`)[0] ?? null

export const selectOfferDistance = async (tx: ScopedSql, storeId: string, deliveryId: string, riderId: string) =>
  (await tx<{ distance_m: number }[]>`select distance_m from delivery_offer where store_id = ${storeId} and delivery_id = ${deliveryId} and rider_id = ${riderId} order by offer_round desc limit 1`)[0]?.distance_m ?? null

export const roundHasOffers = async (tx: ScopedSql, d: DeliveryRow): Promise<boolean> => (await tx`select 1 from delivery_offer where delivery_id = ${d.id} and offer_round = ${d.offer_round} limit 1`).length > 0

export const dispatchRecipients = async (tx: ScopedSql, storeId: string, roles: readonly string[]): Promise<string[]> => (await tx<{ email: string }[]>`select distinct u.email from membership m join "user" u on u.id = m.user_id where m.store_id = ${storeId} and m.seller_id is null and m.status = 'active' and u.status = 'active' and m.role_key = any(${pgArray(roles)}::text[]) order by u.email limit 50`).map((r) => r.email)
