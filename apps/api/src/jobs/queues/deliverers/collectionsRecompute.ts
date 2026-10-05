import type postgres from 'postgres'
import { z } from 'zod'
import { recomputeCollections } from '#db/scoped/catalogStructure'
import { withSystemScope } from '#db/scoped/index'
import type { Deliverer } from '../outbox-relay'

const payload = z.object({ storeId: z.guid() }).strict()

export const collectionsRecomputeKind = 'collections.recompute'

/** `collections.recompute`: a store's automatic collections from their rules, after the change that asked (CATALOG fact 14). */
export const collectionsRecomputeDeliverer = (sql: postgres.Sql, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('collections.recompute: bad payload')
    await withSystemScope(sql, (tx) => recomputeCollections(tx, parsed.data.storeId, now()))
  },
})
