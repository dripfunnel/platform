import { createStorefrontParams, undoStorefrontParams, type CreateStorefrontParams, type UndoStorefrontParams } from '#saas/storefronts/index'
import { GiveUp, type Deliverer } from '../outbox-relay'

/** The Workflow binding's two calls the deliverers make. */
export type StorefrontWorkflow = Pick<Workflow<CreateStorefrontParams | UndoStorefrontParams>, 'get' | 'create'>

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

/** `storefront.undo` (an Admin Undo, #730): the same Workflow, an instance of its own, since the job's was used by its create run. */
export const storefrontUndoDeliverer = (workflow: StorefrontWorkflow): Deliverer => ({
  deliver: async (effect) => {
    const parsed = undoStorefrontParams.safeParse(effect.payload)
    if (!parsed.success) throw new GiveUp('bad_payload')
    const id = `undo-${parsed.data.jobId}`
    const started = await workflow.get(id).then(
      () => true,
      () => false,
    )
    if (!started) await workflow.create({ id, params: parsed.data })
  },
})
