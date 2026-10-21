import { describe, expect, it } from 'vitest'
import { allPages } from './allPages'

const pages = (list: { nodes: number[]; hasNextPage: boolean; endCursor: string | null }[]) => {
  const asked: (string | null)[] = []
  const read = async (after: string | null) => {
    asked.push(after)
    const page = list[asked.length - 1]
    if (!page) throw new Error('asked past the last page')
    return { nodes: page.nodes, pageInfo: { hasNextPage: page.hasNextPage, endCursor: page.endCursor } }
  }
  return { read, asked }
}

describe('allPages', () => {
  it('reads every page by the cursor each one gives', async () => {
    const { read, asked } = pages([
      { nodes: [1, 2], hasNextPage: true, endCursor: 'c1' },
      { nodes: [3], hasNextPage: false, endCursor: 'c2' },
    ])
    expect(await allPages(read)).toEqual([1, 2, 3])
    expect(asked).toEqual([null, 'c1'])
  })

  it('fails rather than truncating when a page promises more but gives no cursor', async () => {
    await expect(allPages(pages([{ nodes: [1], hasNextPage: true, endCursor: null }]).read)).rejects.toThrow()
  })

  it('fails rather than looping when a page gives a cursor already read', async () => {
    const { read } = pages([
      { nodes: [1], hasNextPage: true, endCursor: 'same' },
      { nodes: [2], hasNextPage: true, endCursor: 'same' },
    ])
    await expect(allPages(read)).rejects.toThrow()
  })
})
