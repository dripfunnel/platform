import type postgres from 'postgres'
import { completeCatalogExport, failCatalogExport, selectCatalogExport } from '#db/scoped/catalogExports'
import { withScope } from '#db/scoped/index'
import { buildCustomerExport } from '#engine/modules/customers/index'
import { buildCatalogExport, catalogExportLifetimeMs, catalogJobPayload, jobContextOf } from '#engine/modules/catalog/index'
import { buildOrderExport } from '#engine/modules/orders/index'
import { buildReportExport } from '#engine/modules/reports/index'
import { defaultRelayOptions, type Deliverer } from '../outbox-relay'

/** `export.catalog`: a store's products, stock, orders, customers or reports as CSV, read in the asker's own scope, so a supplier's holds only its rows. */
export const catalogExportDeliverer = (sql: postgres.Sql, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect) => {
    const parsed = catalogJobPayload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('export.catalog: bad payload')
    const { jobId, storeId } = parsed.data
    const scope = jobContextOf(parsed.data)
    try {
      await withScope(sql, scope, async (tx) => {
        const job = await selectCatalogExport(tx, storeId, jobId)
        if (job?.state !== 'queued') return
        const built =
          job.kind === 'orders' ? await buildOrderExport(tx, job)
          : job.kind === 'customers' ? await buildCustomerExport(tx, job)
          : job.kind === 'report' ? await buildReportExport(tx, job)
          : await buildCatalogExport(tx, job)
        const at = now()
        await completeCatalogExport(tx, jobId, { ...built, at, expiresAt: new Date(at.getTime() + catalogExportLifetimeMs) })
      })
    } catch (error) {
      if (effect.attempt >= defaultRelayOptions.maxAttempts) await withScope(sql, scope, (tx) => failCatalogExport(tx, jobId, now(), new Date(now().getTime() + catalogExportLifetimeMs)))
      throw error
    }
  },
})
