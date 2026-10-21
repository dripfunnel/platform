import type postgres from 'postgres'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { StoreCaller } from '#auth/storeCaller'
import { withScope } from '#db/scoped/index'
import { z } from 'zod'
import { insertCatalogExport, type CatalogExportKind } from '#db/scoped/catalogExports'
import { selectExportBundle } from '#db/scoped/storeBilling'
import { catalogExportKind, exportDtoOf, jobPayloadOf, type CatalogExportDto } from '#engine/modules/catalog/index'
import { queueSideEffect } from '#saas/outbox/index'

// "Download my data first" (FIRST-RELEASE §16; ACCESS §5.1 `store.export`): the store's products, orders and customers,
// each the export its own screen makes, built after commit and read back together by the one who asked.

export const storeDataParts = ['products', 'orders', 'customers'] as const satisfies readonly CatalogExportKind[]
export const storeDataAudit = 'store.data_exported'

export interface StoreDataDeps {
  sql: postgres.Sql
  caller: StoreCaller
  facts: RequestFacts
  activity: ActivityLog
  now: () => Date
}

export const createStoreDataExport = ({ sql, caller, facts, activity, now }: StoreDataDeps) => {
  const { context } = caller
  const storeId = context.storeId
  const inStore = <T>(work: (tx: postgres.TransactionSql) => Promise<T>) => withScope(sql, context, work)
  const by = { id: caller.person.id, label: caller.person.name || caller.person.email }

  /** One job per part, queued with the request that asked; the bundle's id reads them back. */
  const request = (): Promise<string | null> => {
    const bundle = crypto.randomUUID()
    if (!jobPayloadOf(context, bundle)) return Promise.resolve(null)
    return inStore(async (tx) => {
      for (const kind of storeDataParts) {
        const jobId = await insertCatalogExport(tx, { storeId, sellerId: null, kind, filter: {}, byId: by.id, byLabel: by.label, bundle })
        const payload = jobPayloadOf(context, jobId)
        if (payload) await queueSideEffect(tx, { kind: catalogExportKind, idempotencyKey: jobId, payload, partnerId: payload.partnerId, storeId })
      }
      await activity.record(tx, {
        category: 'write',
        action: storeDataAudit,
        result: 'success',
        actorKind: 'person',
        actorId: by.id,
        actorLabel: null,
        partnerId: context.partnerId,
        storeId,
        sellerId: null,
        target: { type: 'export', id: bundle, label: 'Store data' },
        reason: null,
        changes: [{ field: 'parts', before: null, after: storeDataParts.join(', ') }],
        api: 'store',
        visibility: 'store',
        ...facts,
      })
      return bundle
    })
  }

  /** The bundle's parts with their files until they expire; empty for a bundle that isn't the caller's. */
  const read = (bundle: string): Promise<CatalogExportDto[]> =>
    z.guid().safeParse(bundle).success ? inStore(async (tx) => (await selectExportBundle(tx, storeId, by.id, bundle)).map((job) => exportDtoOf(job, now()))) : Promise.resolve([])

  return { request, read }
}
