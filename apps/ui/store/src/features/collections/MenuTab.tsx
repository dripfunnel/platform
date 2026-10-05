import { isApiError } from '@dripfunnel/shared/graphql'
import { Icon } from '@dripfunnel/shared/ui'
import { useState } from 'react'
import type { CollectionSummary } from '../../api/collections'
import { saveMenu, type Menu, type MenuItemInput } from '../../api/menu'
import { fill, formatCount, messages, plural } from '../../messages'

const words = messages.collections.menus

/** A menu item as the editor moves it: flat, in order, nested one level under the top item above it. */
export interface MenuRow {
  key: string
  kind: string
  label: string
  collectionId: string | null
  url: string | null
  depth: 0 | 1
}

let rowKey = 0

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

const swap = <T,>(list: readonly T[], i: number, j: number): T[] | null => {
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
  const kids = swap(owner.kids, owner.kids.findIndex((k) => k.key === key), owner.kids.findIndex((k) => k.key === key) + by)
  return kids && rowsOfBlocks(blocks.map((x) => (x === owner ? { ...x, kids } : x)))
}

/** An item out of the menu; the ones under it move up a level rather than under the item above (CATALOG J3). */
export const removed = (rows: readonly MenuRow[], key: string): MenuRow[] =>
  rowsOfBlocks(blocksOf(rows).flatMap((b) => (b.top.key === key ? b.kids.map((k) => ({ top: { ...k, depth: 0 as const }, kids: [] })) : [{ ...b, kids: b.kids.filter((k) => k.key !== key) }])))

export interface MenuTabProps {
  menu: Menu | null
  collections: readonly CollectionSummary[]
  storeName: string
  canEdit: boolean
  onSaved: (toast: string) => void
  /** A save refused because someone else changed the menu: reload it. */
  onStale: (toast: string) => void
}

/** CatCollections › Menus: the main menu built from collections, nested one level, with desktop and phone previews. */
export const MenuTab = ({ menu, collections, storeName, canEdit, onSaved, onStale }: MenuTabProps) => {
  const [rows, setRows] = useState<MenuRow[]>(() => rowsOfMenu(menu))
  const [revision, setRevision] = useState<number | null>(menu?.revision ?? null)
  const [busy, setBusy] = useState(false)
  const named = (r: MenuRow) => (r.kind === 'collection' ? (collections.find((c) => c.id === r.collectionId)?.name ?? words.gone) : r.label)
  const shown = (r: MenuRow) => r.kind !== 'collection' || collections.some((c) => c.id === r.collectionId && c.visible)

  // Every change saves at once, as the prototype's menu does; the rows move back if it's refused.
  const apply = async (next: MenuRow[], toast: string) => {
    const before = rows
    setRows(next)
    setBusy(true)
    try {
      setRevision(await saveMenu(menuInput(next, collections), menu?.name ?? null, revision))
      onSaved(toast)
    } catch (error) {
      setRows(before)
      const code = isApiError(error) ? error.code : 'other'
      const text = (words.refused as Record<string, string>)[code] ?? words.refused.other
      if (code === 'STALE_REVISION') onStale(text)
      else onSaved(text)
    } finally {
      setBusy(false)
    }
  }

  const move = (key: string, by: -1 | 1) => {
    const next = moved(rows, key, by)
    if (next) void apply(next, words.saved)
  }

  const nest = (i: number) => {
    const r = rows[i]
    if (!r) return
    if (i === 0 && r.depth === 0) return onSaved(words.firstNest)
    void apply(
      rows.map((x, j) => (j === i ? { ...x, depth: x.depth ? 0 : 1 } : x)),
      words.saved,
    )
  }

  const addable = collections.filter((c) => !rows.some((r) => r.collectionId === c.id))
  // Keyed by the row, never the label: two items may share a name.
  const tops = rows.filter(shown).reduce<{ key: string; label: string; kids: { key: string; label: string }[] }[]>((acc, r) => {
    const last = acc[acc.length - 1]
    if (r.depth === 1 && last) last.kids.push({ key: r.key, label: named(r) })
    else acc.push({ key: r.key, label: named(r), kids: [] })
    return acc
  }, [])

  return (
    <div className="df-coll-edit">
      <section className="df-coll-card df-menu" aria-labelledby="df-menu-title">
        <div className="df-menu-head">
          <h1 id="df-menu-title">{words.title}</h1>
          {canEdit && (
            <select
              aria-label={words.addLabel}
              value=""
              disabled={busy || addable.length === 0}
              onChange={(e) => {
                const c = collections.find((x) => x.id === e.target.value)
                if (c) void apply([...rows, { key: `m${++rowKey}`, kind: 'collection', label: c.name, collectionId: c.id, url: null, depth: 0 }], words.added)
              }}
            >
              <option value="">{words.add}</option>
              {addable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {busy && (
          <p className="df-coll-hint" role="status">
            {words.saving}
          </p>
        )}
        {rows.length === 0 && <p className="df-coll-hint">{words.empty}</p>}
        <ol className="df-menu-rows">
          {rows.map((r, i) => {
            const c = collections.find((x) => x.id === r.collectionId)
            const label = named(r)
            const note = r.kind !== 'collection' ? fill(words.link, { url: r.url ?? '' }) : !c ? '' : c.visible ? fill(plural(words.products, c.products), { count: formatCount(c.products) }) : words.hiddenNote
            return (
              <li key={r.key} className={['df-menu-row', shown(r) ? '' : 'df-menu-row--hidden', r.depth ? 'df-menu-row--kid' : ''].filter(Boolean).join(' ')}>
                <span className="df-menu-label">{label}</span>
                <span className="df-menu-note">{note}</span>
                {canEdit && (
                  <span className="df-menu-tools">
                    <button type="button" disabled={busy || !moved(rows, r.key, -1)} aria-label={fill(words.up, { label })} onClick={() => move(r.key, -1)}>
                      <Icon name="up" size={14} />
                    </button>
                    <button type="button" disabled={busy || !moved(rows, r.key, 1)} aria-label={fill(words.down, { label })} onClick={() => move(r.key, 1)}>
                      <Icon name="down" size={14} />
                    </button>
                    <button type="button" disabled={busy} aria-label={fill(r.depth ? words.unnest : words.nest, { label })} onClick={() => nest(i)}>
                      <Icon name={r.depth ? 'back' : 'forward'} size={14} />
                    </button>
                    <button type="button" className="df-menu-remove" disabled={busy} aria-label={fill(words.remove, { label })} onClick={() => void apply(removed(rows, r.key), words.removed)}>
                      <Icon name="close" size={14} />
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ol>
        <p className="df-coll-hint">{words.note}</p>
      </section>
      <div className="df-menu-previews">
        <section className="df-menu-preview" aria-label={words.desktop}>
          <h2>{words.desktop}</h2>
          <div className="df-menu-desktop">
            <strong>{storeName}</strong>
            {tops.map((t) => (
              <span key={t.key}>
                <span>
                  {t.label}
                  {t.kids.length > 0 && <Icon name="caret" size={12} />}
                </span>
                <span>{t.kids.map((k) => k.label).join(' · ')}</span>
              </span>
            ))}
          </div>
        </section>
        <section className="df-menu-preview df-menu-phone" aria-label={words.phone}>
          <h2>{words.phone}</h2>
          <ul>
            {tops.flatMap((t) => [
              <li key={t.key}>
                {t.label}
                <Icon name="chevron" size={14} />
              </li>,
              ...t.kids.map((k) => (
                <li key={k.key} className="df-menu-phone-kid">
                  {k.label}
                  <Icon name="chevron" size={14} />
                </li>
              )),
            ])}
          </ul>
        </section>
      </div>
    </div>
  )
}
