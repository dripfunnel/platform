import { pgArray, type ScopedSql } from './index'

// Store categories (DATA-MODEL §7.2): platform data staff keep; every scope reads it, a store picks one through
// 0403's definer.

export const sectionKeys = ['sizeCharts', 'specs', 'highlights', 'faqs', 'badges', 'related', 'aplus', 'video'] as const
export type SectionKey = (typeof sectionKeys)[number]

export interface StoreCategoryRow {
  id: string
  key: string
  names: Record<string, string>
  sections: SectionKey[]
  position: number
  archived_at: Date | null
}

export interface StaffCategoryRow extends StoreCategoryRow {
  /** Stores that chose it, for the archive's consequence. */
  store_count: number
  /** DripFunnel ships built-in sample data for it (0401). */
  has_default_sample: boolean
}

// The Worker's client doesn't parse arrays (pgArray above), so they come back as JSON.
const columns = 'id, key, names, to_jsonb(sections) as sections, position, archived_at'

/** Every category, archived ones last, each with how many stores use it. At most a few dozen, so not paged. */
/** The list is one page by design, capped here and at creation (DATA-MODEL §7.2). */
export const maxStoreCategories = 100

export const selectCategoriesForStaff = async (tx: ScopedSql, onlyId: string | null = null): Promise<StaffCategoryRow[]> =>
  tx<StaffCategoryRow[]>`
    select ${tx.unsafe(columns)}, (select count(*)::int from store s where s.category_id = c.id) as store_count,
      exists (select 1 from store_category_default_sample d where d.category_id = c.id) as has_default_sample
    from store_category c
    ${onlyId === null ? tx`` : tx`where c.id = ${onlyId}`}
    order by archived_at is not null, position, id
    limit ${maxStoreCategories}
  `

export const countCategories = async (tx: ScopedSql): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from store_category`)[0]?.n ?? 0

export const selectCategory = async (tx: ScopedSql, id: string): Promise<StoreCategoryRow | null> =>
  (await tx<StoreCategoryRow[]>`select ${tx.unsafe(columns)} from store_category where id = ${id}`)[0] ?? null

export const keyTaken = async (tx: ScopedSql, key: string): Promise<boolean> =>
  (await tx`select 1 from store_category where key = ${key}`).length > 0

export interface CategoryInput {
  names: Record<string, string>
  sections: readonly SectionKey[]
}

export const insertCategory = async (tx: ScopedSql, key: string, input: CategoryInput): Promise<StoreCategoryRow> => {
  const [row] = await tx<StoreCategoryRow[]>`
    insert into store_category (key, names, sections, position)
    values (${key}, ${tx.json(input.names)}::jsonb, ${pgArray([...input.sections])}::text[],
      (select coalesce(max(position), 0) + 1 from store_category))
    returning ${tx.unsafe(columns)}
  `
  if (!row) throw new Error('insertCategory: no row')
  return row
}

export const updateCategory = async (tx: ScopedSql, id: string, input: CategoryInput): Promise<StoreCategoryRow | null> =>
  (await tx<StoreCategoryRow[]>`
    update store_category set names = ${tx.json(input.names)}::jsonb, sections = ${pgArray([...input.sections])}::text[], updated_at = now()
    where id = ${id}
    returning ${tx.unsafe(columns)}
  `)[0] ?? null

export const setCategoryArchived = async (tx: ScopedSql, id: string, archived: boolean, now: Date): Promise<StoreCategoryRow | null> =>
  (await tx<StoreCategoryRow[]>`
    update store_category set archived_at = ${archived ? now : null}, updated_at = now()
    where id = ${id}
    returning ${tx.unsafe(columns)}
  `)[0] ?? null

/** The filter's choices on the Partner console's Stores list: every category, by English name, archived ones too. */
export const selectCategoryChoices = async (tx: ScopedSql): Promise<{ id: string; name: string }[]> =>
  tx<{ id: string; name: string }[]>`select id, names ->> 'en' as name from store_category order by archived_at is not null, position, id`

/** The picker: active categories, plus the store's own when it has since been archived. */
export const selectCategoriesForStore = async (tx: ScopedSql, storeId: string): Promise<StoreCategoryRow[]> =>
  tx<StoreCategoryRow[]>`
    select ${tx.unsafe(columns)} from store_category
    where archived_at is null or id = (select category_id from store where id = ${storeId})
    order by position, id
  `

export const selectStoreCategoryId = async (tx: ScopedSql, storeId: string): Promise<string | null> =>
  (await tx<{ category_id: string | null }[]>`select category_id from store where id = ${storeId}`)[0]?.category_id ?? null

/** Through 0403's definer: the merchant side of a store, never a supplier or a read-only support session. */
export const setStoreCategory = async (tx: ScopedSql, categoryId: string): Promise<void> => {
  await tx`select set_store_category(${categoryId})`
}

export interface SampleCollection {
  name: string
  skus: string[]
}

export interface CategorySampleRow {
  category_id: string
  file: string
  currency: string
  collections: SampleCollection[]
  /** {url: R2 key}, each photo copied once at upload (0404). */
  photos: Record<string, string>
  uploaded_at: Date
}

export type CategorySampleSummary = Omit<CategorySampleRow, 'file'>

/** Every category's sample: the staff list shows what each holds, its file only to count the products. */
export const selectSampleSummaries = async (tx: ScopedSql, onlyId: string | null = null): Promise<(CategorySampleSummary & { file: string })[]> =>
  tx<(CategorySampleSummary & { file: string })[]>`
    select category_id, file, currency::text as currency, collections, photos, uploaded_at from store_category_sample
    ${onlyId === null ? tx`` : tx`where category_id = ${onlyId}`}
  `

/** Which categories have a sample, without reading the files: the merchant's picker asks on every load. */
export const selectSampleCategoryIds = async (tx: ScopedSql): Promise<string[]> =>
  (await tx<{ category_id: string }[]>`select category_id from store_category_sample`).map((r) => r.category_id)

export const sampleExists = async (tx: ScopedSql, categoryId: string): Promise<boolean> =>
  (await tx`select 1 from store_category_sample where category_id = ${categoryId}`).length > 0

/** DripFunnel's built-in sample for a category (0401), which staff add as its sample with one click. */
export const selectDefaultSample = async (tx: ScopedSql, categoryId: string): Promise<{ file: string; currency: string } | null> =>
  (await tx<{ file: string; currency: string }[]>`select file, currency::text as currency from store_category_default_sample where category_id = ${categoryId}`)[0] ?? null

export const selectSample = async (tx: ScopedSql, categoryId: string): Promise<CategorySampleRow | null> =>
  (await tx<CategorySampleRow[]>`select category_id, file, currency::text as currency, collections, photos, uploaded_at from store_category_sample where category_id = ${categoryId}`)[0] ?? null

export const upsertSample = async (tx: ScopedSql, s: Omit<CategorySampleRow, 'uploaded_at'> & { uploadedBy: string }, now: Date): Promise<void> => {
  await tx`
    insert into store_category_sample (category_id, file, currency, collections, photos, uploaded_by, uploaded_at)
    values (${s.category_id}, ${s.file}, ${s.currency}, ${tx.json(s.collections as unknown as Parameters<typeof tx.json>[0])}::jsonb,
      ${tx.json(s.photos)}::jsonb, ${s.uploadedBy}, ${now})
    on conflict (category_id) do update set file = excluded.file, currency = excluded.currency, collections = excluded.collections,
      photos = excluded.photos, uploaded_by = excluded.uploaded_by, uploaded_at = excluded.uploaded_at
  `
}

export const deleteSample = async (tx: ScopedSql, categoryId: string): Promise<boolean> =>
  (await tx`delete from store_category_sample where category_id = ${categoryId} returning category_id`).length > 0

export interface SampleStanding {
  category_id: string | null
  has_order: boolean
  /** The sample finished importing once (store.sample_catalog_added_at), or one is on its way now. */
  added: boolean
}

/** What "Add sample catalog" checks: the store's category, any order, and a sample already added or on its way. */
export const selectSampleStanding = async (tx: ScopedSql, storeId: string): Promise<SampleStanding | null> =>
  (
    await tx<SampleStanding[]>`
      select s.category_id,
        exists (select 1 from "order" o where o.store_id = s.id) as has_order,
        s.sample_catalog_added_at is not null
          or exists (select 1 from catalog_import i where i.store_id = s.id and i.sample_category_id is not null and i.state in ('checking', 'ready', 'running')) as added
      from store s where s.id = ${storeId}
    `
  )[0] ?? null

/** Through 0404's definer, once the sample import finishes: the merchant side of a store only. */
export const markSampleCatalogAdded = async (tx: ScopedSql): Promise<void> => {
  await tx`select set_sample_catalog_added()`
}
