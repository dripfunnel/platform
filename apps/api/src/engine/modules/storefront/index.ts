import type postgres from 'postgres'
import { isUuid } from '#core/ids'
import { pageWindow, pageWith, type Page, type PageRequest } from '#core/paging'
import { encodeCursor } from '#core/cursor'
import type { TenantContext } from '#core/tenancy'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { selectShopAsset, selectShopCollection, selectShopCollections, selectShopMenu, selectShopStore, type ShopCollectionRow, type ShopMenuItemRow, type ShopStoreRow } from '#db/scoped/shop'

export type { ShopCollectionRow, ShopStoreRow } from '#db/scoped/shop'

// The catalogue a storefront shows (PLATFORM-PROMPT §5.5; FIRST-RELEASE §19 Shop API), read as the shopper: what the
// merchant has made visible, in the shopper's language, never a supplier's id, a cost or a draft.

export const maxShopPage = 50

export interface StorefrontDeps {
  sql: postgres.Sql
  context: TenantContext
  language: string
}

export type ShopRefusal = 'INVALID_CURSOR' | 'INVALID_INPUT'
export type ShopResult<T> = { ok: true; value: T } | { ok: false; reason: ShopRefusal }

export interface ShopMenuItem {
  id: string
  label: string
  kind: ShopMenuItemRow['kind']
  /** A collection's web address in the shopper's language; a shop page's path; an https address. */
  collectionSlug: string | null
  url: string | null
  children: ShopMenuItem[]
}

export const createStorefrontCatalog = ({ sql, context, language }: StorefrontDeps) => {
  const { storeId } = context
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)

  const store = (): Promise<ShopStoreRow | null> => inScope((tx) => selectShopStore(tx, storeId))

  const menu = async (): Promise<ShopMenuItem[]> => {
    const rows = await inScope((tx) => selectShopMenu(tx, storeId, language))
    const item = (r: ShopMenuItemRow): ShopMenuItem => ({ id: r.id, label: r.label, kind: r.kind, collectionSlug: r.collection_slug, url: r.url, children: [] })
    const top = rows.filter((r) => r.parent_id === null).map(item)
    for (const r of rows) {
      if (r.parent_id !== null) top.find((t) => t.id === r.parent_id)?.children.push(item(r))
    }
    return top
  }

  const collections = async (request: PageRequest): Promise<ShopResult<Page<ShopCollectionRow>>> => {
    const window = pageWindow(request, maxShopPage)
    if (!window.ok) return { ok: false, reason: window.code }
    const rows = await inScope((tx) => selectShopCollections(tx, storeId, language, window.window))
    return { ok: true, value: pageWith(rows, window.window, (r) => encodeCursor({ occurredAt: r.created_at, id: r.id })) }
  }

  const collection = async (slug: string): Promise<ShopCollectionRow | null> => {
    const clean = slug.trim().toLowerCase()
    if (clean === '' || clean.length > 120) return null
    return inScope((tx) => selectShopCollection(tx, storeId, language, clean))
  }

  /** A file a storefront may show (a visible product's photo, a collection's image, the logo); null for any other. */
  const asset = (id: string) => (isUuid(id) ? inScope((tx) => selectShopAsset(tx, storeId, id.toLowerCase())) : Promise.resolve(null))

  return { store, menu, collections, collection, asset }
}
