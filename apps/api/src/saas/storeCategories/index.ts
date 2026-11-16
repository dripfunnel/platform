import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { StaffMember } from '#auth/staff'
import type { TenantContext } from '#core/tenancy'
import { isUuid } from '#core/ids'
import { serialise, withScope } from '#db/scoped/index'
import {
  deleteSample,
  insertCategory,
  selectDefaultSample,
  selectSample,
  selectSampleStanding,
  sampleExists,
  selectSampleCategoryIds,
  selectSampleSummaries,
  countCategories,
  maxStoreCategories,
  upsertSample,
  type CategorySampleSummary,
  keyTaken,
  sectionKeys,
  selectCategoriesForStaff,
  selectCategoriesForStore,
  selectCategory,
  selectStoreCategoryId,
  setCategoryArchived,
  setStoreCategory,
  updateCategory,
  type CategoryInput,
  type SectionKey,
  type StaffCategoryRow,
  type StoreCategoryRow,
} from '#db/scoped/storeCategories'
import { reasonText, staffEntry } from '#saas/staff/index'
import { fileOf, itemsOf, previewShaOf, productCountOf, sampleItemsInput, type SampleItem } from './editor'
import { checkSampleFile, copySamplePhotos, samplePhotoKey, storeSamplePhoto, type PhotoCopier, type SampleProblem } from './sample'

// Store categories (DATA-MODEL §7.2; admin FIRST-RELEASE §2a): staff keep the list, Super admin alone changes it
// (`storeCategories.manage`); a store's Owner picks one. Archiving never takes a category from a store.

export const storeCategoryAudit = {
  created: 'store_category.created',
  updated: 'store_category.updated',
  archived: 'store_category.archived',
  restored: 'store_category.restored',
  sampleSaved: 'store_category.sample_saved',
  sampleRemoved: 'store_category.sample_removed',
  chosen: 'store.category_chosen',
  sampleAdded: 'catalog.sample_added',
} as const

export { type SampleProblem }
/** A category as a store's picker shows it: whether staff gave it a sample catalog. */
export type ShopCategoryRow = StoreCategoryRow & { has_sample: boolean }
export type StaffCategory = StaffCategoryRow & { sample: (CategorySampleSummary & { products: number }) | null }
/** The editor's view of a sample (admin FIRST-RELEASE §11b): its products, each photo with the sha its preview takes. */
export interface SampleDetail {
  currency: string
  uploaded_at: Date
  products: (SampleItem & { previewSha: string | null })[]
  collections: { name: string; products: number }[]
}
export type SampleSaveResult = { ok: true; value: StaffCategory } | { ok: false; reason: StoreCategoryRefusal } | { ok: false; reason: 'SAMPLE_INVALID'; problems: SampleProblem[] }

export type StoreCategoryRefusal = 'INVALID_INPUT' | 'KEY_TAKEN' | 'NOT_FOUND' | 'TOO_MANY'
export type SampleRefusal = 'NO_CATEGORY' | 'NO_SAMPLE' | 'HAS_ORDERS' | 'ALREADY_ADDED'
export type StoreCategoryResult<T> = { ok: true; value: T } | { ok: false; reason: StoreCategoryRefusal }

export { sectionKeys, type SectionKey, type StaffCategoryRow, type StoreCategoryRow }

const languageCode = z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/)
const nameText = z.string().trim().min(1).max(60)
export const categoryInput = z
  .object({
    names: z.array(z.object({ language: languageCode, name: nameText }).strict()).min(1).max(40),
    sections: z.array(z.enum(sectionKeys)).max(sectionKeys.length),
  })
  .strict()
  .refine((v) => v.names.some((n) => n.language === 'en'), { message: 'English name required' })
  .refine((v) => new Set(v.names.map((n) => n.language)).size === v.names.length, { message: 'One name per language' })
export type CategoryFields = z.infer<typeof categoryInput>

const keyOf = (english: string): string =>
  english
    .normalize('NFKD')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'c_$1')
    .slice(0, 40)

const toInput = (fields: CategoryFields): CategoryInput => ({
  names: Object.fromEntries(fields.names.map((n) => [n.language, n.name.trim()])),
  sections: [...new Set(fields.sections)],
})

/** A category's name in `language`, else English. */
export const categoryName = (row: Pick<StoreCategoryRow, 'names'>, language: string): string =>
  row.names[language] ?? row.names[language.split('-')[0] ?? ''] ?? row.names.en ?? ''

const changedFields = (before: StoreCategoryRow, after: CategoryInput) => {
  const changes: { field: string; before: string | null; after: string | null }[] = []
  for (const lang of new Set([...Object.keys(before.names), ...Object.keys(after.names)])) {
    const b = before.names[lang] ?? null
    const a = after.names[lang] ?? null
    if (b !== a) changes.push({ field: `name.${lang}`, before: b, after: a })
  }
  const bs = [...before.sections].sort().join(', ')
  const as = [...after.sections].sort().join(', ')
  if (bs !== as) changes.push({ field: 'sections', before: bs, after: as })
  return changes
}

export interface StaffCategoryDeps {
  sql: postgres.Sql
  staff: StaffMember
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
  /** Where sample photos are copied once (R2) and how they're fetched; without it a sample with photos is refused. */
  photos?: PhotoCopier
}

/** The Admin API's: every role reads, `storeCategories.manage` writes (checked at the field). */
export const createStoreCategoryAdminService = ({ sql, staff, activity, facts, now, photos }: StaffCategoryDeps) => {
  const asStaff = <T>(work: (tx: postgres.TransactionSql) => Promise<T>) => withScope(sql, { caller: { kind: 'staff', staffId: staff.id } }, work)
  const entry = staffEntry(staff, facts)

  const withSamples = async (tx: postgres.TransactionSql, rows: StaffCategoryRow[], onlyId: string | null = null): Promise<StaffCategory[]> => {
    const samples = new Map((await selectSampleSummaries(tx, onlyId)).map(({ file, ...x }) => [x.category_id, { ...x, products: productCountOf(file) }]))
    return rows.map((r) => ({ ...r, sample: samples.get(r.id) ?? null }))
  }

  const list = () => asStaff(async (tx) => withSamples(tx, await selectCategoriesForStaff(tx)))

  const withCount = async (tx: postgres.TransactionSql, row: StoreCategoryRow): Promise<StaffCategory> =>
    (await withSamples(tx, await selectCategoriesForStaff(tx, row.id), row.id))[0] ?? { ...row, store_count: 0, has_default_sample: false, sample: null }

  const create = async (raw: unknown, reason: unknown): Promise<StoreCategoryResult<StaffCategory>> => {
    const fields = categoryInput.safeParse(raw)
    const why = reasonText.safeParse(reason)
    if (!fields.success || !why.success) return { ok: false, reason: 'INVALID_INPUT' }
    const input = toInput(fields.data)
    const key = keyOf(input.names.en ?? '')
    if (key.length < 2) return { ok: false, reason: 'INVALID_INPUT' }
    return asStaff(async (tx) => {
      await serialise(tx, 'store_category:create')
      if ((await countCategories(tx)) >= maxStoreCategories) return { ok: false, reason: 'TOO_MANY' } as const
      if (await keyTaken(tx, key)) return { ok: false, reason: 'KEY_TAKEN' } as const
      const row = await insertCategory(tx, key, input)
      await activity.record(
        tx,
        entry({
          action: storeCategoryAudit.created,
          reason: why.data,
          target: { type: 'store_category', id: row.id, label: input.names.en ?? key },
          visibility: 'staff',
          changes: changedFields({ ...row, names: {}, sections: [] }, input),
        }),
      )
      return { ok: true, value: await withCount(tx, row) } as const
    })
  }

  const update = async (id: string, raw: unknown, reason: unknown): Promise<StoreCategoryResult<StaffCategory>> => {
    const fields = categoryInput.safeParse(raw)
    const why = reasonText.safeParse(reason)
    if (!isUuid(id) || !fields.success || !why.success) return { ok: false, reason: 'INVALID_INPUT' }
    const input = toInput(fields.data)
    return asStaff(async (tx) => {
      const before = await selectCategory(tx, id)
      if (!before) return { ok: false, reason: 'NOT_FOUND' } as const
      const row = await updateCategory(tx, id, input)
      if (!row) return { ok: false, reason: 'NOT_FOUND' } as const
      await activity.record(
        tx,
        entry({
          action: storeCategoryAudit.updated,
          reason: why.data,
          target: { type: 'store_category', id, label: input.names.en ?? before.key },
          visibility: 'staff',
          changes: changedFields(before, input),
        }),
      )
      return { ok: true, value: await withCount(tx, row) } as const
    })
  }

  const setArchived = async (id: string, archived: boolean, reason: unknown): Promise<StoreCategoryResult<StaffCategory>> => {
    const why = reasonText.safeParse(reason)
    if (!isUuid(id) || !why.success) return { ok: false, reason: 'INVALID_INPUT' }
    return asStaff(async (tx) => {
      const row = await setCategoryArchived(tx, id, archived, now())
      if (!row) return { ok: false, reason: 'NOT_FOUND' } as const
      const counted = await withCount(tx, row)
      await activity.record(
        tx,
        entry({
          action: archived ? storeCategoryAudit.archived : storeCategoryAudit.restored,
          reason: why.data,
          target: { type: 'store_category', id, label: row.names.en ?? row.key },
          visibility: 'staff',
          changes: [{ field: 'stores_using', before: null, after: String(counted.store_count) }],
        }),
      )
      return { ok: true, value: counted } as const
    })
  }

  /** Checked as a merchant's import would read it, its photos copied once, then saved; nothing is kept from a refused file. */
  const saveSample = async (id: string, file: string, currency: string, reason: unknown): Promise<SampleSaveResult> => {
    const why = reasonText.safeParse(reason)
    const code = currency.trim().toUpperCase()
    if (!isUuid(id) || !why.success || !/^[A-Z]{3}$/.test(code) || file.trim() === '') return { ok: false, reason: 'INVALID_INPUT' }
    const exists = await asStaff((tx) => selectCategory(tx, id))
    if (!exists) return { ok: false, reason: 'NOT_FOUND' }
    const checked = checkSampleFile(file, code)
    if (!checked.ok) return { ok: false, reason: 'SAMPLE_INVALID', problems: checked.problems }
    // A photo copied at an earlier save, or uploaded in the editor, is kept as it is (DATA-MODEL §7.2).
    const current = (await asStaff((tx) => selectSample(tx, id)))?.photos ?? {}
    const copied = await copySamplePhotos(id, checked.plan, photos ?? null, current)
    if (!copied.ok) return { ok: false, reason: 'SAMPLE_INVALID', problems: copied.problems }
    return asStaff(async (tx) => {
      const row = await selectCategory(tx, id)
      if (!row) return { ok: false, reason: 'NOT_FOUND' } as const
      await upsertSample(tx, { category_id: id, file, currency: code, collections: checked.collections, photos: copied.photos, uploadedBy: staff.id }, now())
      await activity.record(
        tx,
        entry({
          action: storeCategoryAudit.sampleSaved,
          reason: why.data,
          target: { type: 'store_category', id, label: row.names.en ?? row.key },
          visibility: 'staff',
          changes: [
            { field: 'currency', before: null, after: code },
            { field: 'collections', before: null, after: checked.collections.map((c) => c.name).join(', ') },
            { field: 'photos', before: String(Object.keys(current).length), after: String(Object.keys(copied.photos).length) },
            { field: 'photos_added', before: null, after: Object.keys(copied.photos).filter((ref) => !Object.hasOwn(current, ref)).join(', ') || null },
          ],
        }),
      )
      return { ok: true, value: await withCount(tx, row) } as const
    })
  }

  const removeSample = async (id: string, reason: unknown): Promise<StoreCategoryResult<StaffCategory>> => {
    const why = reasonText.safeParse(reason)
    if (!isUuid(id) || !why.success) return { ok: false, reason: 'INVALID_INPUT' }
    return asStaff(async (tx) => {
      const row = await selectCategory(tx, id)
      if (!row || !(await deleteSample(tx, id))) return { ok: false, reason: 'NOT_FOUND' } as const
      await activity.record(tx, entry({ action: storeCategoryAudit.sampleRemoved, reason: why.data, target: { type: 'store_category', id, label: row.names.en ?? row.key }, visibility: 'staff' }))
      return { ok: true, value: await withCount(tx, row) } as const
    })
  }

  /** "Add default sample": the category's built-in data (0401) checked and its photos copied, as any sample is. */
  const addDefaultSample = async (id: string, reason: unknown): Promise<SampleSaveResult> => {
    if (!isUuid(id)) return { ok: false, reason: 'INVALID_INPUT' }
    const builtIn = await asStaff((tx) => selectDefaultSample(tx, id))
    if (!builtIn) return { ok: false, reason: 'NOT_FOUND' }
    return saveSample(id, builtIn.file, builtIn.currency, reason)
  }

  /** The sample as products and collections, parsed from its file; null when the category has none. */
  const sampleDetail = async (id: string): Promise<SampleDetail | null> => {
    if (!isUuid(id)) return null
    const sample = await asStaff((tx) => selectSample(tx, id))
    if (!sample) return null
    const items = itemsOf(sample.file)
    return {
      currency: sample.currency,
      uploaded_at: sample.uploaded_at,
      products: items.products.map((p) => ({ ...p, previewSha: previewShaOf(p.photo, sample.photos) })),
      collections: items.collections.map((name) => ({ name, products: items.products.filter((p) => p.collections.includes(name)).length })),
    }
  }

  /** The editor's Save: the items become the sample's file, checked and stored as any sample is. */
  const saveSampleItems = async (id: string, raw: unknown, reason: unknown): Promise<SampleSaveResult> => {
    const parsed = sampleItemsInput.safeParse(raw)
    if (!parsed.success) return { ok: false, reason: 'INVALID_INPUT' }
    const input = parsed.data
    const problem = (line: number, column: string | null, code: string, message: string): SampleProblem => ({ line, column, code, message })
    const early: SampleProblem[] = []
    if (input.products.length === 0) early.push(problem(0, null, 'PRODUCT_COUNT', 'Add at least one product.'))
    if (input.collections.length === 0) early.push(problem(0, 'collection', 'COLLECTION_COUNT', 'Add at least one collection.'))
    for (const name of input.collections)
      if (!input.products.some((p) => p.collections.includes(name)))
        early.push(problem(0, 'collection', 'COLLECTION_EMPTY', `“${name}” has no products. Add a product to it or delete it.`))
    if (early.length > 0) return { ok: false, reason: 'SAMPLE_INVALID', problems: early }
    return saveSample(id, fileOf(input), input.currency, reason)
  }

  /** The editor's Upload: an image stored once under the category, answered as the ref a product names. It changes no
   *  sample until a Save names it, so the Save's entry, with its reason, lists it (`photos_added`). */
  const uploadSamplePhoto = async (id: string, bytes: Uint8Array<ArrayBuffer>): Promise<{ ok: true; ref: string; sha: string } | { ok: false; code: 'NOT_FOUND' | 'NO_STORAGE' | 'PHOTO_REFUSED' }> => {
    if (!isUuid(id)) return { ok: false, code: 'NOT_FOUND' }
    const category = await asStaff((tx) => selectCategory(tx, id))
    if (!category) return { ok: false, code: 'NOT_FOUND' }
    const stored = await storeSamplePhoto(id, bytes, photos?.assets ?? null)
    if (!stored.ok) return stored
    return { ok: true, ref: stored.ref, sha: stored.ref.split(':')[1] ?? '' }
  }

  /** The R2 key of a category's sample photo for its preview; null for a malformed sha or an unknown category. */
  const samplePhoto = async (id: string, sha: string): Promise<{ body: ReadableStream } | null> => {
    if (!isUuid(id) || !/^[0-9a-f]{64}$/.test(sha) || !photos?.assets) return null
    if (!(await asStaff((tx) => selectCategory(tx, id)))) return null
    return photos.assets.get(samplePhotoKey(id, sha))
  }

  return { list, create, update, setArchived, addDefaultSample, removeSample, sampleDetail, saveSampleItems, uploadSamplePhoto, samplePhoto }
}
export type StoreCategoryAdminService = ReturnType<typeof createStoreCategoryAdminService>

export interface StoreCategoryDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
}

/** The Store API's: the picker and the Owner's choice (`settings`, checked at the field). */
export const createStoreCategoryService = ({ sql, context, actor, activity, facts }: StoreCategoryDeps) => {
  const { storeId } = context

  const read = () =>
    withScope(sql, context, async (tx) => {
      const [rows, current] = await Promise.all([selectCategoriesForStore(tx, storeId), selectStoreCategoryId(tx, storeId)])
      const withSample = new Set(await selectSampleCategoryIds(tx))
      const options = rows.map((r) => ({ ...r, has_sample: withSample.has(r.id) }))
      return { options, current: options.find((o) => o.id === current) ?? null }
    })

  /** What "Add sample catalog" imports, or why it can't: refused once the store has an order, or once added (DATA-MODEL §7.2). */
  const sampleToAdd = (): Promise<{ ok: true; value: { categoryId: string; file: string; currency: string } } | { ok: false; reason: SampleRefusal }> =>
    withScope(sql, context, async (tx) => {
      const standing = await selectSampleStanding(tx, storeId)
      if (!standing?.category_id) return { ok: false, reason: 'NO_CATEGORY' } as const
      if (standing.has_order) return { ok: false, reason: 'HAS_ORDERS' } as const
      if (standing.added) return { ok: false, reason: 'ALREADY_ADDED' } as const
      const sample = await selectSample(tx, standing.category_id)
      if (!sample) return { ok: false, reason: 'NO_SAMPLE' } as const
      return { ok: true, value: { categoryId: sample.category_id, file: sample.file, currency: sample.currency } } as const
    })

  const recordSampleAdded = (jobId: string, categoryId: string) =>
    withScope(sql, context, async (tx) => {
      await activity.record(tx, {
        category: 'write',
        action: storeCategoryAudit.sampleAdded,
        result: 'success',
        actorKind: 'person',
        actorId: actor.id,
        actorLabel: null,
        partnerId: actor.partnerId,
        storeId,
        target: { type: 'import', id: jobId, label: 'Sample catalog' },
        reason: null,
        api: 'store',
        visibility: 'store',
        changes: [{ field: 'category', before: null, after: categoryId }],
        ...facts,
      })
    })

  const choose = async (id: string): Promise<StoreCategoryResult<ShopCategoryRow>> => {
    if (!isUuid(id)) return { ok: false, reason: 'INVALID_INPUT' }
    return withScope(sql, context, async (tx) => {
      const row = await selectCategory(tx, id)
      if (!row || row.archived_at) return { ok: false, reason: 'NOT_FOUND' } as const
      const before = await selectStoreCategoryId(tx, storeId)
      await setStoreCategory(tx, id)
      await activity.record(tx, {
        category: 'write',
        action: storeCategoryAudit.chosen,
        result: 'success',
        actorKind: 'person',
        actorId: actor.id,
        actorLabel: null,
        partnerId: actor.partnerId,
        storeId,
        target: { type: 'store', id: storeId, label: row.key },
        reason: null,
        api: 'store',
        visibility: 'store',
        changes: [{ field: 'category', before, after: row.key }],
        ...facts,
      })
      const hasSample = await sampleExists(tx, id)
      return { ok: true, value: { ...row, has_sample: hasSample } } as const
    })
  }

  return { read, choose, sampleToAdd, recordSampleAdded }
}
