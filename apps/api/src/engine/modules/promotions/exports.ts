import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { csvLine } from '#core/csv'
import type { TenantContext } from '#core/tenancy'
import { insertCatalogExport, selectCatalogExport, type CatalogExportRow } from '#db/scoped/catalogExports'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { selectBatch, selectBatchCodes } from '#db/scoped/promotions'
import { jobPayloadOf, type CatalogJobPayload } from '#engine/modules/catalog/index'

// A run of single-use codes as a spreadsheet (H4; `offers.export`, Owner and Manager, decided 2026-10-05): a job through
// the store's exports, built after commit in the asker's own scope and read back only by the person who asked.

export const offerCodesExportAudit = 'offer.codes_exported'

const filterSchema = z.object({ batchId: z.guid() }).strict()

export const buildOfferCodesExport = async (tx: ScopedSql, job: CatalogExportRow): Promise<{ rows: number; truncated: boolean; csv: string }> => {
  const { batchId } = filterSchema.parse(job.filter)
  const codes = await selectBatchCodes(tx, job.store_id, batchId)
  const lines = codes.map((c) => csvLine([c.code, c.used_at ? 'used' : 'unused', c.used_at ? c.used_at.toISOString() : null]))
  return { rows: codes.length, truncated: false, csv: [csvLine(['code', 'state', 'used at (UTC)']), ...lines].join('\n') }
}

export interface OfferCodesExportDto {
  id: string
  state: 'queued' | 'done' | 'failed' | 'expired'
  rows: number | null
  csv: string | null
  requestedAt: Date
  expiresAt: Date | null
}

export interface OfferCodesExportDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; label: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
  queue: (tx: ScopedSql, payload: CatalogJobPayload) => Promise<unknown>
}

export const createOfferCodesExport = ({ sql, context, actor, activity, facts, now, queue }: OfferCodesExportDeps) => {
  const { storeId } = context
  const supplier = context.sellerScope.kind === 'seller'

  const request = async (batchId: string): Promise<{ ok: true; jobId: string } | { ok: false; reason: 'NOT_FOUND' | 'INVALID_INPUT' }> => {
    if (supplier || !z.guid().safeParse(batchId).success) return { ok: false, reason: 'NOT_FOUND' }
    if (!jobPayloadOf(context, storeId)) return { ok: false, reason: 'INVALID_INPUT' }
    return withScope(sql, context, async (tx) => {
      const batch = await selectBatch(tx, storeId, batchId.toLowerCase())
      if (!batch) return { ok: false as const, reason: 'NOT_FOUND' as const }
      const id = await insertCatalogExport(tx, { storeId, sellerId: null, kind: 'offer_codes', filter: { batchId: batch.id }, byId: actor.id, byLabel: actor.label })
      const payload = jobPayloadOf(context, id)
      if (payload) await queue(tx, payload)
      await activity.record(tx, {
        category: 'write',
        action: offerCodesExportAudit,
        result: 'success',
        actorKind: 'person',
        actorId: actor.id,
        actorLabel: null,
        partnerId: actor.partnerId,
        storeId,
        target: { type: 'offer', id: batch.promotion_id, label: batch.name },
        reason: null,
        changes: [{ field: 'batch', before: null, after: batch.id }],
        api: 'store',
        visibility: 'store',
        ...facts,
      })
      return { ok: true as const, jobId: id }
    })
  }

  /** The export's state and its file until it expires; null for an id the caller didn't ask for. */
  const read = (id: string): Promise<OfferCodesExportDto | null> => {
    if (supplier || !z.guid().safeParse(id).success) return Promise.resolve(null)
    return withScope(sql, context, async (tx) => {
      const job = await selectCatalogExport(tx, storeId, id.toLowerCase())
      if (!job || job.kind !== 'offer_codes' || job.requested_by_id !== actor.id) return null
      const expired = job.expires_at !== null && job.expires_at <= now()
      return { id: job.id, state: expired ? 'expired' : job.state, rows: job.rows, csv: expired ? null : job.csv, requestedAt: job.created_at, expiresAt: job.expires_at }
    })
  }

  return { request, read }
}
