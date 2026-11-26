// Store categories on the Admin API (DATA-MODEL §7.2, FIRST-RELEASE §2): every role reads the list; Super admin
// adds, edits, archives and restores, each with a reason the API audits.
import { z } from 'zod'
import type { StaffRole } from '../features/shell/staffRoles'
import { query } from './client'
import { isoString } from './decode'

export const categorySections = ['sizeCharts', 'specs', 'highlights', 'faqs', 'badges', 'related', 'aplus', 'video'] as const
export type CategorySection = (typeof categorySections)[number]

// storeCategories.manage is Super admin's alone (ACCESS §5.4); the API is the check.
export const categoryManagers: readonly StaffRole[] = ['staff-super-admin']

const categorySchema = z.object({
  id: z.string(),
  key: z.string(),
  names: z.array(z.object({ language: z.string(), name: z.string() })),
  sections: z.array(z.enum(categorySections)),
  archivedAt: isoString.nullable(),
  storeCount: z.number().int().nonnegative(),
  // Its starting template (DATA-MODEL §7.2), set by migration; null for most categories.
  template: z.object({ key: z.string(), name: z.string(), tag: z.string() }).nullable(),
  // DripFunnel ships built-in sample data for it (DATA-MODEL §7.2), which staff add with one click.
  hasDefaultSample: z.boolean().nullable().transform((v) => v === true),
  // Its sample catalog (CATALOG-DESIGN K13a); null when staff haven't added one.
  sample: z
    .object({
      currency: z.string(),
      products: z.number().int(),
      collections: z.array(z.object({ name: z.string(), products: z.number().int() })),
      photos: z.number().int(),
      uploadedAt: isoString,
    })
    .nullable(),
})
export type StoreCategory = z.infer<typeof categorySchema>

export interface CategoryInput {
  names: { language: string; name: string }[]
  sections: CategorySection[]
}

const fields = 'id key names { language name } sections archivedAt storeCount template { key name tag } hasDefaultSample sample { currency products collections { name products } photos uploadedAt }'

export const englishName = (category: Pick<StoreCategory, 'names' | 'key'>): string => category.names.find((n) => n.language === 'en')?.name ?? category.key

/** A category filter's choices: live categories first, archived last, each by its English name. */
export const categoryOptions = (categories: readonly StoreCategory[]): { id: string; name: string }[] =>
  [...categories.filter((c) => !c.archivedAt), ...categories.filter((c) => c.archivedAt)].map((c) => ({ id: c.id, name: englishName(c) }))

export const loadStoreCategories = async (): Promise<StoreCategory[]> => {
  const { storeCategories } = await query(`query StoreCategories { storeCategories { ${fields} } }`, z.object({ storeCategories: z.array(categorySchema) }))
  return storeCategories
}

export const createStoreCategory = async (input: CategoryInput, reason: string): Promise<StoreCategory> => {
  const { createStoreCategory: made } = await query(
    `mutation CreateStoreCategory($input: StoreCategoryInput!, $reason: String!) { createStoreCategory(input: $input, reason: $reason) { ${fields} } }`,
    z.object({ createStoreCategory: categorySchema }),
    { input, reason },
  )
  return made
}

export const updateStoreCategory = async (id: string, input: CategoryInput, reason: string): Promise<StoreCategory> => {
  const { updateStoreCategory: saved } = await query(
    `mutation UpdateStoreCategory($id: ID!, $input: StoreCategoryInput!, $reason: String!) { updateStoreCategory(id: $id, input: $input, reason: $reason) { ${fields} } }`,
    z.object({ updateStoreCategory: categorySchema }),
    { id, input, reason },
  )
  return saved
}

export const archiveStoreCategory = async (id: string, archived: boolean, reason: string): Promise<StoreCategory> => {
  const { archiveStoreCategory: saved } = await query(
    `mutation ArchiveStoreCategory($id: ID!, $archived: Boolean!, $reason: String!) { archiveStoreCategory(id: $id, archived: $archived, reason: $reason) { ${fields} } }`,
    z.object({ archiveStoreCategory: categorySchema }),
    { id, archived, reason },
  )
  return saved
}

// The codes the writes refuse with (apps/api saas/storeCategories StoreCategoryRefusal), worded by the screen.
export const categoryRefusals = ['INVALID_INPUT', 'KEY_TAKEN', 'NOT_FOUND', 'FORBIDDEN'] as const

const problemSchema = z.object({ line: z.number().int(), column: z.string().nullable(), code: z.string(), message: z.string() })
export type SampleProblem = z.infer<typeof problemSchema>

/** The category's built-in data as its sample; problems (with `category` null) only if that data no longer checks. */
export const addDefaultStoreCategorySample = async (categoryId: string, reason: string): Promise<{ category: StoreCategory | null; problems: SampleProblem[] }> => {
  const { addDefaultStoreCategorySample: saved } = await query(
    `mutation AddDefaultSample($categoryId: ID!, $reason: String!) { addDefaultStoreCategorySample(categoryId: $categoryId, reason: $reason) { category { ${fields} } problems { line column code message } } }`,
    z.object({ addDefaultStoreCategorySample: z.object({ category: categorySchema.nullable(), problems: z.array(problemSchema) }) }),
    { categoryId, reason },
  )
  return saved
}

export const removeStoreCategorySample = async (categoryId: string, reason: string): Promise<StoreCategory> => {
  const { removeStoreCategorySample: saved } = await query(
    `mutation RemoveSample($categoryId: ID!, $reason: String!) { removeStoreCategorySample(categoryId: $categoryId, reason: $reason) { ${fields} } }`,
    z.object({ removeStoreCategorySample: categorySchema }),
    { categoryId, reason },
  )
  return saved
}
