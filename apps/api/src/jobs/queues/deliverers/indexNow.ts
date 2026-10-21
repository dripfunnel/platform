import type postgres from 'postgres'
import { IndexNowRefused, type IndexNow } from '#integrations/indexnow/client'
import { indexNowPayload, indexNowSubmission, type SitesBucket } from '#saas/storefronts/index'
import { GiveUp, type Deliverer } from '../outbox-relay'

/** `storefront.indexnow`: the changed pages of a build that stayed live; IndexNow down waits in the outbox. */
export const indexNowDeliverer = (sql: postgres.Sql, sites: SitesBucket, indexNow: IndexNow, shopDomain: string | null): Deliverer => ({
  deliver: async (effect) => {
    const parsed = indexNowPayload.safeParse(effect.payload)
    if (!parsed.success) throw new GiveUp('bad_payload')
    const submission = await indexNowSubmission({ sql, sites, shopDomain }, parsed.data)
    if (!submission) return
    try {
      await indexNow.submit(submission)
    } catch (error) {
      if (error instanceof IndexNowRefused) throw new GiveUp('refused')
      throw error
    }
  },
})
