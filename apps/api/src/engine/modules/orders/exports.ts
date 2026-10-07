import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { csvLine, type CsvValue } from '#core/csv'
import type { TenantContext } from '#core/tenancy'
import { insertCatalogExport, selectCatalogExport, selectCatalogExports, type CatalogExportRow } from '#db/scoped/catalogExports'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { orderFilters, selectMerchantExportLines, selectSupplierExportLines, type ExportLineRow } from '#db/scoped/storeOrders'
import { jobPayloadOf, type CatalogJobPayload } from '../catalog/jobScope'

// Orders as a spreadsheet (FIRST-RELEASE §6 "Export (a job)"): one row a line, built after commit in the asker's own scope
// through the store's export jobs, so a supplier's file is its own lines, masked as its screens are (ACCESS §5.2, §7.3).

export const orderExportAudit = 'orders.exported'
/** Spreadsheet rows, one a line: past it the file says to narrow the filter. */
export const orderExportMax = 10_000

export const orderExportFilter = z
  .object({
    filter: z.enum(orderFilters).default('all'),
    search: z.string().trim().max(100).nullable().default(null),
  })
  .strict()

const money = (amount: string | null, currency: string): CsvValue => (amount === null ? null : { amount: BigInt(amount), currency })
const merchantHeader = ['order', 'placed at (UTC)', 'status', 'payment', 'fulfilment', 'paid with', 'customer', 'email', 'phone', 'city', 'region', 'postal code', 'country',
  'item', 'option', 'sku', 'supplier', 'quantity', 'unit price', 'line total', 'order total', 'currency']
const supplierHeader = ['order', 'placed at (UTC)', 'status', 'your part', 'ships', 'customer', 'city', 'region', 'postal code', 'country', 'item', 'option', 'sku', 'quantity', 'unit price', 'amount', 'currency']

export const ordersCsv = (rows: readonly ExportLineRow[], supplier: boolean, truncatedAt: number | null): string => {
  const lines = rows.map((r) => {
    const a = r.address
    return supplier
      ? csvLine([r.number, r.placed_at.toISOString(), r.state, r.part_state, r.shipping_mode, r.customer_name, a?.city, a?.region, a?.postalCode, a?.country, r.name, r.version_name, r.sku, r.quantity,
          money(r.unit_amount, r.currency), money(r.line_amount, r.currency), r.currency])
      : csvLine([r.number, r.placed_at.toISOString(), r.state, r.payment_state, r.fulfilment_state, r.payment_method, r.customer_name, r.email, r.phone, a?.city, a?.region, a?.postalCode, a?.country,
          r.name, r.version_name, r.sku, r.supplier_name, r.quantity, money(r.unit_amount, r.currency), money(r.line_total_amount, r.currency), money(r.total_amount, r.currency), r.currency])
  })
  return [csvLine(supplier ? supplierHeader : merchantHeader), ...lines, ...(truncatedAt === null ? [] : [csvLine([`Cut at ${truncatedAt} rows: narrow the filter for the rest.`])])].join('\n')
}

/** The file, read as the asker: the merchant side's every line the filter chooses, a supplier's its own through the views. */
export const buildOrderExport = async (tx: ScopedSql, job: CatalogExportRow, max = orderExportMax): Promise<{ rows: number; truncated: boolean; csv: string }> => {
  const { filter, search } = orderExportFilter.parse(job.filter)
  const supplier = job.seller_id !== null
  const rows = supplier ? await selectSupplierExportLines(tx, filter, search, max + 1) : await selectMerchantExportLines(tx, job.store_id, filter, search, max + 1)
  const truncated = rows.length > max
  const kept = rows.slice(0, max)
  return { rows: kept.length, truncated, csv: ordersCsv(kept, supplier, truncated ? kept.length : null) }
}

export interface OrderExportDto {
  id: string
  state: 'queued' | 'done' | 'failed' | 'expired'
  rows: number | null
  truncated: boolean
  csv: string | null
  requestedAt: Date
  expiresAt: Date | null
}

const dtoOf = (job: Omit<CatalogExportRow, 'csv'> & { csv?: string | null }, now: Date): OrderExportDto => {
  const expired = job.expires_at !== null && job.expires_at <= now
  return { id: job.id, state: expired ? 'expired' : job.state, rows: job.rows, truncated: job.truncated, csv: expired ? null : (job.csv ?? null), requestedAt: job.created_at, expiresAt: job.expires_at }
}

export interface OrderExportDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; label: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
  /** Queues the job's outbox row in the same transaction. */
  queue: (tx: ScopedSql, payload: CatalogJobPayload) => Promise<unknown>
}

export const createOrderExportService = ({ sql, context, actor, activity, facts, now, queue }: OrderExportDeps) => {
  const { storeId } = context
  const sellerId = context.sellerScope.kind === 'seller' ? context.sellerScope.sellerId : null
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)

  /** The search text isn't logged (LOGGING §4.1), only that there was one. */
  const request = async (raw: unknown): Promise<{ ok: true; jobId: string } | { ok: false; reason: 'INVALID_INPUT' }> => {
    const parsed = orderExportFilter.safeParse(raw ?? {})
    if (!parsed.success || !jobPayloadOf(context, storeId)) return { ok: false, reason: 'INVALID_INPUT' }
    const filter = parsed.data
    const jobId = await inScope(async (tx) => {
      const id = await insertCatalogExport(tx, { storeId, sellerId, kind: 'orders', filter, byId: actor.id, byLabel: actor.label })
      const payload = jobPayloadOf(context, id)
      if (payload) await queue(tx, payload)
      await activity.record(tx, {
        category: 'write',
        action: orderExportAudit,
        result: 'success',
        actorKind: 'person',
        actorId: actor.id,
        actorLabel: null,
        partnerId: actor.partnerId,
        storeId,
        sellerId,
        target: { type: 'export', id, label: 'Orders' },
        reason: null,
        changes: [{ field: 'filter', before: null, after: JSON.stringify(filter.search === null ? filter : { ...filter, search: 'searched' }) }],
        api: 'store',
        visibility: 'store',
        ...facts,
      })
      return id
    })
    return { ok: true, jobId }
  }

  /** An orders export's state and its file until it expires; null for an id that isn't one the caller asked for. */
  const read = (id: string): Promise<OrderExportDto | null> => {
    if (!z.guid().safeParse(id).success) return Promise.resolve(null)
    return inScope(async (tx) => {
      const job = await selectCatalogExport(tx, storeId, id)
      return job && job.kind === 'orders' && job.requested_by_id === actor.id ? dtoOf(job, now()) : null
    })
  }

  const recent = (): Promise<OrderExportDto[]> => inScope(async (tx) => (await selectCatalogExports(tx, storeId, actor.id, ['orders'], 10)).map((j) => dtoOf(j, now())))

  return { request, read, recent }
}
