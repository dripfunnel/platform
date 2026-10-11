import { createStorefrontParams, type CreateStorefrontParams } from '#saas/storefronts/index'
import { GiveUp, type Deliverer } from '../outbox-relay'

/** The Workflow binding's two calls the deliverer makes. */
export type StorefrontWorkflow = Pick<Workflow<CreateStorefrontParams>, 'get' | 'create'>

/**
 * `storefront.create`: starts the create-storefront Workflow after the choice commits (SAAS §5), its instance named by
 * the job, so a redelivery finds the one it started instead of starting a second.
 */
export const storefrontCreateDeliverer = (workflow: StorefrontWorkflow): Deliverer => ({
  deliver: async (effect) => {
    const parsed = createStorefrontParams.safeParse(effect.payload)
    if (!parsed.success) throw new GiveUp('bad_payload')
    const started = await workflow.get(parsed.data.jobId).then(
      () => true,
      () => false,
    )
    if (!started) await workflow.create({ id: parsed.data.jobId, params: parsed.data })
  },
})
