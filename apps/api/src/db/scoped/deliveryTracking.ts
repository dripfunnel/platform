import type { ScopedSql } from './index'

// What a customer follows of an own delivery (DELIVERY §7). The reads run as `app_shop`, whose policies show a delivery only
// through an order the reader owns, a rider only while the delivery is assigned or picked up, and a position only while it is
// picked up (migration 0367), so these queries add no check of their own beyond the store.

export interface TrackedDelivery {
  id: string
  state: string
  rider_id: string | null
  created_at: Date
  ready_at: Date | null
  searching_at: Date | null
  unassigned_at: Date | null
  assigned_at: Date | null
  picked_up_at: Date | null
  delivered_at: Date | null
  failed_at: Date | null
  cancelled_at: Date | null
  eta_at: Date | null
  eta_computed_at: Date | null
}

export const selectTrackedDeliveries = (tx: ScopedSql, storeId: string, orderId: string): Promise<TrackedDelivery[]> =>
  tx<TrackedDelivery[]>`select id, state, rider_id, created_at, ready_at, searching_at, unassigned_at, assigned_at, picked_up_at, delivered_at, failed_at, cancelled_at, eta_at, eta_computed_at
    from delivery where store_id = ${storeId} and order_id = ${orderId} order by created_at desc, id desc`

export interface TrackedRider {
  name: string
  phone: string | null
  photo_asset_id: string | null
  vehicle_type: string | null
  vehicle_number: string | null
}

export const selectTrackedRider = async (tx: ScopedSql, storeId: string, riderId: string): Promise<TrackedRider | null> =>
  (await tx<TrackedRider[]>`select name, phone, photo_asset_id, vehicle_type, vehicle_number from rider where store_id = ${storeId} and id = ${riderId}`)[0] ?? null

export interface TrackedPosition {
  latitude: number
  longitude: number
  reported_at: Date
}

export const selectTrackedPosition = async (tx: ScopedSql, storeId: string, riderId: string): Promise<TrackedPosition | null> =>
  (await tx<TrackedPosition[]>`select latitude, longitude, reported_at from rider_position where store_id = ${storeId} and rider_id = ${riderId}`)[0] ?? null

/**
 * Takes the right to ask Google for this delivery's estimate: the delivery's estimate is older than `everyMs` (or never made),
 * and one caller's update wins, so two readers never both ask (DELIVERY §7). System scope.
 */
export const claimEtaRefresh = async (tx: ScopedSql, storeId: string, deliveryId: string, now: Date, everyMs: number): Promise<boolean> =>
  (
    await tx`update delivery set eta_computed_at = ${now}
      where store_id = ${storeId} and id = ${deliveryId} and state = 'picked_up'
        and (eta_computed_at is null or eta_computed_at <= ${new Date(now.getTime() - everyMs)}) returning id`
  ).length > 0

export interface EtaInputs {
  rider_latitude: number
  rider_longitude: number
  to_latitude: number
  to_longitude: number
}

/** The rider's latest point and the order's pin, while the delivery is picked up; null when either is missing. System scope. */
export const selectEtaInputs = async (tx: ScopedSql, storeId: string, deliveryId: string): Promise<EtaInputs | null> =>
  (
    await tx<EtaInputs[]>`select p.latitude as rider_latitude, p.longitude as rider_longitude,
        (o.shipping_address->>'latitude')::float8 as to_latitude, (o.shipping_address->>'longitude')::float8 as to_longitude
      from delivery d join "order" o on o.id = d.order_id and o.store_id = d.store_id join rider_position p on p.rider_id = d.rider_id and p.store_id = d.store_id
      where d.store_id = ${storeId} and d.id = ${deliveryId} and d.state = 'picked_up'
        and o.shipping_address->>'latitude' is not null and o.shipping_address->>'longitude' is not null`
  )[0] ?? null

export const setEta = (tx: ScopedSql, storeId: string, deliveryId: string, etaAt: Date, now: Date) =>
  tx`update delivery set eta_at = ${etaAt}, eta_computed_at = ${now} where store_id = ${storeId} and id = ${deliveryId} and state = 'picked_up'`.then(() => undefined)

/** An order of this store that is placed, as the shopper's own policy shows it (the account's, or a guest's by its token). */
export const selectOwnPlacedOrder = async (tx: ScopedSql, storeId: string, orderId: string): Promise<boolean> =>
  (await tx`select 1 from "order" where store_id = ${storeId} and id = ${orderId} and state <> 'cart'`).length > 0
