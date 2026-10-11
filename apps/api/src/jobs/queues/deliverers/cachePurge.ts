import { z } from 'zod'
import { CloudflareRefused } from '#integrations/cloudflare/api'
import type { CachePurge } from '#integrations/cloudflare/purge'
import { edgeCacheTags } from '#saas/storefronts/index'
import { GiveUp, type Deliverer } from '../outbox-relay'

export const cachePurgeKind = 'cache.purge'

// Every producer's payload names a store, a host or a partner (SAAS §4.2, §8); the rest of it (the reason) isn't read.
const payload = z.object({ storeId: z.uuid().optional(), host: z.string().min(1).max(253).optional(), partnerId: z.uuid().optional() })

/**
 * `cache.purge`: the edge Worker's lookups of that store, host or partner, purged by tag after the change commits. Best effort
 * (LIVE-SHOP §5 step 1): registered only with a purge token, and the lookup's 60-second limit makes the change show without it.
 */
export const cachePurgeDeliverer = (purge: CachePurge): Deliverer => ({
  deliver: async (effect) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success) throw new GiveUp('bad_payload')
    const { storeId, host, partnerId } = parsed.data
    const tags = [storeId && edgeCacheTags.store(storeId), host && edgeCacheTags.host(host), partnerId && edgeCacheTags.partner(partnerId)].filter((t): t is string => typeof t === 'string')
    if (tags.length === 0) throw new GiveUp('bad_payload')
    try {
      await purge.purgeTags(tags)
    } catch (error) {
      if (error instanceof CloudflareRefused) throw new GiveUp('refused')
      throw error
    }
  },
})
