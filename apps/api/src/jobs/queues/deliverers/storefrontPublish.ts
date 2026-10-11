import { publishParams, type PublishParams } from '#saas/storefronts/index'
import { GiveUp, type Deliverer } from '../outbox-relay'

export type PublishWorkflow = Pick<Workflow<PublishParams>, 'get' | 'create'>

/** `storefront.publish`: starts the publish-storefront Workflow under the run's id, so a redelivery finds the one it started. */
export const storefrontPublishDeliverer = (workflow: PublishWorkflow): Deliverer => ({
  deliver: async (effect) => {
    const parsed = publishParams.safeParse(effect.payload)
    if (!parsed.success) throw new GiveUp('bad_payload')
    const started = await workflow.get(parsed.data.runId).then(
      () => true,
      () => false,
    )
    if (!started) await workflow.create({ id: parsed.data.runId, params: parsed.data })
  },
})
