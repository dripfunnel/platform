import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { csvLine } from '#core/csv'
import type { TenantContext } from '#core/tenancy'
import { insertCatalogExport, selectCatalogExport, selectCatalogExports, type CatalogExportRow } from '#db/scoped/catalogExports'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { selectCustomerExportRows, type CustomerExportRow } from '#db/scoped/storeCustomers'
import { jobPayloadOf, type CatalogJobPayload } from '#engine/modules/catalog/index'

// Customers as a spreadsheet (FIRST-RELEASE §7, PortalOrders "Export"): a job through the store's exports, built after
// commit in the asker's own scope. The merchant side's only: a supplier is refused before a job exists (§13).

export const customerExportAudit = 'customer.exported'
/** Spreadsheet rows, one a customer: past it the file says to narrow the filter. */
export const customerExportMax = 10_000

export const customerExportFilter = z
  .object({
    groupId: z.guid().nullable().default(null),
    search: z.string().trim().max(100).nullable().default(null),
  })
  .strict()

const header = ['name', 'email', 'phone', 'city', 'orders', 'spent', 'currency', 'tags', 'groups', 'marketing consent']

// One row a customer, or a row a currency for one who has paid in more than one.
export const customersCsv = (rows: readonly CustomerExportRow[], truncatedAt: number | null): string => {
  const lines = rows.flatMap((r) => {
    const base = [r.name, r.email, r.phone, r.city, r.orders] as const
    const tail = [r.tags.join('; '), r.groups.join('; '), r.consent_state] as const
    if (r.spent.length === 0) return [csvLine([...base, null, null, ...tail])]
    return r.spent.map((s) => csvLine([...base, { amount: BigInt(s.amount), currency: s.currency }, s.currency, ...tail]))
  })
  return [csvLine(header), ...lines, ...(truncatedAt === null ? [] : [csvLine([`Cut at ${truncatedAt} customers: narrow the filter for the rest.`])])].join('\n')
}

export const buildCustomerExport = async (tx: ScopedSql, job: CatalogExportRow, max = customerExportMax): Promise<{ rows: number; truncated: boolean; csv: string }> => {
  const filter = customerExportFilter.parse(job.filter)
  const rows = await selectCustomerExportRows(tx, job.store_id, filter, max + 1)
  const truncated = rows.length > max
  const kept = rows.slice(0, max)
  return { rows: kept.length, truncated, csv: customersCsv(kept, truncated ? kept.length : null) }
}

export interface CustomerExportDto {
  id: string
  state: 'queued' | 'done' | 'failed' | 'expired'
  rows: number | null
  truncated: boolean
  csv: string | null
  requestedAt: Date
  expiresAt: Date | null
}

const dtoOf = (job: Omit<CatalogExportRow, 'csv'> & { csv?: string | null }, now: Date): CustomerExportDto => {
  const expired = job.expires_at !== null && job.expires_at <= now
  return { id: job.id, state: expired ? 'expired' : job.state, rows: job.rows, truncated: job.truncated, csv: expired ? null : (job.csv ?? null), requestedAt: job.created_at, expiresAt: job.expires_at }
}

export interface CustomerExportDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; label: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
  /** Queues the job's outbox row in the same transaction. */
  queue: (tx: ScopedSql, payload: CatalogJobPayload) => Promise<unknown>
}

export const createCustomerExportService = ({ sql, context, actor, activity, facts, now, queue }: CustomerExportDeps) => {
  const { storeId } = context
  const supplier = context.sellerScope.kind === 'seller'
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)

  /** The search text isn't logged (LOGGING §4.1), only that there was one. */
  const request = async (raw: unknown): Promise<{ ok: true; jobId: string } | { ok: false; reason: 'INVALID_INPUT' | 'NOT_FOUND' }> => {
    if (supplier) return { ok: false, reason: 'NOT_FOUND' }
    const parsed = customerExportFilter.safeParse(raw ?? {})
    if (!parsed.success || !jobPayloadOf(context, storeId)) return { ok: false, reason: 'INVALID_INPUT' }
    const filter = parsed.data
    const jobId = await inScope(async (tx) => {
      const id = await insertCatalogExport(tx, { storeId, sellerId: null, kind: 'customers', filter, byId: actor.id, byLabel: actor.label })
      const payload = jobPayloadOf(context, id)
      if (payload) await queue(tx, payload)
      await activity.record(tx, {
        category: 'write',
        action: customerExportAudit,
        result: 'success',
        actorKind: 'person',
        actorId: actor.id,
        actorLabel: null,
        partnerId: actor.partnerId,
        storeId,
        target: { type: 'export', id, label: 'Customers' },
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

  /** A customers export's state and its file until it expires; null for an id that isn't one the caller asked for. */
  const read = (id: string): Promise<CustomerExportDto | null> => {
    if (supplier || !z.guid().safeParse(id).success) return Promise.resolve(null)
    return inScope(async (tx) => {
      const job = await selectCatalogExport(tx, storeId, id)
      return job && job.kind === 'customers' && job.requested_by_id === actor.id ? dtoOf(job, now()) : null
    })
  }

  const recent = (): Promise<CustomerExportDto[]> =>
    supplier ? Promise.resolve([]) : inScope(async (tx) => (await selectCatalogExports(tx, storeId, actor.id, ['customers'], 10)).map((j) => dtoOf(j, now())))

  return { request, read, recent }
}
