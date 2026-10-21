import type postgres from 'postgres'
import { z } from 'zod'
import { personPasswordResetRequested } from '#auth/activity'
import { withSystemScope } from '#db/scoped/index'
import { insertUserPasswordReset } from '#db/scoped/userInvitations'
import { activityLog } from '#saas/activity/index'
import { queueSideEffect } from '#saas/outbox/index'
import type { Deliverer } from '../outbox-relay'

const payload = z.strictObject({
  email: z.string().max(320),
  requestedAt: z.iso.datetime(),
  requestId: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
})

/**
 * `user_password_reset.request`: finds the account under the row's partner off the request path,
 * as partnerPasswordReset.ts does, so a known and an unknown email cost the request the same.
 */
export const userPasswordResetDeliverer = (sql: postgres.Sql): Deliverer => ({
  deliver: async (effect) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success || !effect.partnerId) throw new Error('user_password_reset.request: bad payload')
    const { email, requestedAt, ...facts } = parsed.data
    const partnerId = effect.partnerId
    await withSystemScope(sql, async (tx) => {
      for (const reset of await insertUserPasswordReset(tx, effect.id, partnerId, email)) {
        await queueSideEffect(tx, {
          kind: 'email',
          idempotencyKey: `user-password-reset:${reset.id}`,
          payload: { template: 'user-password-reset', userPasswordResetId: reset.id, to: reset.email },
          partnerId,
          storeId: null,
        })
        await activityLog.record(tx, { ...personPasswordResetRequested({ id: reset.user_id, partnerId }, facts), occurredAt: new Date(requestedAt) })
      }
    })
  },
})
