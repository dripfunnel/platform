import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { PartnerCaller } from '#auth/partnerCaller'
import { csvLine } from '#core/csv'
import { insertExportJob, selectExportJob } from '#db/scoped/exportJobs'
import { withScope } from '#db/scoped/index'
import type { StoreListRow } from '#db/scoped/stores'
import { partnerEntry } from '#saas/activity/index'
import { queueSideEffect } from '#saas/outbox/index'
import { storeFilter } from './filter'

// Export accounts (CSV) (ui/platform/FIRST-RELEASE.md §6.1; card #221): the list's account
// columns, never an order, a customer or a product, built after commit like the other exports.

export const storesExportAudit = 'stores.exported'
export const storesExportLifetimeMs = 60 * 60 * 1000
export const storesExportMax = 10_000

const header = ['store', 'code', 'owner', 'owner email', 'plan', 'status', 'storefront', 'domain', 'country', 'created']

export const storesCsv = (rows: readonly StoreListRow[], truncated: boolean): string =>
  [
    csvLine(header),
    ...rows.map((r) =>
      csvLine([
        r.name,
        r.code,
        r.owner_name,
        r.owner_email,
        r.plan_name,
        r.status,
        r.storefront_kind === 'own' ? 'own' : (r.build_state ?? 'building'),
        r.domain_host,
        r.country,
        r.created_at.toISOString(),
      ]),
    ),
    ...(truncated ? [csvLine([`Only the first ${rows.length} stores are included; narrow the filter to see the rest.`])] : []),
  ].join('\n')

export interface PartnerStoresExportDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  now: () => Date
}

export const createPartnerStoresExport = ({ sql, caller, facts, activity, now }: PartnerStoresExportDeps) => {
  const partnerId = caller.partner.id
  const context = { caller: { kind: 'partner-user' as const, partnerUserId: caller.user.id }, partnerId }

  /** Every role may export (ACCESS §5.3 `exports`); a filter it cannot read is refused, never read as none. */
  const exportStores = (raw: unknown): Promise<{ ok: true; jobId: string } | { ok: false; reason: 'INVALID_INPUT' }> => {
    const parsed = storeFilter.safeParse(raw ?? {})
    if (!parsed.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    return withScope(sql, context, async (tx) => {
      const jobId = await insertExportJob(tx, { partnerId, kind: 'stores', filter: parsed.data, byId: caller.user.id, byLabel: caller.user.name })
      await queueSideEffect(tx, { kind: 'export.stores', idempotencyKey: jobId, payload: { jobId, partnerId, partnerUserId: caller.user.id }, partnerId, storeId: null })
      await activity.record(tx, partnerEntry(caller, facts)({ action: storesExportAudit, target: { type: 'export', id: jobId, label: 'Stores' }, reason: null, changes: [{ field: 'filter', before: null, after: JSON.stringify(parsed.data) }] }))
      return { ok: true as const, jobId }
    })
  }

  /** A stores export's state and its CSV until it expires; null for an id that isn't the partner's stores export. */
  const storesExport = (id: string) => {
    if (!z.guid().safeParse(id).success) return Promise.resolve(null)
    return withScope(sql, context, async (tx) => {
      const job = await selectExportJob(tx, id)
      if (job?.kind !== 'stores') return null
      const expired = job.expires_at !== null && job.expires_at <= now()
      return { id: job.id, state: expired ? ('expired' as const) : job.state, rows: job.rows, truncated: job.truncated, csv: expired ? null : job.csv, expiresAt: job.expires_at }
    })
  }

  return { exportStores, storesExport }
}

export type PartnerStoresExport = ReturnType<typeof createPartnerStoresExport>
