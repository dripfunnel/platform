import type { CourierProvider, TrackingStatus } from '#core/couriers'
import { pgArray, type ScopedSql } from './index'

// A booked parcel's tracking (migration 0131), in system scope: a courier's hook arrives for the store whose login it
// names (#1489), so every lookup is held to that store.

export interface TrackedShipmentRow {
  id: string
  order_id: string
  store_id: string
  number: string
  seller_id: string | null
  tracking_status_at: Date | null
  delivered_at: Date | null
  /** The store's "Tracking emails" switch for this courier (SetOps Manage). */
  tracking_emails: boolean
  quiet: boolean
}

/** The store's booked parcel a hook names, by the courier's id or its tracking number, locked. */
export const lockTrackedShipment = async (
  tx: ScopedSql,
  scope: { partnerId: string; storeId: string },
  providers: readonly CourierProvider[],
  ref: { providerRef: string | null; trackingNumber: string | null },
): Promise<TrackedShipmentRow | null> =>
  (
    await tx<TrackedShipmentRow[]>`
      select f.id, f.order_id, f.store_id, o.number, f.seller_id, f.tracking_status_at, f.delivered_at,
        coalesce((select c.tracking_emails from store_courier c where c.store_id = f.store_id and c.provider = f.courier_provider), true) as tracking_emails,
        (o.state = 'cancelled' or exists (select 1 from payment m where m.order_id = o.id and m.mode = 'test')) as quiet
      from fulfilment f join "order" o on o.id = f.order_id join store s on s.id = f.store_id
      where s.partner_id = ${scope.partnerId} and f.store_id = ${scope.storeId} and f.kind = 'booked' and f.courier_provider = any(${pgArray(providers)}::text[])
        and (f.provider_ref = ${ref.providerRef ?? ''} or (${ref.trackingNumber ?? ''} <> '' and f.tracking_number = ${ref.trackingNumber ?? ''}))
      order by f.booked_at desc
      limit 1
      for update of f
    `
  )[0] ?? null

export const setTrackingStatus = async (tx: ScopedSql, fulfilmentId: string, status: TrackingStatus, at: Date): Promise<void> => {
  await tx`
    update fulfilment set tracking_status = ${status}, tracking_status_at = ${at},
      delivered_at = case when ${status} = 'delivered' then coalesce(delivered_at, ${at}) else delivered_at end
    where id = ${fulfilmentId}
  `
}

// A Shiprocket parcel still on its way (migration 0414): booked in the last 60 days, never delivered, returned or cancelled.
const onItsWay = (tx: ScopedSql, since: Date, askedBefore: Date) => tx`
  f.kind = 'booked' and f.courier_provider = 'shiprocket' and f.delivered_at is null and f.booked_at > ${since}
  and (f.tracking_status is null or f.tracking_status not in ('delivered', 'returned', 'cancelled'))
  and (f.tracking_polled_at is null or f.tracking_polled_at < ${askedBefore})
`

// A delivered Shiprocket parcel whose order's cash on delivery is still owed, delivered in the last 60 days: asked about its
// remittance (THIRD-PARTY-ACCESS §3.2); a returned one is never delivered, so never asked.
const awaitingCash = (tx: ScopedSql, since: Date, askedBefore: Date) => tx`
  f.kind = 'booked' and f.courier_provider = 'shiprocket' and f.tracking_status = 'delivered' and f.delivered_at > ${since}
  and (f.tracking_polled_at is null or f.tracking_polled_at < ${askedBefore})
  and exists (select 1 from "order" o where o.id = f.order_id and o.state = 'placed' and o.payment_method = 'cod' and o.payment_state = 'pending')
`

/** The stores with a Shiprocket login and a parcel on its way, or delivered awaiting its cash, not asked about lately. */
export const selectStoresToTrack = (tx: ScopedSql, since: Date, askedBefore: Date, cashAskedBefore: Date, limit: number): Promise<{ store_id: string; partner_id: string }[]> =>
  tx<{ store_id: string; partner_id: string }[]>`
    select distinct f.store_id, s.partner_id from fulfilment f join store s on s.id = f.store_id
    where (${onItsWay(tx, since, askedBefore)} or ${awaitingCash(tx, since, cashAskedBefore)})
      and exists (select 1 from courier_account a where a.store_id = f.store_id and a.provider = 'shiprocket')
    limit ${limit}
  `

/** One store's delivered COD parcels to ask about their remittance, the longest unasked first. */
export const selectCashToSettle = (tx: ScopedSql, storeId: string, since: Date, askedBefore: Date, limit: number): Promise<{ id: string; order_id: string; provider_ref: string }[]> =>
  tx<{ id: string; order_id: string; provider_ref: string }[]>`
    select f.id, f.order_id, f.provider_ref from fulfilment f
    where f.store_id = ${storeId} and ${awaitingCash(tx, since, askedBefore)}
    order by f.tracking_polled_at nulls first limit ${limit}
  `

/** One store's parcels to ask about, the longest unasked first. */
export const selectShipmentsToTrack = (tx: ScopedSql, storeId: string, since: Date, askedBefore: Date, limit: number): Promise<{ id: string; provider_ref: string }[]> =>
  tx<{ id: string; provider_ref: string }[]>`
    select f.id, f.provider_ref from fulfilment f
    where f.store_id = ${storeId} and ${onItsWay(tx, since, askedBefore)}
    order by f.tracking_polled_at nulls first limit ${limit}
  `

export const setTrackingPolled = async (tx: ScopedSql, ids: readonly string[], at: Date): Promise<void> => {
  await tx`update fulfilment set tracking_polled_at = ${at} where id = any(${pgArray(ids)}::uuid[])`
}
