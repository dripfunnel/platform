import { z } from 'zod'
import { query } from './client'

// A product's text in the store's other languages (CATALOG facts 18–22, N5–N16; apps/api/schema/store.graphql,
// src/apis/store/translations.ts): each field beside the main language's, as missing, translated or changed since.

const rowSchema = z.object({
  entity: z.enum(['product', 'version', 'option_name', 'choice_name']),
  entityId: z.string(),
  field: z.enum(['name', 'description', 'slug']),
  main: z.string(),
  text: z.string().nullable(),
  status: z.enum(['missing', 'translated', 'changed']),
})
export type TranslationRow = z.infer<typeof rowSchema>

const fields = 'entity entityId field main text status'

export const loadProductTranslation = async (productId: string, language: string): Promise<TranslationRow[]> =>
  (await query(`query T($p: ID!, $l: String!) { productTranslation(productId: $p, language: $l) { ${fields} } }`, z.object({ productTranslation: z.array(rowSchema) }), { p: productId, l: language })).productTranslation

export interface ProductTranslationInput {
  name?: string
  description?: string
  slug?: string
  versions?: { id: string; name: string }[]
  /** Option and choice names, the whole catalogue's: the merchant side's alone (N6). */
  names?: { kind: 'option_name' | 'choice_name'; source: string; text: string }[]
}

/** Empty text clears a field back to the main language (fact 19). */
export const saveProductTranslation = async (productId: string, language: string, input: ProductTranslationInput): Promise<TranslationRow[]> =>
  (await query(`mutation S($p: ID!, $l: String!, $input: ProductTranslationInput!) { saveProductTranslation(productId: $p, language: $l, input: $input) { ${fields} } }`, z.object({ saveProductTranslation: z.array(rowSchema) }), { p: productId, l: language, input })).saveProductTranslation
