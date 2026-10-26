import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog } from '#auth/activity'
import { broadcastDelivery } from '#engine/modules/ownDelivery/index'
import { GiveUp, type Deliverer } from '../outbox-relay'

const payload = z.strictObject({ deliveryId: z.uuid(), round: z.number().int().positive(), offeredRecorded: z.boolean().optional() })
export const deliveryOfferDeliverer = (sql: postgres.Sql, activity: ActivityLog, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success || !effect.partnerId || !effect.storeId) throw new GiveUp('bad_payload')
    await broadcastDelivery(sql, { storeId: effect.storeId, partnerId: effect.partnerId, activity, now: now(), ...(parsed.data.offeredRecorded ? { offeredRecorded: true } : {}) }, parsed.data.deliveryId, parsed.data.round)
  },
})
