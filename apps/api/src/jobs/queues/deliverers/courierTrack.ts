import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog } from '#auth/activity'
import type { CourierDirectory } from '#core/couriers'
import { CourierRejected, CourierUnavailable } from '#core/couriers'
import { withSystemScope } from '#db/scoped/index'
import { insertOutboxMany } from '#db/scoped/outbox'
import { selectCashToSettle, selectShipmentsToTrack, selectStoresToTrack, setTrackingPolled } from '#db/scoped/tracking'
import { markPaidIn } from '#engine/modules/checkout/index'
import { applyTracking } from '#engine/modules/orders/index'
import { GiveUp, type Deliverer } from '../outbox-relay'

// Shiprocket tracking asked every half hour, alongside its hook (THIRD-PARTY-ACCESS §3.2): one job per store, one login
// for its parcels, applied as a hook's events are, so a status the hook already brought changes nothing. A delivered COD
// parcel is asked about its remittance every six hours, and its order marked paid once Shiprocket has paid the cash out.

export const courierTrackKind = 'courier.track'
const intervalMs = 30 * 60 * 1000
const cashIntervalMs = 6 * 60 * 60 * 1000
const windowMs = 60 * 24 * 60 * 60 * 1000
const storesPerRun = 200
// Each parcel is one call to Shiprocket, each remittance two; the Worker's subrequests per run are limited.
const parcelsPerStore = 40
const cashPerStore = 20

const payload = z.strictObject({})

export const queueCourierTracking = (sql: postgres.Sql, now: Date): Promise<number> =>
  withSystemScope(sql, async (tx) => {
    const ago = (ms: number) => new Date(now.getTime() - ms)
    const stores = await selectStoresToTrack(tx, ago(windowMs), ago(intervalMs), ago(cashIntervalMs), storesPerRun)
    const window = Math.floor(now.getTime() / intervalMs)
    await insertOutboxMany(tx, stores.map((s) => ({ kind: courierTrackKind, idempotencyKey: `${s.store_id}:track:${window}`, payload: {}, partnerId: s.partner_id, storeId: s.store_id })))
    return stores.length
  })

// A refused login or an outage waits for the next run; the merchant sees the login's state in Settings › Shipping.
const orNull = <T>(work: Promise<T>): Promise<T | null> =>
  work.catch((error: unknown) => {
    if (error instanceof CourierRejected || error instanceof CourierUnavailable) return null
    throw error
  })

export const courierTrackDeliverer = (sql: postgres.Sql, couriers: CourierDirectory, activity: ActivityLog, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect, signal) => {
    if (!payload.safeParse(effect.payload).success || !effect.storeId || !effect.partnerId) throw new GiveUp('bad_payload')
    const { storeId, partnerId } = effect
    const at = now()
    const ago = (ms: number) => new Date(at.getTime() - ms)
    const [due, owed] = await withSystemScope(sql, async (tx) => [
      await selectShipmentsToTrack(tx, storeId, ago(windowMs), ago(intervalMs), parcelsPerStore),
      await selectCashToSettle(tx, storeId, ago(windowMs), ago(cashIntervalMs), cashPerStore),
    ] as const)
    if (due.length === 0 && owed.length === 0) return
    const { gateway } = await couriers.forStore(storeId)
    if (due.length > 0) {
      const events = await orNull(gateway.track('shiprocket', due.map((d) => d.provider_ref), signal))
      if (events) await applyTracking({ sql, activity }, { partnerId, storeId }, 'shiprocket', events)
    }
    if (owed.length > 0) {
      const remitted = new Set((await orNull(gateway.remitted('shiprocket', owed.map((o) => o.provider_ref), signal))) ?? [])
      for (const parcel of owed.filter((o) => remitted.has(o.provider_ref))) {
        // A merchant's own Mark as paid, or a second run, finds the order no longer pending and changes nothing.
        await withSystemScope(sql, (tx) => markPaidIn(tx, { storeId, actor: { id: null, partnerId, kind: 'job', label: 'Shiprocket remittance' }, activity, facts: { requestId: null, ip: null, userAgent: null }, now: () => at }, parcel.order_id))
      }
    }
    await withSystemScope(sql, (tx) => setTrackingPolled(tx, [...due, ...owed].map((d) => d.id), at))
  },
})
