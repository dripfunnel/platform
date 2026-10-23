import { z } from 'zod'
import { typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// The store's main menu on the Store API (FIRST-RELEASE.md §12, CATALOG-DESIGN.md J): one menu, nested one level.

const itemSchema = z.object({ id: z.string(), parentId: z.string().nullable(), kind: z.string(), label: z.string(), collectionId: z.string().nullable(), url: z.string().nullable() })
export type MenuItem = z.infer<typeof itemSchema>

const menuSchema = z.object({ name: z.string(), revision: z.number().int(), items: z.array(itemSchema) })
export type Menu = z.infer<typeof menuSchema>

/** The main menu, or null before the store has saved one. */
export const loadMenu = async (client: ApiClient): Promise<Menu | null> =>
  (await typedQuery(client)('{ menu { name revision items { id parentId kind label collectionId url } } }', z.object({ menu: menuSchema.nullable() }))).menu

export type MenuItemInput = {
  kind: string
  label: string
  collectionId?: string
  url?: string
  children?: MenuItemInput[]
}

/** The whole menu at the revision read; answers the new revision. */
export const saveMenu = async (client: ApiClient, items: MenuItemInput[], name: string | null, revision: number | null): Promise<number> =>
  (
    await typedQuery(client)(
      'mutation SaveMenu($items: [MenuItemInput!]!, $name: String, $revision: Int) { saveMenu(items: $items, name: $name, revision: $revision) }',
      z.object({ saveMenu: z.number().int() }),
      { items, name, revision },
    )
  ).saveMenu
