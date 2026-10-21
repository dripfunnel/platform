import type postgres from 'postgres'
import type { PageWindow } from '#core/paging'
import type { ScopedSql } from './index'

// Settings › Catalogue, size charts and a product's listing sections (DATA-MODEL §7.2–7.3, migration 0044).
// Rows go as one jsonb parameter, read with jsonb_to_recordset, as in catalog.ts.

const rowsOf = (tx: ScopedSql, rows: readonly unknown[]) => tx.json(rows as unknown as postgres.JSONValue)

export const featureKeys = ['sizeCharts', 'specs', 'highlights', 'faqs', 'badges', 'related', 'aplus', 'video'] as const
export type FeatureKey = (typeof featureKeys)[number]

/** A store that has never chosen gets the prototype's starting set (CatSettings). */
export const defaultFeatures: Readonly<Record<FeatureKey, boolean>> = { sizeCharts: true, specs: true, highlights: true, faqs: false, badges: true, related: false, aplus: true, video: false }

export const selectFeatures = async (tx: ScopedSql, storeId: string): Promise<Record<FeatureKey, boolean>> => {
  const rows = await tx<{ key: FeatureKey; enabled: boolean }[]>`select key, enabled from store_feature where store_id = ${storeId}`
  return { ...defaultFeatures, ...Object.fromEntries(rows.map((r) => [r.key, r.enabled])) }
}

export const setFeatures = async (tx: ScopedSql, storeId: string, features: readonly { key: FeatureKey; enabled: boolean }[], now: Date): Promise<void> => {
  if (features.length === 0) return
  await tx`
    insert into store_feature (store_id, key, enabled, updated_at)
    select ${storeId}, x.key, x.enabled, ${now} from jsonb_to_recordset(${rowsOf(tx, features)}) as x(key text, enabled boolean)
    on conflict (store_id, key) do update set enabled = excluded.enabled, updated_at = excluded.updated_at
  `
}

export interface BadgeRow {
  id: string
  label: string
  tone: 'ok' | 'peach' | 'neutral'
  rule: 'new_30_days' | 'top_5_this_month' | 'below_compare_price' | 'few_left' | 'manual'
  position: number
}

export const maxBadges = 20

export const selectBadges = (tx: ScopedSql, storeId: string): Promise<BadgeRow[]> =>
  tx<BadgeRow[]>`select id, label, tone, rule, position from badge where store_id = ${storeId} order by position, created_at limit ${maxBadges}`

/** One owner's charts: the cap is per owner, since a supplier's count must say nothing of others' (ACCESS §7.1). */
export const countSizeCharts = async (tx: ScopedSql, storeId: string, sellerId: string | null): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from size_chart where store_id = ${storeId} and seller_id is not distinct from ${sellerId}::uuid and deleted_at is null`)[0]?.n ?? 0

export const countBadges = async (tx: ScopedSql, storeId: string): Promise<number> => (await tx<{ n: number }[]>`select count(*)::int as n from badge where store_id = ${storeId}`)[0]?.n ?? 0

export const upsertBadge = async (tx: ScopedSql, storeId: string, badge: BadgeRow, exists: boolean): Promise<boolean> => {
  if (exists) {
    const done = (await tx`update badge set label = ${badge.label}, tone = ${badge.tone}, rule = ${badge.rule}, position = ${badge.position} where id = ${badge.id} and store_id = ${storeId}`).count === 1
    // Only a manual badge is picked on a product (S5): one that becomes automatic shows by its rule instead.
    if (done && badge.rule !== 'manual') await tx`delete from product_badge where badge_id = ${badge.id} and store_id = ${storeId}`
    return done
  }
  await tx`insert into badge (id, store_id, label, tone, rule, position) values (${badge.id}, ${storeId}, ${badge.label}, ${badge.tone}, ${badge.rule}, ${badge.position})`
  return true
}

export const deleteBadge = async (tx: ScopedSql, storeId: string, id: string): Promise<string | null> =>
  (await tx<{ label: string }[]>`delete from badge where id = ${id} and store_id = ${storeId} returning label`)[0]?.label ?? null

export interface SizeChartRow {
  id: string
  seller_id: string | null
  name: string
  unit: 'cm' | 'in'
  systems: string[]
  measurements: string[]
  rows: { size: string; values: string[] }[]
  how_to_measure: { measurement: string; text: string }[]
  fit_notes: string | null
  model_info: string | null
  revision: number
  updated_at: Date
  /** Products using it, in the caller's scope. */
  products: number
}

export const maxSizeCharts = 200

export interface SizeChartSummaryRow {
  id: string
  seller_id: string | null
  name: string
  unit: 'cm' | 'in'
  updated_at: Date
  products: number
}

/** A page of the store's charts in the caller's scope, newest edit first; the rows themselves come with one chart. */
export const selectSizeCharts = (tx: ScopedSql, storeId: string, window: PageWindow): Promise<SizeChartSummaryRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<SizeChartSummaryRow[]>`
    select c.id, c.seller_id, c.name, c.unit, c.updated_at,
      (select count(*)::int from product p where p.size_chart_id = c.id and p.deleted_at is null) as products
    from size_chart c where c.store_id = ${storeId} and c.deleted_at is null
      and ${window.after ? tx`(c.updated_at, c.id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(c.updated_at, c.id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by c.updated_at ${backwards ? tx`asc` : tx`desc`}, c.id ${backwards ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `
}

export const selectSizeChart = async (tx: ScopedSql, storeId: string, id: string): Promise<SizeChartRow | null> =>
  (
    await tx<SizeChartRow[]>`
      select c.id, c.seller_id, c.name, c.unit, c.systems, c.measurements, c.rows, c.how_to_measure, c.fit_notes, c.model_info, c.revision, c.updated_at,
        (select count(*)::int from product p where p.size_chart_id = c.id and p.deleted_at is null) as products
      from size_chart c where c.id = ${id} and c.store_id = ${storeId} and c.deleted_at is null
    `
  )[0] ?? null

export interface SizeChartFields {
  name: string
  unit: 'cm' | 'in'
  systems: string[]
  measurements: string[]
  rows: { size: string; values: string[] }[]
  howToMeasure: { measurement: string; text: string }[]
  fitNotes: string | null
  modelInfo: string | null
}

export const insertSizeChart = async (tx: ScopedSql, storeId: string, sellerId: string | null, id: string, f: SizeChartFields): Promise<void> => {
  await tx`
    insert into size_chart (id, store_id, seller_id, name, unit, systems, measurements, rows, how_to_measure, fit_notes, model_info)
    values (${id}, ${storeId}, ${sellerId}, ${f.name}, ${f.unit}, ${rowsOf(tx, f.systems)}, ${rowsOf(tx, f.measurements)}, ${rowsOf(tx, f.rows)}, ${rowsOf(tx, f.howToMeasure)}, ${f.fitNotes}, ${f.modelInfo})
  `
}

/** At the revision the editor read; false when it was stale or isn't the caller's. */
export const updateSizeChart = async (tx: ScopedSql, storeId: string, id: string, revision: number, f: SizeChartFields, now: Date): Promise<boolean> =>
  (
    await tx`
      update size_chart set name = ${f.name}, unit = ${f.unit}, systems = ${rowsOf(tx, f.systems)}, measurements = ${rowsOf(tx, f.measurements)}, rows = ${rowsOf(tx, f.rows)},
        how_to_measure = ${rowsOf(tx, f.howToMeasure)}, fit_notes = ${f.fitNotes}, model_info = ${f.modelInfo}, updated_at = ${now}, revision = revision + 1
      where id = ${id} and store_id = ${storeId} and revision = ${revision} and deleted_at is null
    `
  ).count === 1

/** Soft delete (§7.1): the products using it lose it, which the editor said before deleting (R10). */
export const softDeleteSizeChart = async (tx: ScopedSql, storeId: string, id: string, now: Date): Promise<{ name: string; products: number } | null> => {
  // Every link clears, a trashed product's too, but the answer counts live ones, as the editor's count did.
  const freed = await tx<{ live: boolean }[]>`update product set size_chart_id = null, updated_at = ${now} where store_id = ${storeId} and size_chart_id = ${id} returning deleted_at is null as live`
  const [gone] = await tx<{ name: string }[]>`update size_chart set deleted_at = ${now}, updated_at = ${now} where id = ${id} and store_id = ${storeId} and deleted_at is null returning name`
  return gone ? { name: gone.name, products: freed.filter((f) => f.live).length } : null
}

export interface ListingWrite {
  specs?: { name: string; value: string; versionId: string | null; filterValueId: string | null }[]
  highlights?: string[]
  faqs?: { question: string; answer: string }[]
  related?: string[]
  badgeIds?: string[]
  flags?: { ageRestricted: boolean | null; hazardous: boolean | null }
  compliance?: { region: string; field: string; value: string }[]
  /** Null removes the rule; absent keeps it. */
  marketRule?: { mode: 'only' | 'except'; countries: string[] } | null
}

/** The sections given, each replacing what the product had, one statement each; a section left out stays. */
export const setProductListing = async (tx: ScopedSql, storeId: string, productId: string, l: ListingWrite): Promise<void> => {
  const positioned = <T extends object>(rows: readonly T[]) => rows.map((r, position) => ({ ...r, position }))
  if (l.specs) {
    await tx`delete from product_spec where product_id = ${productId}`
    if (l.specs.length > 0) {
      await tx`
        insert into product_spec (product_id, version_id, store_id, name, value, filter_value_id, position)
        select ${productId}, x."versionId", ${storeId}, x.name, x.value, x."filterValueId", x.position
        from jsonb_to_recordset(${rowsOf(tx, positioned(l.specs))}) as x("versionId" uuid, name text, value text, "filterValueId" uuid, position int)
      `
    }
  }
  if (l.highlights) {
    await tx`delete from product_highlight where product_id = ${productId}`
    if (l.highlights.length > 0) {
      await tx`
        insert into product_highlight (product_id, store_id, text, position)
        select ${productId}, ${storeId}, x.text, x.position from jsonb_to_recordset(${rowsOf(tx, positioned(l.highlights.map((text) => ({ text }))))}) as x(text text, position int)
      `
    }
  }
  if (l.faqs) {
    await tx`delete from product_faq where product_id = ${productId}`
    if (l.faqs.length > 0) {
      await tx`
        insert into product_faq (product_id, store_id, question, answer, position)
        select ${productId}, ${storeId}, x.question, x.answer, x.position from jsonb_to_recordset(${rowsOf(tx, positioned(l.faqs))}) as x(question text, answer text, position int)
      `
    }
  }
  if (l.related) {
    await tx`delete from product_related where product_id = ${productId}`
    if (l.related.length > 0) {
      await tx`
        insert into product_related (product_id, related_product_id, store_id, position)
        select ${productId}, x.id, ${storeId}, x.position from jsonb_to_recordset(${rowsOf(tx, positioned(l.related.map((id) => ({ id }))))}) as x(id uuid, position int)
      `
    }
  }
  if (l.badgeIds) {
    await tx`delete from product_badge where product_id = ${productId}`
    if (l.badgeIds.length > 0) {
      await tx`insert into product_badge (product_id, badge_id, store_id) select ${productId}, x.id, ${storeId} from jsonb_to_recordset(${rowsOf(tx, l.badgeIds.map((id) => ({ id })))}) as x(id uuid)`
    }
  }
  if (l.flags) {
    await tx`
      insert into product_flag (product_id, store_id, age_restricted, hazardous)
      values (${productId}, ${storeId}, coalesce(${l.flags.ageRestricted}::boolean, false), coalesce(${l.flags.hazardous}::boolean, false))
      on conflict (product_id) do update set age_restricted = coalesce(${l.flags.ageRestricted}::boolean, product_flag.age_restricted),
        hazardous = coalesce(${l.flags.hazardous}::boolean, product_flag.hazardous)
    `
  }
  if (l.compliance) {
    await tx`delete from product_compliance where product_id = ${productId}`
    if (l.compliance.length > 0) {
      await tx`
        insert into product_compliance (product_id, store_id, region, field, value)
        select ${productId}, ${storeId}, x.region, x.field, x.value from jsonb_to_recordset(${rowsOf(tx, l.compliance)}) as x(region text, field text, value text)
      `
    }
  }
  if (l.marketRule !== undefined) {
    await tx`delete from product_market_rule where product_id = ${productId}`
    if (l.marketRule) await tx`insert into product_market_rule (product_id, store_id, mode, countries) values (${productId}, ${storeId}, ${l.marketRule.mode}, ${rowsOf(tx, l.marketRule.countries)})`
  }
}

export const setProductSizeChart = async (tx: ScopedSql, storeId: string, productId: string, sizeChartId: string | null): Promise<void> => {
  await tx`update product set size_chart_id = ${sizeChartId} where id = ${productId} and store_id = ${storeId} and size_chart_id is distinct from ${sizeChartId}`
}

/** A listing write naming something the caller can't use (migration 0044's triggers). */
export const listingRefused = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' && /catalogue: (no such product to relate|only a manual badge|no such size chart)/.test(error.message)
