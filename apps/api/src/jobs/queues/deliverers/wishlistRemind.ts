import type postgres from 'postgres'
import { z } from 'zod'
import { logEvent } from '#core/log'
import { decideWishlistReminder } from '#engine/modules/cartReminders/index'
import { NotYet } from '#saas/outbox/index'
import { GiveUp, type Deliverer } from '../outbox-relay'

// `wishlist.remind`: one queued wishlist reminder, decided as it is delivered (engine/modules/cartReminders/wishlistJobs.ts):
// skipped with its reason, held through the store's quiet hours, or queued on as its email.

const payload = z.object({ reminderId: z.uuid() }).strict()

export const wishlistRemindDeliverer = (sql: postgres.Sql, suppressionKey: string, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success) throw new GiveUp('bad_payload')
    const decision = await decideWishlistReminder({ sql, now, suppressionKey }, parsed.data.reminderId, { partnerId: effect.partnerId, storeId: effect.storeId })
    if (decision.kind === 'wait') throw new NotYet('quiet_hours', decision.ms)
    logEvent({ event: 'wishlist_reminder', api: 'system', partnerId: effect.partnerId, storeId: effect.storeId, code: decision.kind === 'skipped' ? decision.reason : decision.kind })
  },
})
