import { z } from 'zod'
import { PaymentRefused } from '#core/payments'
import { followStoreSubscription, type PlanBillingDeps } from '#saas/storeBilling/index'
import type { Deliverer } from '../outbox-relay'

const payload = z.strictObject({ storeId: z.guid() })

/** `plan.follow`: one store's Razorpay subscription read back (SAAS §7.4); Razorpay being down is retried by the relay. */
export const planFollowDeliverer = (deps: PlanBillingDeps): Deliverer => ({
  deliver: async (effect) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('plan.follow: bad payload')
    try {
      await followStoreSubscription(deps, parsed.data.storeId)
    } catch (error) {
      // A subscription Razorpay refuses to read won't read on a retry either.
      if (!(error instanceof PaymentRefused)) throw error
    }
  },
})
