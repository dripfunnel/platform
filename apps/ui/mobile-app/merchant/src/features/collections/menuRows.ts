import type { CollectionSummary } from '../../api/collections'
import type { Menu, MenuItemInput } from '../../api/menu'

/** A menu item as the editor moves it: flat, in order, nested one level under the top item above it. */
export type MenuRow = {
  key: string
  kind: string
  label: string
  collectionId: string | null
  url: string | null
  depth: 0 | 1
}

let rowKey = 0

export const collectionRow = (c: Pick<CollectionSummary, 'id' | 'name'>): MenuRow => ({ key: `m${++rowKey}`, kind: 'collection', label: c.name, collectionId: c.id, url: null, depth: 0 })

/** The saved menu as rows: each top item, then the ones under it, in their order. */
export const rowsOfMenu = (menu: Menu | null): MenuRow[] => {
  const items = menu?.items ?? []
  const row = (i: Menu['items'][number], depth: 0 | 1): MenuRow => ({ key: `m${++rowKey}`, kind: i.kind, label: i.label, collectionId: i.collectionId, url: i.url, depth })
  return items.filter((i) => i.parentId === null).flatMap((top) => [row(top, 0), ...items.filter((i) => i.parentId === top.id).map((k) => row(k, 1))])
}

/** Rows back into the menu the API takes; a collection's link carries its name as it is now. */
export const menuInput = (rows: readonly MenuRow[], collections: readonly CollectionSummary[]): MenuItemInput[] => {
  const item = (r: MenuRow): MenuItemInput => {
    const name = collections.find((c) => c.id === r.collectionId)?.name
    return { kind: r.kind, label: name ?? r.label, ...(r.collectionId ? { collectionId: r.collectionId } : {}), ...(r.url ? { url: r.url } : {}) }
  }
  const tops: MenuItemInput[] = []
  for (const r of rows) {
    const parent = tops[tops.length - 1]
    if (r.depth === 1 && parent) parent.children = [...(parent.children ?? []), item(r)]
    else tops.push(item(r))
  }
  return tops
}

type Block = { top: MenuRow; kids: MenuRow[] }

const blocksOf = (rows: readonly MenuRow[]): Block[] =>
  rows.reduce<Block[]>((acc, r) => {
    const last = acc[acc.length - 1]
    if (r.depth === 1 && last) last.kids.push(r)
    else acc.push({ top: { ...r, depth: 0 }, kids: [] })
    return acc
  }, [])

const rowsOfBlocks = (blocks: readonly Block[]): MenuRow[] => blocks.flatMap((b) => [b.top, ...b.kids])

const swap = <T>(list: readonly T[], i: number, j: number): T[] | null => {
  const a = list[i]
  const b = list[j]
  if (a === undefined || b === undefined) return null
  const next = [...list]
  next[i] = b
  next[j] = a
  return next
}

/**
 * A top item moves with the items under it, past the next top item and its own; an item under one moves
 * among its siblings. So moving never puts an item under a different parent; only nesting does.
 */
export const moved = (rows: readonly MenuRow[], key: string, by: -1 | 1): MenuRow[] | null => {
  const blocks = blocksOf(rows)
  const b = blocks.findIndex((x) => x.top.key === key)
  if (b >= 0) {
    const next = swap(blocks, b, b + by)
    return next && rowsOfBlocks(next)
  }
  const owner = blocks.find((x) => x.kids.some((k) => k.key === key))
  if (!owner) return null
  const at = owner.kids.findIndex((k) => k.key === key)
  const kids = swap(owner.kids, at, at + by)
  return kids && rowsOfBlocks(blocks.map((x) => (x === owner ? { ...x, kids } : x)))
}

/**
 * Nesting and moving out, by block: a top item goes under the top item above it (never one with items of its own, as the
 * menu is one level deep); an item under one comes out to sit right after its parent, its siblings staying where they are.
 */
export const toggledDepth = (rows: readonly MenuRow[], key: string): MenuRow[] | 'FIRST' | 'HAS_KIDS' | null => {
  const blocks = blocksOf(rows)
  const b = blocks.findIndex((x) => x.top.key === key)
  if (b === 0) return 'FIRST'
  const block = blocks[b]
  const above = blocks[b - 1]
  if (block && above) {
    if (block.kids.length > 0) return 'HAS_KIDS'
    return rowsOfBlocks(blocks.flatMap((x, j) => (j === b ? [] : j === b - 1 ? [{ ...x, kids: [...x.kids, { ...block.top, depth: 1 as const }] }] : [x])))
  }
  const owner = blocks.find((x) => x.kids.some((k) => k.key === key))
  const kid = owner?.kids.find((k) => k.key === key)
  if (!owner || !kid) return null
  return rowsOfBlocks(blocks.flatMap((x) => (x === owner ? [{ ...x, kids: x.kids.filter((k) => k.key !== key) }, { top: { ...kid, depth: 0 as const }, kids: [] }] : [x])))
}

/** An item out of the menu; the ones under it move up a level rather than under the item above (CATALOG-DESIGN.md J3). */
export const removed = (rows: readonly MenuRow[], key: string): MenuRow[] =>
  rowsOfBlocks(blocksOf(rows).flatMap((b) => (b.top.key === key ? b.kids.map((k) => ({ top: { ...k, depth: 0 as const }, kids: [] })) : [{ ...b, kids: b.kids.filter((k) => k.key !== key) }])))

/** What shoppers see of the menu: each top item with the names under it, leaving out a collection that is hidden or gone. */
export const menuPreview = (rows: readonly MenuRow[], collections: readonly CollectionSummary[]): { key: string; label: string; kids: { key: string; label: string }[] }[] => {
  const shown = (r: MenuRow) => r.kind !== 'collection' || collections.some((c) => c.id === r.collectionId && c.visible)
  const named = (r: MenuRow) => (r.kind === 'collection' ? (collections.find((c) => c.id === r.collectionId)?.name ?? r.label) : r.label)
  return rows.filter(shown).reduce<{ key: string; label: string; kids: { key: string; label: string }[] }[]>((acc, r) => {
    const last = acc[acc.length - 1]
    if (r.depth === 1 && last) last.kids.push({ key: r.key, label: named(r) })
    else acc.push({ key: r.key, label: named(r), kids: [] })
    return acc
  }, [])
}
