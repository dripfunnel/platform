import { z } from 'zod'
import { typedQuery, type ApiClient } from '../graphql'

// The store's main menu on the Store API (FIRST-RELEASE.md §12, CATALOG-DESIGN.md J): one menu, nested one level.

const itemSchema = z.object({ id: z.string(), parentId: z.string().nullable(), kind: z.string(), label: z.string(), collectionId: z.string().nullable(), url: z.string().nullable() })
export type MenuItem = z.infer<typeof itemSchema>

const menuSchema = z.object({ name: z.string(), revision: z.number().int(), items: z.array(itemSchema) })
export type Menu = z.infer<typeof menuSchema>

/** The main menu, or null before the store has saved one. */
export const loadMenu = async (client: ApiClient): Promise<Menu | null> =>
  (await typedQuery(client)('{ menu { name revision items { id parentId kind label collectionId url } } }', z.object({ menu: menuSchema.nullable() }))).menu
