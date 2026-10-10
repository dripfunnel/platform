import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { csvLine, type CsvValue } from '#core/csv'
import type { TenantContext } from '#core/tenancy'
import { insertCatalogExport, selectCatalogExport, selectCatalogExports, type CatalogExportRow } from '#db/scoped/catalogExports'
import { withScope, type ScopedSql } from '#db/scoped/index'
import {
  selectByMarket,
  selectReportCustomers,
  selectReportLines,
  selectReportOrders,
  selectReportProducts,
  selectSold,
  selectSupplierUnits,
  selectTax,
  selectTopOffers,
  type ReportWindow,
} from '#db/scoped/storeReports'
import { exportDtoOf, jobPayloadOf, type CatalogExportDto, type CatalogJobPayload } from '#engine/modules/catalog/index'
import { createReportsService, reportRanges } from './reports'

// Every Reports panel as a spreadsheet, and the custom report builder's file (FIRST-RELEASE §10, PortalReports): a job
// through the store's exports, its range fixed when asked, so the file holds what the screen showed.

export const reportExportAudit = 'report.exported'
/** Spreadsheet rows: past it the file says to narrow the range. */
export const reportExportMax = 10_000

export const reportPanels = ['takings', 'sold', 'markets', 'tax', 'suppliers', 'offers', 'custom'] as const
export type ReportPanel = (typeof reportPanels)[number]

/** The builder's two steps (PortalReports "Custom report"): what each row is, then which columns. */
export const customColumns = { orders: ['basic', 'tax', 'lines'], products: ['basic', 'stock'], customers: ['basic', 'groups'] } as const
export type CustomRows = keyof typeof customColumns
export const customRows = Object.keys(customColumns) as CustomRows[]

const custom = z.discriminatedUnion('rows', [
  z.object({ rows: z.literal('orders'), columns: z.enum(customColumns.orders) }).strict(),
  z.object({ rows: z.literal('products'), columns: z.enum(customColumns.products) }).strict(),
  z.object({ rows: z.literal('customers'), columns: z.enum(customColumns.customers) }).strict(),
])
export type CustomReport = z.infer<typeof custom>

export const reportExportFilter = z
  .object({
    panel: z.enum(reportPanels),
    days: z.union(reportRanges.map((d) => z.literal(d))),
    currency: z.string().regex(/^[A-Z]{3}$/),
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    taxBy: z.enum(['state', 'rate']),
    custom: custom.nullable(),
  })
  .strict()
  .refine((f) => (f.panel === 'custom') === (f.custom !== null))
type ReportExportFilter = z.infer<typeof reportExportFilter>

const amount = (value: string, currency: string): CsvValue => ({ amount: BigInt(value), currency })
const day = (d: Date) => d.toISOString()

type Sheet = { header: string[]; rows: CsvValue[][] }

const ordersSheet = async (tx: ScopedSql, w: ReportWindow, limit: number, withTax: boolean): Promise<Sheet> => {
  const c = w.currency
  const rows = await selectReportOrders(tx, w, limit)
  if (!withTax) return { header: ['order', 'placed at (UTC)', 'customer', 'total', 'currency'], rows: rows.map((r) => [r.number, day(r.placed_at), r.customer, amount(r.total, c), c]) }
  return {
    header: ['order', 'placed at (UTC)', 'customer', 'market', 'total', 'refunded', 'net', 'tax', 'currency'],
    rows: rows.map((r) => [r.number, day(r.placed_at), r.customer, r.market, amount(r.total, c), amount(r.refunded, c), amount((BigInt(r.total) - BigInt(r.refunded)).toString(), c), amount(r.tax, c), c]),
  }
}

const customSheet = async (tx: ScopedSql, report: CustomReport, w: ReportWindow, limit: number): Promise<Sheet> => {
  const c = w.currency
  switch (report.rows) {
    case 'orders': {
      if (report.columns !== 'lines') return ordersSheet(tx, w, limit, report.columns === 'tax')
      const rows = await selectReportLines(tx, w, limit)
      return {
        header: ['order', 'placed at (UTC)', 'item', 'option', 'sku', 'quantity', 'unit price', 'line total', 'supplier', 'currency'],
        rows: rows.map((r) => [r.number, day(r.placed_at), r.name, r.version_name, r.sku, r.quantity, amount(r.unit, c), amount(r.total, c), r.supplier, c]),
      }
    }
    case 'products': {
      const stock = report.columns === 'stock'
      const rows = await selectReportProducts(tx, w, limit)
      return {
        header: ['product', 'units', 'takings', 'currency', ...(stock ? ['stock left', 'supplier'] : [])],
        rows: rows.map((r) => [r.name, r.units, amount(r.amount, c), c, ...(stock ? [r.stock, r.supplier] : [])]),
      }
    }
    case 'customers': {
      const groups = report.columns === 'groups'
      const rows = await selectReportCustomers(tx, w, limit)
      return {
        header: ['name', 'email', 'orders', 'spent', 'currency', ...(groups ? ['groups', 'tags'] : [])],
        rows: rows.map((r) => [r.name, r.email, r.orders, amount(r.amount, c), c, ...(groups ? [r.groups.join('; '), r.tags.join('; ')] : [])]),
      }
    }
  }
}

const sheetOf = async (tx: ScopedSql, f: ReportExportFilter, w: ReportWindow, limit: number): Promise<Sheet> => {
  const c = w.currency
  switch (f.panel) {
    case 'takings':
      return ordersSheet(tx, w, limit, true)
    case 'sold':
      return { header: ['product', 'units', 'takings', 'currency'], rows: (await selectSold(tx, w, limit)).map((r) => [r.name, r.units, amount(r.amount, c), c]) }
    case 'markets':
      return { header: ['market', 'orders', 'takings', 'currency'], rows: (await selectByMarket(tx, w, limit)).map((r) => [r.name, r.orders, amount(r.amount, c), c]) }
    case 'tax': {
      const tax = await selectTax(tx, w, f.taxBy)
      const key = (k: string | null) => (k === null ? null : f.taxBy === 'rate' ? `${Number(k) / 100}%` : k)
      return { header: [f.taxBy, 'orders', 'tax', 'currency'], rows: tax.rows.map((r) => [key(r.key), r.orders, amount(r.amount, c), c]) }
    }
    case 'suppliers':
      return { header: ['supplier', 'units sold'], rows: (await selectSupplierUnits(tx, w)).map((r) => [r.name ?? 'Your own products', r.units]) }
    case 'offers':
      return { header: ['offer', 'orders', 'discount', 'takings', 'currency'], rows: (await selectTopOffers(tx, w, limit)).map((r) => [r.label, r.orders, amount(r.discount, c), amount(r.amount, c), c]) }
    case 'custom':
      if (!f.custom) throw new Error('report export: a custom report names its rows')
      return customSheet(tx, f.custom, w, limit)
  }
}

/** The file, read as the asker over the range fixed when it was asked for. */
export const buildReportExport = async (tx: ScopedSql, job: CatalogExportRow, max = reportExportMax): Promise<{ rows: number; truncated: boolean; csv: string }> => {
  const f = reportExportFilter.parse(job.filter)
  const { header, rows } = await sheetOf(tx, f, { storeId: job.store_id, currency: f.currency, from: new Date(f.from), to: new Date(f.to) }, max + 1)
  const kept = rows.slice(0, max)
  const truncated = rows.length > max
  return { rows: kept.length, truncated, csv: [header, ...kept, ...(truncated ? [[`Cut at ${max} rows: pick a shorter range for the rest.`]] : [])].map(csvLine).join('\n') }
}

export interface ReportExportDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; label: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
  /** Queues the job's outbox row in the same transaction. */
  queue: (tx: ScopedSql, payload: CatalogJobPayload) => Promise<unknown>
}

export const createReportExportService = ({ sql, context, actor, activity, facts, now, queue }: ReportExportDeps) => {
  const { storeId } = context
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)

  const request = async (ask: { panel: ReportPanel; days: number; currency: string | null; custom: CustomReport | null }): Promise<{ ok: true; jobId: string } | { ok: false; reason: 'INVALID_INPUT' }> => {
    const opened = await createReportsService({ sql, context, now }).open(ask.days, ask.currency)
    if (!opened.ok || opened.value.currency === null || !jobPayloadOf(context, storeId)) return { ok: false, reason: 'INVALID_INPUT' }
    const r = opened.value
    const parsed = reportExportFilter.safeParse({ panel: ask.panel, days: r.days, currency: r.currency, from: r.from.toISOString(), to: r.to.toISOString(), taxBy: r.taxBy, custom: ask.custom })
    if (!parsed.success) return { ok: false, reason: 'INVALID_INPUT' }
    const filter = parsed.data
    const jobId = await inScope(async (tx) => {
      const id = await insertCatalogExport(tx, { storeId, sellerId: null, kind: 'report', filter, byId: actor.id, byLabel: actor.label })
      const payload = jobPayloadOf(context, id)
      if (payload) await queue(tx, payload)
      await activity.record(tx, {
        category: 'write',
        action: reportExportAudit,
        result: 'success',
        actorKind: 'person',
        actorId: actor.id,
        actorLabel: null,
        partnerId: actor.partnerId,
        storeId,
        target: { type: 'export', id, label: 'Report' },
        reason: null,
        changes: [{ field: 'report', before: null, after: JSON.stringify({ panel: filter.panel, days: filter.days, currency: filter.currency, custom: filter.custom }) }],
        api: 'store',
        visibility: 'store',
        ...facts,
      })
      return id
    })
    return { ok: true, jobId }
  }

  /** A report export's state and its file until it expires; null for an id that isn't one the caller asked for. */
  const read = (id: string): Promise<CatalogExportDto | null> => {
    if (!z.guid().safeParse(id).success) return Promise.resolve(null)
    return inScope(async (tx) => {
      const job = await selectCatalogExport(tx, storeId, id)
      return job && job.kind === 'report' && job.requested_by_id === actor.id ? exportDtoOf(job, now()) : null
    })
  }

  const recent = (): Promise<CatalogExportDto[]> => inScope(async (tx) => (await selectCatalogExports(tx, storeId, actor.id, ['report'], 10)).map((j) => exportDtoOf(j, now())))

  return { request, read, recent }
}
