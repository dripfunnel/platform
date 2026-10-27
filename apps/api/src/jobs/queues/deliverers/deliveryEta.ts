import type postgres from 'postgres'
import { z } from 'zod'
import { withSystemScope } from '#db/scoped/index'
import { selectEtaInputs, setEta } from '#db/scoped/deliveryTracking'
import { RoutesUnavailable, type GoogleRoutes } from '#integrations/googleRoutes/index'
import { GiveUp, type Deliverer } from '../outbox-relay'

const payload = z.strictObject({ deliveryId: z.uuid() })

/**
 * One arrival estimate for a picked-up delivery (DELIVERY §7): the rider's latest point to the order's pin. Without a Routes key
 * there is nothing to ask. A failed call is not retried here (the client has made its one retry): the next reader to find the
 * estimate older than two minutes asks again. Positions never reach a log.
 */
export const deliveryEtaDeliverer = (sql: postgres.Sql, routes: GoogleRoutes | null, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect, signal) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success || !effect.storeId) throw new GiveUp('bad_payload')
    if (!routes) return
    const storeId = effect.storeId
    const inputs = await withSystemScope(sql, (tx) => selectEtaInputs(tx, storeId, parsed.data.deliveryId))
    if (!inputs) return
    const seconds = await routes
      .durationSeconds({ latitude: inputs.rider_latitude, longitude: inputs.rider_longitude }, { latitude: inputs.to_latitude, longitude: inputs.to_longitude }, signal)
      .catch((error: unknown) => {
        if (error instanceof RoutesUnavailable) return null
        throw error
      })
    if (seconds === null) return
    const at = now()
    await withSystemScope(sql, (tx) => setEta(tx, storeId, parsed.data.deliveryId, new Date(at.getTime() + seconds * 1000), at))
  },
})
