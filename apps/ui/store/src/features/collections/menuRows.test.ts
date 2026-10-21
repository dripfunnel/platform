import { describe, expect, it } from 'vitest'
import { toggledDepth } from './MenuTab'

const row = (key: string, depth: 0 | 1) => ({ key, kind: 'collection' as const, label: key, collectionId: key, url: null, depth })
const shape = (rows: ReturnType<typeof row>[] | string | null) => (typeof rows === 'string' || rows === null ? rows : rows.map((r) => `${'  '.repeat(r.depth)}${r.key}`))

describe('nesting and moving out', () => {
  it('nests a top item under the one above, never one with items of its own', () => {
    // B, then A with A1: nesting A would take A1 with it two levels deep, so it's refused, and nothing else moves.
    const rows = [row('B', 0), row('A', 0), row('A1', 1)]
    expect(toggledDepth(rows, 'A')).toBe('HAS_KIDS')
    expect(shape(toggledDepth([row('B', 0), row('B1', 1), row('C', 0)], 'C') as ReturnType<typeof row>[])).toEqual(['B', '  B1', '  C'])
    expect(toggledDepth(rows, 'B')).toBe('FIRST')
  })

  it('moves an item out to sit right after its parent, its siblings staying under that parent', () => {
    const rows = [row('A', 0), row('K1', 1), row('K2', 1), row('K3', 1), row('Z', 0)]
    expect(shape(toggledDepth(rows, 'K1') as ReturnType<typeof row>[])).toEqual(['A', '  K2', '  K3', 'K1', 'Z'])
  })
})
