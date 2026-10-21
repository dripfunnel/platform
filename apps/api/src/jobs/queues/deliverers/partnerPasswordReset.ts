import type postgres from 'postgres'
import { z } from 'zod'
import { partnerPasswordResetRequested } from '#auth/activity'
import { withSystemScope } from '#db/scoped/index'
import { insertPasswordResets } from '#db/scoped/partnerInvitations'
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
 * `partner_password_reset.request`: finds the accounts off the request path, so a known and an
 * unknown email cost the request the same (ACCESS.md §4). Keyed by the outbox row, so a retry
 * writes no second reset, email or entry.
 */
export const partnerPasswordResetDeliverer = (sql: postgres.Sql): Deliverer => ({
  deliver: async (effect) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('partner_password_reset.request: bad payload')
    const { email, requestedAt, ...facts } = parsed.data
    await withSystemScope(sql, async (tx) => {
      for (const reset of await insertPasswordResets(tx, effect.id, email)) {
        // The deliverer mints the token when it sends (auth/partnerTokens.ts), once SES is wired.
        await queueSideEffect(tx, {
          kind: 'email',
          idempotencyKey: `partner-password-reset:${reset.id}`,
          payload: { template: 'partner-password-reset', partnerPasswordResetId: reset.id, to: reset.email },
          partnerId: reset.partner_id,
          storeId: null,
        })
        await activityLog.record(tx, { ...partnerPasswordResetRequested({ id: reset.partner_user_id, partnerId: reset.partner_id }, facts), occurredAt: new Date(requestedAt) })
      }
    })
  },
})
