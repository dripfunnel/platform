import type postgres from 'postgres'
import type { SecretBox } from '#auth/secretBox'
import type { TenantContext } from '#core/tenancy'
import { selectHandoverCode } from '#db/scoped/carry'
import { withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import { insertOutbox } from '#db/scoped/outbox'
import { claimEtaRefresh, selectTrackedDeliveries, selectTrackedPosition, selectTrackedRider, type TrackedDelivery } from '#db/scoped/deliveryTracking'
import { openHandoverCode } from './handoverCode'

// What the order's customer reads of an own delivery (DELIVERY §7), as the Shop API answers it. The reads run under the shopper's
// own role, so another customer, a supplier, or a guest without the order's token finds nothing (migration 0367).

export const etaKind = 'delivery.eta'
/** An estimate is asked for at pickup, and after that at most this often, and only when a reader finds it older (DELIVERY §7). */
export const etaRefreshMs = 120_000

export interface TrackingStep {
  state: string
  at: Date
}

export interface TrackingRiderView {
  firstName: string
  phone: string | null
  photoAssetId: string | null
  vehicleType: string | null
  vehicleNumber: string | null
}

export interface TrackingView {
  state: string
  steps: TrackingStep[]
  rider: TrackingRiderView | null
  position: { latitude: number; longitude: number; reportedAt: Date } | null
  etaAt: Date | null
  handoverCode: string | null
}

const stepsOf = (d: TrackedDelivery): TrackingStep[] =>
  (
    [
      ['packing', d.created_at],
      ['searching', d.searching_at],
      ['unassigned', d.unassigned_at],
      ['assigned', d.assigned_at],
      ['picked_up', d.picked_up_at],
      ['delivered', d.delivered_at],
      ['failed', d.failed_at],
      ['cancelled', d.cancelled_at],
    ] as const
  )
    .flatMap(([state, at]) => (at ? [{ state, at }] : []))
    .sort((a, b) => a.at.getTime() - b.at.getTime())

/** Claims an estimate for the delivery and queues the one job that asks for it; false when another caller holds it already. System scope. */
export const startEtaRefresh = async (tx: ScopedSql, who: { partnerId: string; storeId: string }, deliveryId: string, now: Date, everyMs: number): Promise<boolean> => {
  if (!(await claimEtaRefresh(tx, who.storeId, deliveryId, now, everyMs))) return false
  await insertOutbox(tx, { kind: etaKind, partnerId: who.partnerId, storeId: who.storeId, idempotencyKey: `${deliveryId}:${now.toISOString()}`, payload: { deliveryId } })
  return true
}

export interface TrackingDeps {
  sql: postgres.Sql
  context: TenantContext
  secrets: SecretBox | null
  /** Whether an estimate can be made here (the Routes key is set): without it the answer's `etaAt` stays empty. */
  estimates: boolean
  now: () => Date
}

export const createTracking = ({ sql, context, secrets, estimates, now }: TrackingDeps) => {
  const { storeId, partnerId } = context

  /** The delivery of this order for its own reader, or null when there is none or the reader does not own the order. */
  const read = async (orderId: string): Promise<TrackingView | null> => {
    const seen = await withScope(sql, context, async (tx) => {
      const latest = (await selectTrackedDeliveries(tx, storeId, orderId))[0]
      if (!latest) return null
      const live = latest.state === 'assigned' || latest.state === 'picked_up'
      const rider = live && latest.rider_id ? await selectTrackedRider(tx, storeId, latest.rider_id) : null
      const position = latest.state === 'picked_up' && latest.rider_id ? await selectTrackedPosition(tx, storeId, latest.rider_id) : null
      return { latest, live, rider, position }
    })
    if (!seen) return null
    const { latest, live, rider, position } = seen

    // The sealed code is read in system scope: no request role may select it, and the order's ownership was shown above.
    const held = live && secrets ? await withSystemScope(sql, (tx) => selectHandoverCode(tx, { id: latest.id, store_id: storeId })) : null
    const handoverCode = held?.handover_code_enc && secrets ? await openHandoverCode(secrets, latest.id, held.handover_code_enc) : null

    if (estimates && position) await withSystemScope(sql, (tx) => startEtaRefresh(tx, { partnerId, storeId }, latest.id, now(), etaRefreshMs))

    return {
      state: latest.state,
      steps: stepsOf(latest),
      rider: rider ? { firstName: rider.name.trim().split(/\s+/)[0] ?? rider.name, phone: rider.phone, photoAssetId: rider.photo_asset_id, vehicleType: rider.vehicle_type, vehicleNumber: rider.vehicle_number } : null,
      position: position ? { latitude: position.latitude, longitude: position.longitude, reportedAt: position.reported_at } : null,
      etaAt: latest.state === 'picked_up' ? latest.eta_at : null,
      handoverCode,
    }
  }

  return { read }
}
