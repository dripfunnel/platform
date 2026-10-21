import type { CourierProvider, TrackingStatus } from '#core/couriers'
import { pgArray, type ScopedSql } from './index'

// A booked parcel's tracking (migration 0131), in system scope: a courier's hook arrives for the partner whose account
// it names, so every lookup is held to that partner's stores.

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

/** The partner's booked parcel a hook names, by the courier's id or its tracking number, locked. */
export const lockTrackedShipment = async (
  tx: ScopedSql,
  partnerId: string,
  providers: readonly CourierProvider[],
  ref: { providerRef: string | null; trackingNumber: string | null },
): Promise<TrackedShipmentRow | null> =>
  (
    await tx<TrackedShipmentRow[]>`
      select f.id, f.order_id, f.store_id, o.number, f.seller_id, f.tracking_status_at, f.delivered_at,
        coalesce((select c.tracking_emails from store_courier c where c.store_id = f.store_id and c.provider = f.courier_provider), true) as tracking_emails,
        (o.state = 'cancelled' or exists (select 1 from payment m where m.order_id = o.id and m.mode = 'test')) as quiet
      from fulfilment f join "order" o on o.id = f.order_id join store s on s.id = f.store_id
      where s.partner_id = ${partnerId} and f.kind = 'booked' and f.courier_provider = any(${pgArray(providers)}::text[])
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
