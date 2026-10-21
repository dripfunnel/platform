import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog } from '#auth/activity'
import type { CourierAccountKind, CourierProvider, TrackingEvent } from '#core/couriers'
import { withSystemScope } from '#db/scoped/index'
import { queueOrderUpdate } from '#db/scoped/orderUpdates'
import { lockTrackedShipment, setTrackingStatus } from '#db/scoped/tracking'

// Tracking sync (SAPI 12; FIRST-RELEASE §19): a courier's verified hook moves its booked parcel on. Each event applies
// only after the one it holds, so a hook sent twice, or one arriving late, changes nothing (AGENTS.md Reliability).

export const trackingAudit = { delivered: 'order.delivered' } as const

const providersOf: Record<CourierAccountKind, readonly CourierProvider[]> = { shiprocket: ['shiprocket'], easypost: ['usps', 'ups', 'fedex'] }

export interface TrackingDeps {
  sql: postgres.Sql
  activity: ActivityLog
}

/** Applies a partner's courier events to its own stores' parcels; answers how many moved a parcel on. */
export const applyTracking = async ({ sql, activity }: TrackingDeps, partnerId: string, account: CourierAccountKind, events: readonly TrackingEvent[]): Promise<number> => {
  let applied = 0
  for (const event of events) {
    const moved = await withSystemScope(sql, async (tx) => {
      const shipment = await lockTrackedShipment(tx, partnerId, providersOf[account], event)
      if (!shipment || (shipment.tracking_status_at && event.at <= shipment.tracking_status_at)) return false
      await setTrackingStatus(tx, shipment.id, event.status, event.at)
      if (event.status !== 'delivered' || shipment.delivered_at) return true
      const entry: ActivityEntry = {
        category: 'system',
        action: trackingAudit.delivered,
        result: 'success',
        actorKind: 'job',
        actorId: null,
        actorLabel: 'Courier tracking',
        partnerId,
        storeId: shipment.store_id,
        target: { type: 'order', id: shipment.order_id, label: shipment.number },
        reason: null,
        api: null,
        visibility: 'store',
        requestId: null,
        ip: null,
        userAgent: null,
      }
      // The store's entry, and on a supplier's parcel its own thin one too (LOGGING §3).
      await activity.recordAll(tx, shipment.seller_id ? [entry, { ...entry, sellerId: shipment.seller_id }] : [entry])
      // The shopper hears once, unless the store switched this courier's tracking emails off (SetOps Manage).
      if (shipment.tracking_emails && !shipment.quiet) await queueOrderUpdate(tx, shipment.store_id, { event: 'delivered', orderId: shipment.order_id, fulfilmentId: shipment.id }, `delivered:${shipment.id}`)
      return true
    })
    if (moved) applied += 1
  }
  return applied
}
