'use client'

import { z } from 'zod'
import { collectionPath } from '../../collections/collections'
import { useShopData } from '../render/data'

// The store's menu as the merchant set it (Catalogue › Menu, FIRST-RELEASE §12): a theme draws it, never writes its own.

const text = z.string().nullable().optional()
type Row = { id?: string | null | undefined; label?: string | null | undefined; kind?: string | null | undefined; collectionSlug?: string | null | undefined; url?: string | null | undefined; children?: Row[] | null | undefined }
const rowSchema: z.ZodType<Row> = z.lazy(() => z.object({ id: text, label: text, kind: text, collectionSlug: text, url: text, children: z.array(rowSchema).nullable().optional() }))
const menuSchema = z.object({ menu: z.array(rowSchema).nullable() })

export type MenuItem = { id: string; label: string; href: string; children: MenuItem[] }

// The engine's own rule for a page link (catalog/structure.ts cleanMenu): a path of plain characters, so no `//`, `\`,
// escape or control character can make a browser leave the store.
const pagePath = /^\/(?:[a-z0-9_-][a-z0-9/_-]*)?$/
const isHttps = (url: string) => {
  if ([...url].some((c) => c <= ' ' || c === '\u007f' || c === '\\' || /\s/.test(c))) return false
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

const hrefOf = (row: Row): string | null => {
  if (row.kind === 'collection') return row.collectionSlug ? collectionPath(row.collectionSlug) : null
  if (row.kind === 'page') return row.url && pagePath.test(row.url) && !row.url.includes('//') ? row.url : null
  if (row.kind === 'url') return row.url && isHttps(row.url) ? row.url : null
  return null
}

const items = (rows: readonly Row[] | null | undefined): MenuItem[] =>
  (rows ?? []).flatMap((row) => {
    const href = hrefOf(row)
    return row.id && row.label && href ? [{ id: row.id, label: row.label, href, children: items(row.children) }] : []
  })

/** The menu's links, one level of children; an item whose link no longer resolves (a hidden collection) is left out. */
export const useMenu = () => {
  const menu = useShopData('menu', async (client) => items((await client.query('query Menu { menu { id label kind collectionSlug url children { id label kind collectionSlug url } } }', menuSchema)).menu))
  return { status: menu.status, items: menu.data ?? [] }
}
