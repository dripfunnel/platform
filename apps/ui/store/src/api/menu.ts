import { z } from 'zod'
import { query } from './client'

// The store's main menu (CatCollections › Menus, FIRST-RELEASE §12): one level of nesting (CATALOG J).

const itemSchema = z.object({ id: z.string(), parentId: z.string().nullable(), kind: z.string(), label: z.string(), collectionId: z.string().nullable(), url: z.string().nullable() })
export type MenuItem = z.infer<typeof itemSchema>

const menuSchema = z.object({ name: z.string(), revision: z.number().int(), items: z.array(itemSchema) })
export type Menu = z.infer<typeof menuSchema>

/** The main menu, or null before the store has saved one. */
export const loadMenu = async (): Promise<Menu | null> =>
  (await query('{ menu { name revision items { id parentId kind label collectionId url } } }', z.object({ menu: menuSchema.nullable() }))).menu

export interface MenuItemInput {
  kind: string
  label: string
  collectionId?: string
  url?: string
  children?: MenuItemInput[]
}

/** The whole menu at the revision read; answers the new revision. */
export const saveMenu = async (items: MenuItemInput[], name: string | null, revision: number | null): Promise<number> =>
  (await query('mutation S($items: [MenuItemInput!]!, $name: String, $revision: Int) { saveMenu(items: $items, name: $name, revision: $revision) }', z.object({ saveMenu: z.number().int() }), { items, name, revision })).saveMenu
