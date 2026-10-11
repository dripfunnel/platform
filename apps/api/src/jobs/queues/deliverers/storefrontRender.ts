import type postgres from 'postgres'
import { renderRequest, requestPageRender } from '#saas/storefronts/index'
import { GiveUp, type Deliverer } from '../outbox-relay'

export const storefrontRenderKind = 'storefront.render'

/** `storefront.render`: a product's new or moved address, or #471's home page save, becomes a page run (LIVE-SHOP §7). */
export const storefrontRenderDeliverer = (sql: postgres.Sql, now: () => Date): Deliverer => ({
  deliver: async (effect) => {
    const parsed = renderRequest.safeParse(effect.payload)
    if (!parsed.success) throw new GiveUp('bad_payload')
    // A store with no live build yet gets the page with its first publish.
    await requestPageRender(sql, parsed.data, now())
  },
})
