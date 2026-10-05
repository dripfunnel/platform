import type postgres from 'postgres'
import { z } from 'zod'
import { recomputeCollections } from '#db/scoped/catalogStructure'
import { newerDueEffect } from '#db/scoped/outbox'
import { withSystemScope } from '#db/scoped/index'
import { collectionsRecomputeKind } from '#engine/modules/catalog/index'
import type { Deliverer } from '../outbox-relay'

const payload = z.object({ storeId: z.guid() }).strict()


/** `collections.recompute`: a store's automatic collections from their rules, after the change that asked (CATALOG fact 14). */
export const collectionsRecomputeDeliverer = (sql: postgres.Sql, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('collections.recompute: bad payload')
    // A burst of changes queues a run each; only the newest still queued does the work, so the store's
    // collections are recomputed once for the burst rather than once per change.
    await withSystemScope(sql, async (tx) => {
      if (await newerDueEffect(tx, { id: effect.id, kind: collectionsRecomputeKind, storeId: parsed.data.storeId }, now())) return
      await recomputeCollections(tx, parsed.data.storeId, now())
    })
  },
})
