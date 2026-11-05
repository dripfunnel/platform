import { describe, expect, it } from 'vitest'
import { memoryKept } from '../../../tests/support/kept'
import { changedFiles, keptChanges } from './kept'

const change = (commit: string, files: { path: string; content: string | null }[]) => ({ commit, message: 'Make it warmer', userId: null, template: 'baseline', coreVersion: '0.4.0', customPaths: [], previewRef: `ref-${commit}`, files })

describe('the changes kept in the studio’s own storage (AI-STUDIO §7, #1241)', () => {
  it('keeps each change in order with its files, and drops those a save holds', async () => {
    const { storage, data } = memoryKept()
    const kept = keptChanges(storage)
    const many = Array.from({ length: 300 }, (_, i) => ({ path: `content/en/p${i}.json`, content: `{"n":${i}}` }))
    expect(await kept.add(change('a'.repeat(40), [{ path: 'content/en/pages.json', content: '{}' }]))).toBe(1)
    expect(await kept.add(change('b'.repeat(40), many))).toBe(2)
    expect(await kept.add(change('c'.repeat(40), [{ path: 'src/theme/x.css', content: null }]))).toBe(3)
    const all = await kept.list()
    expect(all.map((k) => [k.seq, k.files.length])).toEqual([
      [1, 1],
      [2, 300],
      [3, 1],
    ])
    expect(all[1]?.files[299]).toEqual(many[299])

    await kept.recommit(3, 'd'.repeat(40))
    await kept.drop(2)
    expect((await kept.list()).map((k) => [k.seq, k.commit])).toEqual([[3, 'd'.repeat(40)]])
    expect([...data.keys()].filter((k) => k !== 'kept:last').every((k) => k.includes('0000000003'))).toBe(true)
    await kept.remove(3)
    expect(await kept.list()).toEqual([])
    // Never renumbered from 1 once emptied, so a save still waiting never takes a later change for its own.
    expect(await kept.add(change('e'.repeat(40), []))).toBe(4)
  })

  it('reads the files a change wrote, removed and left alone', () => {
    const before = new Map([
      ['a.css', 'a'],
      ['b.css', 'b'],
      ['c.css', 'c'],
    ])
    const after = new Map([
      ['a.css', 'a'],
      ['b.css', 'B'],
      ['d.css', 'd'],
    ])
    expect(changedFiles(before, after)).toEqual([
      { path: 'b.css', content: 'B' },
      { path: 'd.css', content: 'd' },
      { path: 'c.css', content: null },
    ])
  })
})
