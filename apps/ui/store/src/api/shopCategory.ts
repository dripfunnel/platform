import { z } from 'zod'
import { locale } from '../messages'
import { sectionKeys } from './settings'
import { query } from './client'

// What the shop sells (DATA-MODEL §7.2; apps/api/schema/store.graphql `shopCategory`, `chooseShopCategory`): the
// Owner picks one of DripFunnel's list on Home's checklist or Settings › Catalogue. Names arrive in the portal's language.

const categorySchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  // A key an older portal doesn't know is left out rather than failing the read.
  sections: z.array(z.string()).transform((keys) => keys.filter((k): k is (typeof sectionKeys)[number] => (sectionKeys as readonly string[]).includes(k))),
  archived: z.boolean(),
  // Staff gave the category a sample catalog the store can add while it has no order (CATALOG-DESIGN A4).
  hasSample: z.boolean().nullable().transform((v) => v === true),
})
export type ShopCategory = z.infer<typeof categorySchema>

const choiceSchema = z.object({ options: z.array(categorySchema), current: categorySchema.nullable() })
export type ShopCategoryChoice = z.infer<typeof choiceSchema>

const fields = 'id key name(language: $language) sections archived hasSample'

export const loadShopCategory = async (): Promise<ShopCategoryChoice> =>
  (await query(`query C($language: String) { shopCategory { options { ${fields} } current { ${fields} } } }`, z.object({ shopCategory: choiceSchema }), { language: locale })).shopCategory

export const chooseShopCategory = async (id: string): Promise<ShopCategory> =>
  (await query(`mutation C($id: ID!, $language: String) { chooseShopCategory(id: $id) { ${fields} } }`, z.object({ chooseShopCategory: categorySchema }), { id, language: locale })).chooseShopCategory

/** Starts the category's sample as an import the merchant reviews and confirms (K13a); answers the import's id. */
export const addSampleCatalog = async (): Promise<string> => (await query('mutation { addSampleCatalog }', z.object({ addSampleCatalog: z.string() }))).addSampleCatalog
