import type postgres from 'postgres'
import { z } from 'zod'
import { completeExportJob, failExportJob, selectExportJob } from '#db/scoped/exportJobs'
import { maxPageSize, withScope } from '#db/scoped/index'
import { selectStores, type StoreListRow } from '#db/scoped/stores'
import { storeFilter, storesCsv, storesExportLifetimeMs, storesExportMax, toStoreFilter } from '#saas/partnerStores/index'
import { stuckAfterMinutes } from '#saas/provisioning/index'
import { defaultRelayOptions, type Deliverer } from '../outbox-relay'

const payload = z.object({ jobId: z.guid(), partnerId: z.guid(), partnerUserId: z.guid() }).strict()

/** `export.stores`: the Stores list's rows as CSV, read page by page in the partner's own scope. */
export const storesExportDeliverer = (sql: postgres.Sql, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('export.stores: bad payload')
    const { jobId, partnerId, partnerUserId } = parsed.data
    const scope = { caller: { kind: 'partner-user' as const, partnerUserId }, partnerId }
    try {
      await withScope(sql, scope, async (tx) => {
        const job = await selectExportJob(tx, jobId)
        if (job?.kind !== 'stores' || job.state !== 'queued') return
        const at = now()
        const filter = toStoreFilter(partnerId, storeFilter.parse(job.filter), at)
        const rows: StoreListRow[] = []
        let after: { occurredAt: Date; id: string } | undefined
        while (rows.length <= storesExportMax) {
          const page = await selectStores(tx, filter, { after }, maxPageSize, stuckAfterMinutes, at)
          rows.push(...page)
          const last = page.at(-1)
          if (page.length < maxPageSize || !last) break
          after = { occurredAt: last.created_at, id: last.id }
        }
        const truncated = rows.length > storesExportMax
        const kept = rows.slice(0, storesExportMax)
        await completeExportJob(tx, jobId, { rows: kept.length, truncated, csv: storesCsv(kept, truncated), at, expiresAt: new Date(at.getTime() + storesExportLifetimeMs) })
      })
    } catch (error) {
      if (effect.attempt >= defaultRelayOptions.maxAttempts) await withScope(sql, scope, (tx) => failExportJob(tx, jobId, now(), new Date(now().getTime() + storesExportLifetimeMs)))
      throw error
    }
  },
})
