import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { csvLine, parseCsv } from '#core/csv'
import type { TenantContext } from '#core/tenancy'
import { addProductPhoto, selectPricingCurrency, type ProductRow } from '#db/scoped/catalog'
import {
  failImport,
  finishImport,
  insertCatalogImport,
  lockCatalogImport,
  saveImportCheck,
  saveImportPhotos,
  saveImportProgress,
  selectCatalogImport,
  selectCatalogImports,
  selectManualCurrencies,
  selectOwnDefaultWarehouse,
  selectOwnSkus,
  selectOwnWarehouse,
  startImportRun,
  type CatalogImportRow,
  type CatalogImportSummary,
} from '#db/scoped/catalogImports'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { setStockTargets } from '#db/scoped/inventory'
import { selectLanguages } from '#db/scoped/translations'
import { importLimits, planImport, type ImportPlan, type ImportProblem, type PlannedProduct, type ProblemCode } from './importFile'
import { jobPayloadOf } from './jobScope'
import type { ProductInput, VersionInput } from './rules'
import type { SaveResult } from './index'
import type { ProductTranslationInput, TranslationResult } from './translations'

// Import from a spreadsheet (CATALOG K1–K6, K9–K11; FIRST-RELEASE §13): upload, a check that writes nothing,
// confirm with update-or-skip and a location, then the run, all as jobs in the importer's own scope.

export const catalogImportKind = 'import.catalog'
export const importPhotosKind = 'import.photos'
export const catalogImportAudit = { started: 'catalog.import_started', confirmed: 'catalog.imported' } as const
/** The error file is kept for a day after the run (DATA-MODEL §7.10: days, not weeks). */
export const catalogImportLifetimeMs = 24 * 60 * 60 * 1000
const chunkProducts = 25

/** Each problem in plain words (K3), for the screen and the error file. */
export const problemWords: Record<ProblemCode, string> = {
  HANDLE_REQUIRED: 'Give the product a handle or a name.',
  BAD_PRICE: 'Write the price as a number, like 1299.50.',
  BAD_NUMBER: 'Write a whole number of 0 or more.',
  BAD_VISIBLE: 'Write yes or no.',
  BAD_TYPE: 'Write physical, digital, service or gift_card.',
  SKU_IN_FILE: 'Another product in this file has this SKU.',
  ONE_VERSION: 'A product with more than one row needs an option, like Size.',
  UNKNOWN_LANGUAGE: 'This column was left out: the language isn’t one of your store’s.',
  NOT_MANUAL_CURRENCY: 'This column was left out: only currencies you price by hand are imported.',
  SUPPLIER_CURRENCY: 'This column was left out: you price in the store’s currency only.',
  SKIPPED: 'Skipped: a product with this SKU is already here.',
  OPTIONS_DIFFER: 'Its options differ from the product’s. Add every version, or change the options in the editor first.',
  PHOTO_UNAVAILABLE: 'This photo couldn’t be fetched from its address.',
  PHOTO_REFUSED: 'This photo isn’t a JPEG, PNG or WebP of up to 20 MB.',
  NOT_FOUND: 'That product is no longer here.',
  CURRENCY_REQUIRED: 'Set your store’s currency first.',
  SUPPLIER_FIELD: 'Suppliers can’t set this.',
  FILE_REFUSED: 'A file it names isn’t usable.',
  NOT_SHOWABLE: 'This product can’t be shown while it waits for approval.',
  STALE_REVISION: 'Someone changed this product while it was importing. Import it again.',
  PLAN_LIMIT: 'Your plan’s product limit was reached.',
  MATCHES_MANY: 'Its SKUs belong to more than one product here.',
  STOCK_REFUSED: 'Its stock couldn’t be set.',
  TRANSLATION_REFUSED: 'A translation couldn’t be saved.',
  NAME_REQUIRED: 'Give the product a name.',
  INVALID_INPUT: 'Something in this row isn’t valid.',
  CATEGORY_REFUSED: 'Products like this can’t be sold here.',
  TOO_MANY_OPTIONS: 'A product can have up to 3 options.',
  TOO_MANY_VERSIONS: 'A product can have up to 100 versions.',
  OPTION_VALUES_REQUIRED: 'Each option needs a value on every row.',
  DUPLICATE_OPTION: 'Two options have the same name.',
  DUPLICATE_VALUE: 'An option has the same value twice.',
  VERSION_CHOICES: 'Give a value for each option.',
  DUPLICATE_VERSION: 'Two rows have the same option values.',
  VERSION_REQUIRED: 'The product needs at least one row with a price.',
  PRICE_REQUIRED: 'Give a price.',
  INVALID_PRICE: 'The price or compare-at price isn’t valid.',
  INVALID_BARCODE: 'This barcode isn’t a valid EAN, UPC or GTIN.',
  DUPLICATE_SKU: 'This SKU is already used by another of your products.',
  TOO_MANY_PHOTOS: 'A product can have up to 20 photos.',
  INVALID_PHOTO: 'A photo isn’t usable.',
  INVALID_VIDEO: 'The video isn’t usable.',
  INVALID_FILTER: 'A filter value isn’t one of your store’s.',
  INVALID_LISTING: 'Something in the listing isn’t valid.',
  LISTING_REFUSED: 'Something in the listing isn’t allowed.',
}

export type CatalogImportRefusal = 'INVALID_INPUT' | 'FILE_TOO_LARGE' | 'NOT_FOUND' | 'NOT_READY' | 'NOTHING_TO_IMPORT' | 'WAREHOUSE_NOT_FOUND'
export type ImportResult<T> = { ok: true; value: T } | { ok: false; reason: CatalogImportRefusal }

export interface CatalogImportDto {
  id: string
  source: 'csv' | 'shopify'
  state: CatalogImportRow['state'] | 'unreadable'
  products: number
  ready: number
  matched: number
  done: number
  created: number
  updated: number
  skipped: number
  failed: number
  photosPending: number
  problemCount: number
  /** The first problems, in the file's order; the error file has them all. */
  problems: (ImportProblem & { message: string })[]
  problemsCsv: string | null
  requestedAt: Date
  finishedAt: Date | null
}

/** The check's refusal of the whole file, kept in `problems` as line 0 so the screen can say what's wrong. */
type FileRefusal = Exclude<ReturnType<typeof planImport>, ImportPlan>
const fileWords: Record<FileRefusal, string> = {
  UNREADABLE: 'This file can’t be read as a spreadsheet. Save it as CSV and try again.',
  EMPTY: 'This file has no products in it.',
  TOO_MANY_ROWS: `A file can have up to ${importLimits.rows.toLocaleString('en')} rows. Split it and import each part.`,
  TOO_MANY_PRODUCTS: `A file can have up to ${importLimits.products.toLocaleString('en')} products. Split it and import each part.`,
  NO_NAME_COLUMN: 'This file needs a handle or name column. Download the template to see the columns.',
}

const problemList = z.array(z.object({ line: z.number().int(), column: z.string().nullable(), code: z.string() }).loose())
/** In the file's order, whichever job found each. */
const problemsOf = (raw: unknown): ImportProblem[] => ((problemList.safeParse(raw).data ?? []) as ImportProblem[]).toSorted((a, b) => a.line - b.line)
/** A connected import that couldn't read the shop (shopify.ts fetchShopPage). */
const shopWords: Record<string, string> = {
  SHOPIFY_EXPIRED: 'Your Shopify connection has expired. Connect your shop again.',
  NOT_AVAILABLE: 'Connecting Shopify isn’t set up here. Import Shopify’s product CSV instead.',
}
const messageOf = (code: string): string => (problemWords as Record<string, string>)[code] ?? (fileWords as Record<string, string>)[code] ?? shopWords[code] ?? 'This row couldn’t be imported.'

const dtoOf = (job: CatalogImportSummary & { problems?: unknown; problems_csv?: string | null }, shown: number): CatalogImportDto => {
  const problems = problemsOf(job.problems)
  const unreadable = job.state === 'failed' && problems.some((p) => p.line === 0)
  return {
    id: job.id,
    source: job.source,
    state: unreadable ? 'unreadable' : job.state,
    products: job.products,
    ready: job.ready,
    matched: job.matched,
    done: job.done,
    created: job.created,
    updated: job.updated,
    skipped: job.skipped,
    failed: job.failed,
    photosPending: job.photos_pending,
    problemCount: problems.length,
    problems: problems.slice(0, shown).map((p) => ({ ...p, message: messageOf(p.code) })),
    problemsCsv: job.problems_csv ?? null,
    requestedAt: job.created_at,
    finishedAt: job.finished_at,
  }
}

const translationLanguages = async (tx: ScopedSql, storeId: string) => {
  const { main, active } = await selectLanguages(tx, storeId)
  return active.filter((l) => l !== main)
}

/** The template (K1): our columns, the store's own language and currency columns, and one example row. */
export const importTemplate = async (tx: ScopedSql, storeId: string, supplier: boolean): Promise<string> => {
  const languages = await translationLanguages(tx, storeId)
  const currencies = supplier ? [] : await selectManualCurrencies(tx, storeId)
  const header = [
    'handle', 'name', 'description', 'type', ...(supplier ? [] : ['visible']), 'option1 name', 'option1 value', 'option2 name', 'option2 value', 'option3 name', 'option3 value',
    'sku', 'barcode', 'price', 'compare at price', 'cost', 'weight grams', 'stock', 'image', 'image alt',
    ...languages.flatMap((l) => [`name:${l}`, `description:${l}`]), ...currencies.map((c) => `price:${c}`),
  ]
  const example = [
    'cotton-kurta', 'Cotton kurta', 'Handloomed cotton, cut loose for summer.', 'physical', ...(supplier ? [] : ['yes']), 'Size', 'S', '', '', '', '',
    'KURTA-S', '', '1299.00', '', '', '300', '10', '', '', ...languages.flatMap(() => ['', '']), ...currencies.map(() => ''),
  ]
  return [csvLine(header), csvLine(example)].join('\n')
}

export interface CatalogImportDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; label: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
  /** Queues an outbox row in the same transaction. */
  queue: (tx: ScopedSql, kind: string, key: string, payload: Record<string, unknown>) => Promise<unknown>
}

const entryOf = (d: { context: TenantContext; actor: { id: string; partnerId: string }; facts: RequestFacts }) =>
  (action: string, target: { type: string; id: string; label: string }, changes?: ActivityEntry['changes']): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: d.actor.id,
    actorLabel: null,
    partnerId: d.actor.partnerId,
    storeId: d.context.storeId,
    sellerId: d.context.sellerScope.kind === 'seller' ? d.context.sellerScope.sellerId : null,
    target,
    reason: null,
    ...(changes ? { changes } : {}),
    api: 'store',
    visibility: 'store',
    ...d.facts,
  })

export const createCatalogImportService = (d: CatalogImportDeps) => {
  const { sql, context, actor, activity, now, queue } = d
  const { storeId } = context
  const sellerId = context.sellerScope.kind === 'seller' ? context.sellerScope.sellerId : null
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)
  const entry = entryOf(d)
  const mine = <T extends { requested_by_id: string }>(job: T | null): T | null => (job && job.requested_by_id === actor.id ? job : null)

  /** Uploaded and checked after commit; nothing in the catalogue changes until it's confirmed (K2). */
  const start = async (file: string): Promise<ImportResult<string>> => {
    if (new TextEncoder().encode(file).byteLength > importLimits.bytes) return { ok: false, reason: 'FILE_TOO_LARGE' }
    if (file.trim() === '' || !jobPayloadOf(context, storeId)) return { ok: false, reason: 'INVALID_INPUT' }
    const id = await inScope(async (tx) => {
      const made = await insertCatalogImport(tx, { storeId, sellerId, source: 'csv', file, byId: actor.id, byLabel: actor.label })
      const payload = jobPayloadOf(context, made)
      if (payload) await queue(tx, catalogImportKind, `${made}:check`, { ...payload, phase: 'check' })
      await activity.record(tx, entry(catalogImportAudit.started, { type: 'import', id: made, label: 'Products' }))
      return made
    })
    return { ok: true, value: id }
  }

  /** "Import" (K4, K5): update or skip what matches by SKU, counts into the chosen location or the default. */
  const confirm = (id: string, matchMode: 'update' | 'skip', warehouseId: string | null): Promise<ImportResult<true>> => {
    if (!z.guid().safeParse(id).success || (warehouseId !== null && !z.guid().safeParse(warehouseId).success)) return Promise.resolve({ ok: false, reason: 'NOT_FOUND' })
    return inScope(async (tx) => {
      const job = mine(await lockCatalogImport(tx, storeId, id))
      if (!job) return { ok: false, reason: 'NOT_FOUND' }
      if (job.state !== 'ready') return { ok: false, reason: 'NOT_READY' }
      if (job.ready === 0) return { ok: false, reason: 'NOTHING_TO_IMPORT' }
      const location = warehouseId === null ? await selectOwnDefaultWarehouse(tx, storeId, sellerId) : await selectOwnWarehouse(tx, storeId, sellerId, warehouseId)
      if (warehouseId !== null && !location) return { ok: false, reason: 'WAREHOUSE_NOT_FOUND' }
      if (!(await startImportRun(tx, id, { matchMode, warehouseId: location, at: now() }))) return { ok: false, reason: 'NOT_READY' }
      const payload = jobPayloadOf(context, id)
      if (payload) await queue(tx, catalogImportKind, `${id}:run:0`, { ...payload, phase: 'run' })
      await activity.record(tx, entry(catalogImportAudit.confirmed, { type: 'import', id, label: 'Products' }, [{ field: 'products', before: null, after: String(job.ready) }, { field: 'matching', before: null, after: matchMode }]))
      return { ok: true, value: true }
    })
  }

  const catalogImport = (id: string): Promise<CatalogImportDto | null> => {
    if (!z.guid().safeParse(id).success) return Promise.resolve(null)
    return inScope(async (tx) => {
      const job = mine(await selectCatalogImport(tx, storeId, id))
      return job ? dtoOf(job, 100) : null
    })
  }

  /** The asker's recent imports, newest first, for the shell's banner and the screen's history. */
  const recent = (): Promise<CatalogImportDto[]> => inScope(async (tx) => (await selectCatalogImports(tx, storeId, actor.id, 10)).map((j) => dtoOf(j, 0)))

  const template = (): Promise<string> => inScope((tx) => importTemplate(tx, storeId, sellerId !== null))

  return { start, confirm, catalogImport, recent, template }
}

export type CatalogImportService = ReturnType<typeof createCatalogImportService>

/** What a run needs of the catalogue and translations, made by the job in the importer's scope. */
export interface ImportJobDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
  catalog: {
    create: (input: ProductInput) => Promise<SaveResult>
    update: (id: string, revision: number, input: ProductInput) => Promise<SaveResult>
    get: (id: string) => Promise<{ product: ProductRow | null }>
  }
  saveTranslation: (productId: string, language: string, input: ProductTranslationInput) => Promise<TranslationResult<unknown>>
  queue: CatalogImportDeps['queue']
}

/** The check (K2, K3): the file read as products, each checked as a save would be, and what matches by SKU. */
export const checkImport = async (d: ImportJobDeps, jobId: string): Promise<void> => {
  const { storeId } = d.context
  const sellerId = d.context.sellerScope.kind === 'seller' ? d.context.sellerScope.sellerId : null
  await withScope(d.sql, d.context, async (tx) => {
    const job = await selectCatalogImport(tx, storeId, jobId)
    if (job?.state !== 'checking' || job.file === null) return
    const at = d.now()
    const plan = planImport(job.file, {
      currency: (await selectPricingCurrency(tx)) ?? 'USD',
      languages: await translationLanguages(tx, storeId),
      // A supplier prices in the pricing currency only (O14), and doesn't read the store's currencies.
      manualCurrencies: sellerId === null ? await selectManualCurrencies(tx, storeId) : [],
      supplier: sellerId !== null,
    })
    if (typeof plan === 'string') {
      await saveImportCheck(tx, jobId, { source: 'csv', plan: null, products: 0, ready: 0, matched: 0, problems: [{ line: 0, column: null, code: plan }] })
      await failImport(tx, jobId, at, new Date(at.getTime() + catalogImportLifetimeMs))
      return
    }
    const owned = new Set((await selectOwnSkus(tx, storeId, sellerId, plan.products.flatMap(skusOf))).map((r) => r.sku))
    const matched = plan.products.filter((p) => skusOf(p).some((s) => owned.has(s.toLowerCase()))).length
    await saveImportCheck(tx, jobId, { source: plan.source, plan, products: plan.products.length + plan.refused, ready: plan.products.length, matched, problems: plan.problems })
  })
}

const skusOf = (p: PlannedProduct): string[] => p.input.versions.flatMap((v) => (v.sku ? [v.sku] : []))

/** The product as the file has it, onto what's there: versions matched by SKU, the rest kept as they are (K4). */
export const mergeForUpdate = (planned: ProductInput, existing: ProductRow): ProductInput | 'OPTIONS_DIFFER' => {
  const bySku = new Map(existing.versions.flatMap((v) => (v.sku ? [[v.sku.toLowerCase(), v] as const] : [])))
  const matched = new Set(planned.versions.flatMap((v) => (v.sku ? [bySku.get(v.sku.toLowerCase())?.id ?? ''] : [])))
  const kept = existing.versions.filter((v) => !matched.has(v.id))
  const names = (list: readonly { name: string }[]) => list.map((o) => o.name.toLowerCase()).join('|')
  if (kept.length > 0 && names(planned.options) !== names(existing.options)) return 'OPTIONS_DIFFER'
  const valueName = (optionId: string, valueId: string) => existing.options.find((o) => o.id === optionId)?.values.find((v) => v.id === valueId)?.name ?? ''
  const keptVersions: VersionInput[] = kept.map((v) => ({
    id: v.id,
    choices: existing.options.map((o) => valueName(o.id, v.choices[o.id] ?? '')),
    sku: v.sku,
    barcode: v.barcode,
    name: v.name,
    visible: v.visibility === 'visible',
    prices: v.prices.map((p) => ({ currency: p.currency.trim(), amount: p.amount, compareAtAmount: p.compare_at_amount })),
    cost: v.cost_amount && v.cost_currency ? { amount: v.cost_amount, currency: v.cost_currency.trim() } : null,
    weightGrams: v.weight_grams,
    lengthMm: v.length_mm,
    widthMm: v.width_mm,
    heightMm: v.height_mm,
    hsCode: v.hs_code,
    customsDescription: v.customs_description,
    trackStock: v.track_stock,
    continueSelling: v.continue_selling,
  }))
  const versions: VersionInput[] = [
    ...planned.versions.map((v) => {
      const before = v.sku ? bySku.get(v.sku.toLowerCase()) : undefined
      // A currency the file doesn't name keeps the price it has, converted ones included.
      const others = (before?.prices ?? []).filter((p) => !v.prices.some((x) => x.currency === p.currency.trim())).map((p) => ({ currency: p.currency.trim(), amount: p.amount, compareAtAmount: p.compare_at_amount }))
      return { ...v, id: before?.id ?? null, prices: [...v.prices, ...others] }
    }),
    ...keptVersions,
  ]
  const options = planned.options.map((o, n) => {
    const before = existing.options.find((e) => e.name.toLowerCase() === o.name.toLowerCase())
    const values = new Map(o.values.map((v) => [v.name.toLowerCase(), v.name]))
    for (const v of keptVersions) {
      const name = v.choices[n]
      if (name) values.set(name.toLowerCase(), values.get(name.toLowerCase()) ?? name)
    }
    return {
      id: before?.id ?? null,
      name: o.name,
      values: [...values.values()].map((name) => ({ id: before?.values.find((x) => x.name.toLowerCase() === name.toLowerCase())?.id ?? null, name })),
    }
  })
  // The web address stays as it is: a file's handle never moves a live product's links.
  return { ...planned, slug: undefined, options, versions }
}

type Outcome = { kind: 'created' | 'updated'; id: string } | { kind: 'skipped' } | { kind: 'failed'; code: ProblemCode }

const importOne = async (d: ImportJobDeps, job: CatalogImportRow, p: PlannedProduct): Promise<Outcome> => {
  const { storeId } = d.context
  const sellerId = d.context.sellerScope.kind === 'seller' ? d.context.sellerScope.sellerId : null
  const matches = [...new Set((await withScope(d.sql, d.context, (tx) => selectOwnSkus(tx, storeId, sellerId, skusOf(p)))).map((r) => r.product_id))]
  if (matches.length > 1) return { kind: 'failed', code: 'MATCHES_MANY' }
  const [existingId] = matches
  if (existingId && job.match_mode === 'skip') return { kind: 'skipped' }
  let saved: SaveResult
  if (existingId) {
    const { product } = await d.catalog.get(existingId)
    if (!product) return { kind: 'failed', code: 'NOT_FOUND' }
    const merged = mergeForUpdate(p.input, product)
    if (merged === 'OPTIONS_DIFFER') return { kind: 'failed', code: merged }
    saved = await d.catalog.update(existingId, product.revision, merged)
  } else saved = await d.catalog.create(p.input)
  if (!saved.ok) return { kind: 'failed', code: saved.reason }
  return { kind: existingId ? 'updated' : 'created', id: saved.id }
}

/** Counts into the chosen location, a movement each marked `import`; versions by their place, as saved. */
const importStock = async (d: ImportJobDeps, job: CatalogImportRow, p: PlannedProduct, productId: string): Promise<boolean> => {
  if (p.stock.every((s) => s === null)) return true
  if (!job.warehouse_id) return false
  const warehouseId = job.warehouse_id
  const { product } = await d.catalog.get(productId)
  const versions = [...(product?.versions ?? [])].sort((a, b) => a.position - b.position)
  const entries = p.stock.flatMap((target, i) => {
    const version = versions[i]
    return target === null || !version ? [] : [{ versionId: version.id, warehouseId, target }]
  })
  const entry = entryOf(d)
  try {
    await withScope(d.sql, d.context, async (tx) => {
      const done = await setStockTargets(tx, entries, 'import')
      await d.activity.recordAll(tx, done.filter((x) => x.change !== 0).map((x) => entry('stock.adjusted', { type: 'product_version', id: x.version_id, label: `import ${x.change > 0 ? '+' : ''}${x.change} → ${x.quantity} at ${x.warehouse_id}` })))
    })
    return true
  } catch {
    return false
  }
}

const finishIfDone = async (tx: ScopedSql, storeId: string, jobId: string, at: Date): Promise<void> => {
  const job = await lockCatalogImport(tx, storeId, jobId)
  const plan = job?.plan as ImportPlan | null | undefined
  if (!job || job.state !== 'running' || !plan || job.done < plan.products.length || job.photos_pending > 0) return
  await finishImport(tx, jobId, { problemsCsv: problemsCsv(job.file, plan, problemsOf(job.problems)), at, expiresAt: new Date(at.getTime() + catalogImportLifetimeMs) })
}

/** The error file (K3): the file's own rows that had a problem, each product's rows together, with a problem column. */
export const problemsCsv = (file: string | null, plan: ImportPlan, problems: readonly ImportProblem[]): string | null => {
  if (problems.length === 0 || file === null) return null
  const table = parseCsv(file) ?? []
  const said = new Map<number, string[]>()
  for (const p of problems) said.set(p.line, [...(said.get(p.line) ?? []), p.column ? `${p.column}: ${messageOf(p.code)}` : messageOf(p.code)])
  const lines = new Set(plan.refusedLines)
  for (const p of problems) {
    if (p.line < 2) continue
    const product = plan.products.find((x) => x.lines.includes(p.line))
    for (const l of product?.lines ?? [p.line]) lines.add(l)
  }
  const header = table[0] ?? []
  const fileWide = said.get(1)
  return [
    csvLine([...header, 'problem']),
    ...(fileWide ? [csvLine([...header.map(() => ''), fileWide.join(' ')])] : []),
    ...[...lines].sort((a, b) => a - b).map((l) => csvLine([...(table[l - 1] ?? []), (said.get(l) ?? []).join(' ')])),
  ].join('\n')
}

/** A chunk of the run (K6): products in the file's order from where the last chunk stopped, then the next chunk. */
export const runImportChunk = async (d: ImportJobDeps, jobId: string, budgetMs: number): Promise<void> => {
  const { storeId } = d.context
  const started = Date.now()
  const job = await withScope(d.sql, d.context, (tx) => selectCatalogImport(tx, storeId, jobId))
  const plan = job?.plan as ImportPlan | null | undefined
  if (!job || job.state !== 'running' || !plan) return
  const counts = { created: 0, updated: 0, skipped: 0, failed: 0 }
  const problems: ImportProblem[] = []
  const photos: { productId: string; line: number; position: number; url: string; alt: string | null }[] = []
  let at = job.done
  while (at < plan.products.length && at - job.done < chunkProducts && Date.now() - started < budgetMs) {
    const p = plan.products[at]
    at++
    if (!p) continue
    const line = p.lines[0] ?? 0
    const outcome = await importOne(d, job, p)
    if (outcome.kind === 'failed') {
      counts.failed++
      problems.push({ line, column: null, code: outcome.code })
      continue
    }
    if (outcome.kind === 'skipped') {
      counts.skipped++
      continue
    }
    counts[outcome.kind]++
    if (!(await importStock(d, job, p, outcome.id))) problems.push({ line, column: null, code: 'STOCK_REFUSED' })
    for (const [language, text] of Object.entries(p.translations)) {
      const saved = await d.saveTranslation(outcome.id, language, text)
      if (!saved.ok) problems.push({ line, column: `name:${language}`, code: 'TRANSLATION_REFUSED' })
    }
    // Photos for a product the import made; one that was there keeps its own (and its approval, ACCESS §7.2).
    if (outcome.kind === 'created') photos.push(...p.photos.map((photo, position) => ({ productId: outcome.id, position, ...photo })))
  }
  await withScope(d.sql, d.context, async (tx) => {
    await saveImportProgress(tx, jobId, { done: at, ...counts, photos: photos.length, problems })
    const payload = jobPayloadOf(d.context, jobId)
    if (!payload) return
    for (const p of photos) await d.queue(tx, importPhotosKind, `${jobId}:photo:${p.productId}:${p.position}`, { ...payload, ...p })
    if (at < plan.products.length) await d.queue(tx, catalogImportKind, `${jobId}:run:${at}`, { ...payload, phase: 'run' })
    else await finishIfDone(tx, storeId, jobId, d.now())
  })
}

export const importPhotoPayload = z.object({
  productId: z.guid(),
  line: z.number().int(),
  position: z.number().int().min(0).max(19),
  url: z.string().max(2048),
  alt: z.string().max(500).nullable(),
})

export type PhotoFetch = (url: string) => Promise<{ ok: true; assetId: string } | { ok: false; code: 'PHOTO_UNAVAILABLE' | 'PHOTO_REFUSED' }>

/** One of a made product's photos, fetched and stored as the importer's file at its place; one that fails is reported (K6). */
export const attachImportPhoto = async (d: ImportJobDeps, jobId: string, photo: z.infer<typeof importPhotoPayload>, fetchPhoto: PhotoFetch): Promise<void> => {
  const { storeId } = d.context
  const result = await fetchPhoto(photo.url)
  await withScope(d.sql, d.context, async (tx) => {
    const job = await lockCatalogImport(tx, storeId, jobId)
    if (job?.state !== 'running') return
    if (result.ok) await addProductPhoto(tx, storeId, photo.productId, { assetId: result.assetId, alt: photo.alt, position: photo.position })
    await saveImportPhotos(tx, jobId, result.ok ? [] : [{ line: photo.line, column: 'image', code: result.code }])
    await finishIfDone(tx, storeId, jobId, d.now())
  })
}

/** After the last attempt: the job says failed, so the banner stops waiting. */
export const failCatalogImport = (d: Pick<ImportJobDeps, 'sql' | 'context' | 'now'>, jobId: string): Promise<void> =>
  withScope(d.sql, d.context, (tx) => failImport(tx, jobId, d.now(), new Date(d.now().getTime() + catalogImportLifetimeMs)))
