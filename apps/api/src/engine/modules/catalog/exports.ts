import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { csvLine } from '#core/csv'
import { toMajor } from '#core/money'
import type { TenantContext } from '#core/tenancy'
import { selectProducts, selectPricingCurrency, type ProductFilter } from '#db/scoped/catalog'
import {
  insertCatalogExport,
  selectCatalogExport,
  selectCatalogExports,
  selectExportProducts,
  selectExportStock,
  type CatalogExportKind,
  type CatalogExportRow,
  type ExportProductRow,
  type ExportStockRow,
} from '#db/scoped/catalogExports'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { selectLanguages } from '#db/scoped/translations'
import { jobPayloadOf, type CatalogJobPayload } from './jobScope'

// Products and stock as spreadsheets (CATALOG K8–K11; FIRST-RELEASE §13): jobs built after commit in the
// asker's own scope, so a supplier's file is its screen and holds only its rows.

export const catalogExportKind = 'export.catalog'
export const catalogExportAudit = 'catalog.exported'
export const catalogExportLifetimeMs = 60 * 60 * 1000
/** Spreadsheet rows, one a version: past it the file says to narrow the filter. */
export const catalogExportMax = 10_000
const productPage = 100

const productFilters = ['all', 'visible', 'hidden', 'pending', 'sent_back', 'missing_info', 'low_stock'] as const satisfies readonly ProductFilter[]

export const catalogExportFilter = z
  .object({
    filter: z.enum(productFilters).default('all'),
    search: z.string().trim().max(200).nullable().default(null),
    /** The merchant side's supplier filter: a seller id or `own`; a supplier's is its session's. */
    supplier: z.union([z.guid(), z.literal('own')]).nullable().default(null),
  })
  .strict()
export type CatalogExportFilter = z.infer<typeof catalogExportFilter>

const optionColumns = [1, 2, 3].flatMap((n) => [`option${n} name`, `option${n} value`])
const productHeader = ['handle', 'name', 'description', 'type', 'visible', ...optionColumns, 'sku', 'barcode', 'price', 'compare at price', 'cost', 'weight grams', 'stock']

const money = (amount: string | null, currency: string | null): string | null => (amount === null || currency === null ? null : toMajor({ amount: BigInt(amount), currency }))

/**
 * One row a version, the product's own columns on its first row only (as Shopify's file does), then a
 * `name:hi`/`description:hi` pair a translation language and a `price:USD` column a manually priced currency (K10, K11).
 */
export const productsCsv = (rows: readonly ExportProductRow[], o: { currency: string; languages: readonly string[]; truncatedAt: number | null }): string => {
  const extra = [...new Set(rows.flatMap((p) => (p.versions ?? []).flatMap((v) => (v.prices ?? []).filter((x) => x.source === 'manual' && x.currency !== o.currency).map((x) => x.currency))))].sort()
  const header = [...productHeader, ...o.languages.flatMap((l) => [`name:${l}`, `description:${l}`]), ...extra.map((c) => `price:${c}`)]
  const lines = rows.flatMap((p) => {
    const text = (language: string, field: 'name' | 'description') => p.translations?.find((t) => t.language === language && t.field === field)?.text ?? null
    const versions = p.versions?.length ? p.versions : [null]
    return versions.map((v, i) => {
      const first = i === 0
      const priced = (currency: string) => v?.prices?.find((x) => x.currency === currency)
      const home = priced(o.currency)
      const options = [0, 1, 2].flatMap((n) => [first ? (p.options?.[n] ?? null) : null, v?.values?.[n] ?? null])
      return csvLine([
        p.slug,
        first ? p.name : null,
        first ? p.description : null,
        first ? p.product_type : null,
        first ? (p.visibility === 'visible' ? 'yes' : 'no') : null,
        ...options,
        v?.sku,
        v?.barcode,
        money(home?.amount ?? null, o.currency),
        money(home?.compare ?? null, o.currency),
        money(v?.cost ?? null, v?.cost_currency?.trim() ?? null),
        v?.weight,
        v?.stock,
        ...o.languages.flatMap((l) => [first ? text(l, 'name') : null, first ? text(l, 'description') : null]),
        ...extra.map((c) => {
          const x = priced(c)
          return x?.source === 'manual' ? money(x.amount, c) : null
        }),
      ])
    })
  })
  return [csvLine(header), ...lines, ...(o.truncatedAt === null ? [] : [csvLine([`Only the first ${o.truncatedAt} rows are included; narrow the filter to see the rest.`])])].join('\n')
}

export const stockCsv = (rows: readonly ExportStockRow[], truncatedAt: number | null): string =>
  [
    csvLine(['product', 'version', 'options', 'sku', 'location', 'on hand', 'reserved']),
    ...rows.map((r) => csvLine([r.product, r.version, r.values?.join(' / ') ?? null, r.sku, r.warehouse, r.on_hand, r.reserved])),
    ...(truncatedAt === null ? [] : [csvLine([`Only the first ${truncatedAt} rows are included; narrow the filter to see the rest.`])]),
  ].join('\n')

/**
 * The file for a queued job, read page by page in whatever scope `tx` holds (the asker's). At most `max` rows,
 * whole products for the product file; the scan stops there too, so products without stock can't walk the
 * whole catalogue in one delivery.
 */
export const buildCatalogExport = async (tx: ScopedSql, job: CatalogExportRow, max = catalogExportMax): Promise<{ rows: number; truncated: boolean; csv: string }> => {
  const filter = catalogExportFilter.parse(job.filter)
  const currency = (await selectPricingCurrency(tx)) ?? 'USD'
  const products: ExportProductRow[] = []
  const stock: ExportStockRow[] = []
  const count = () => (job.kind === 'products' ? products.reduce((n, p) => n + Math.max(1, p.versions?.length ?? 0), 0) : stock.length)
  let after: { value: string; id: string } | null = null
  let scanned = 0
  let more = false
  for (;;) {
    const page = await selectProducts(tx, job.store_id, { filter: filter.filter, search: filter.search, seller: filter.supplier, currency }, { limit: productPage, after, before: null })
    const ids = page.slice(0, productPage).map((p) => p.id)
    scanned += ids.length
    if (job.kind === 'products') products.push(...(await selectExportProducts(tx, job.store_id, ids)))
    else stock.push(...(await selectExportStock(tx, job.store_id, ids)))
    const last = page[productPage - 1]
    if (page.length <= productPage || !last) break
    if (count() > max || scanned >= max) {
      more = true
      break
    }
    after = { value: last.sort_key ?? last.created_at.toISOString(), id: last.id }
  }
  const truncated = more || count() > max
  if (job.kind === 'stock') {
    const kept = stock.slice(0, max)
    return { rows: kept.length, truncated, csv: stockCsv(kept, truncated ? kept.length : null) }
  }
  const kept: ExportProductRow[] = []
  let rows = 0
  for (const p of products) {
    const size = Math.max(1, p.versions?.length ?? 0)
    if (rows + size > max) break
    kept.push(p)
    rows += size
  }
  const { main, active } = await selectLanguages(tx, job.store_id)
  return { rows, truncated, csv: productsCsv(kept, { currency, languages: active.filter((l) => l !== main), truncatedAt: truncated ? rows : null }) }
}

export type CatalogExportRefusal = 'INVALID_INPUT'

export interface CatalogExportDto {
  id: string
  kind: CatalogExportKind
  state: 'queued' | 'done' | 'failed' | 'expired'
  rows: number | null
  truncated: boolean
  csv: string | null
  requestedAt: Date
  expiresAt: Date | null
}

const dtoOf = (job: Omit<CatalogExportRow, 'csv'> & { csv?: string | null }, now: Date): CatalogExportDto => {
  const expired = job.expires_at !== null && job.expires_at <= now
  return { id: job.id, kind: job.kind, state: expired ? 'expired' : job.state, rows: job.rows, truncated: job.truncated, csv: expired ? null : (job.csv ?? null), requestedAt: job.created_at, expiresAt: job.expires_at }
}

export interface CatalogExportDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; label: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
  /** Queues the job's outbox row in the same transaction. */
  queue: (tx: ScopedSql, payload: CatalogJobPayload) => Promise<unknown>
}

export const createCatalogExportService = ({ sql, context, actor, activity, facts, now, queue }: CatalogExportDeps) => {
  const { storeId } = context
  const sellerId = context.sellerScope.kind === 'seller' ? context.sellerScope.sellerId : null
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)

  /** A supplier's filter is its own products whatever it sends; the merchant's search text isn't logged (LOGGING §4.1). */
  const requestExport = async (kind: CatalogExportKind, raw: unknown): Promise<{ ok: true; jobId: string } | { ok: false; reason: CatalogExportRefusal }> => {
    const parsed = catalogExportFilter.safeParse(raw ?? {})
    if (!parsed.success || !jobPayloadOf(context, storeId)) return { ok: false, reason: 'INVALID_INPUT' }
    const filter = sellerId ? { ...parsed.data, supplier: null } : parsed.data
    const jobId = await inScope(async (tx) => {
      const id = await insertCatalogExport(tx, { storeId, sellerId, kind, filter, byId: actor.id, byLabel: actor.label })
      const payload = jobPayloadOf(context, id)
      if (payload) await queue(tx, payload)
      await activity.record(tx, {
        category: 'write',
        action: catalogExportAudit,
        result: 'success',
        actorKind: 'person',
        actorId: actor.id,
        actorLabel: null,
        partnerId: actor.partnerId,
        storeId,
        sellerId,
        target: { type: 'export', id, label: kind === 'products' ? 'Products' : 'Stock' },
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

  /** An export's state and its file until it expires; null for an id that isn't one the caller can read. */
  const catalogExport = (id: string): Promise<CatalogExportDto | null> => {
    if (!z.guid().safeParse(id).success) return Promise.resolve(null)
    return inScope(async (tx) => {
      const job = await selectCatalogExport(tx, storeId, id)
      return job && job.requested_by_id === actor.id ? dtoOf(job, now()) : null
    })
  }

  /** "Recent exports" (K8): the caller's own, newest first, without their files. */
  const recentExports = (): Promise<CatalogExportDto[]> => inScope(async (tx) => (await selectCatalogExports(tx, storeId, actor.id, 10)).map((j) => dtoOf(j, now())))

  return { requestExport, catalogExport, recentExports }
}

export type CatalogExportService = ReturnType<typeof createCatalogExportService>
