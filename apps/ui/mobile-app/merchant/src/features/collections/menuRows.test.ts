import type { CollectionSummary } from '../../api/collections'
import type { Menu } from '../../api/menu'
import { menuInput, menuPreview, moved, removed, rowsOfMenu, toggledDepth, type MenuRow } from './menuRows'

const row = (key: string, depth: 0 | 1): MenuRow => ({ key, kind: 'collection', label: key, collectionId: key, url: null, depth })
const shape = (rows: MenuRow[] | string | null) => (typeof rows === 'string' || rows === null ? rows : rows.map((r) => `${'  '.repeat(r.depth)}${r.key}`))
const collection = (id: string, over: Partial<CollectionSummary> = {}): CollectionSummary => ({ id, name: `Name ${id}`, kind: 'manual', visible: true, parentId: null, inheritParent: false, match: 'all', rules: [], products: 3, computedAt: null, ...over })

describe('nesting and moving out', () => {
  it('nests a top item under the one above, never one with items of its own', () => {
    // B, then A with A1: nesting A would take A1 with it two levels deep, so it's refused, and nothing else moves.
    const rows = [row('B', 0), row('A', 0), row('A1', 1)]

    expect(toggledDepth(rows, 'A')).toBe('HAS_KIDS')
    expect(shape(toggledDepth([row('B', 0), row('B1', 1), row('C', 0)], 'C'))).toEqual(['B', '  B1', '  C'])
    expect(toggledDepth(rows, 'B')).toBe('FIRST')
  })

  it('moves an item out to sit right after its parent, its siblings staying under that parent', () => {
    const rows = [row('A', 0), row('K1', 1), row('K2', 1), row('K3', 1), row('Z', 0)]

    expect(shape(toggledDepth(rows, 'K1'))).toEqual(['A', '  K2', '  K3', 'K1', 'Z'])
  })
})

describe('moving and removing', () => {
  const rows = [row('A', 0), row('A1', 1), row('A2', 1), row('B', 0)]

  it('moves a top item with the items under it, and an item among its siblings only', () => {
    expect(shape(moved(rows, 'A', 1))).toEqual(['B', 'A', '  A1', '  A2'])
    expect(shape(moved(rows, 'A2', -1))).toEqual(['A', '  A2', '  A1', 'B'])
    expect(moved(rows, 'A', -1)).toBeNull()
    expect(moved(rows, 'A1', -1)).toBeNull()
  })

  it('moves the items under a removed one up a level, never under the item above', () => {
    expect(shape(removed(rows, 'A'))).toEqual(['A1', 'A2', 'B'])
    expect(shape(removed(rows, 'A1'))).toEqual(['A', '  A2', 'B'])
  })
})

describe('the menu the API takes', () => {
  const menu: Menu = {
    name: 'Main menu',
    revision: 3,
    items: [
      { id: 'm1', parentId: null, kind: 'collection', label: 'Old name', collectionId: 'c1', url: null },
      { id: 'm2', parentId: 'm1', kind: 'collection', label: 'Kids', collectionId: 'c2', url: null },
      { id: 'm3', parentId: null, kind: 'url', label: 'Journal', collectionId: null, url: 'https://example.com/journal' },
    ],
  }

  it('reads the saved items as rows and writes them back with a collection’s name as it is now, keeping a link as it is', () => {
    const rows = rowsOfMenu(menu)

    expect(rows.map((r) => [r.kind, r.depth])).toEqual([['collection', 0], ['collection', 1], ['url', 0]])
    expect(menuInput(rows, [collection('c1', { name: 'New name' }), collection('c2')])).toEqual([
      { kind: 'collection', label: 'New name', collectionId: 'c1', children: [{ kind: 'collection', label: 'Name c2', collectionId: 'c2' }] },
      { kind: 'url', label: 'Journal', url: 'https://example.com/journal' },
    ])
  })

  it('previews only what shoppers see: a hidden or removed collection is left out', () => {
    const rows = rowsOfMenu(menu)
    const preview = menuPreview(rows, [collection('c1'), collection('c2', { visible: false })])

    expect(preview.map((p) => [p.label, p.kids.map((k) => k.label)])).toEqual([['Name c1', []], ['Journal', []]])
  })
})
