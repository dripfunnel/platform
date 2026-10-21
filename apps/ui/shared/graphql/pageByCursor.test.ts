import { describe, expect, it } from 'vitest'
import { pageByCursor } from './pageByCursor'

const all = Array.from({ length: 7 }, (_, i) => ({ id: `s${i + 1}` }))

describe('pageByCursor', () => {
  it('answers the first page with a cursor onward and no count', () => {
    const page = pageByCursor(all, {}, 3)
    expect(page.items.map((item) => item.id)).toEqual(['s1', 's2', 's3'])
    expect(page.pageInfo).toEqual({ startCursor: 's1', endCursor: 's3', hasPreviousPage: false, hasNextPage: true })
    expect(Object.keys(page.pageInfo)).not.toContain('total')
  })

  it('continues after a cursor without repeating, and stops at the end', () => {
    const next = pageByCursor(all, { after: 's3' }, 3)
    expect(next.items.map((item) => item.id)).toEqual(['s4', 's5', 's6'])
    const last = pageByCursor(all, { after: next.pageInfo.endCursor ?? undefined }, 3)
    expect(last.items.map((item) => item.id)).toEqual(['s7'])
    expect(last.pageInfo.hasNextPage).toBe(false)
  })

  it('steps back a page before a cursor', () => {
    const back = pageByCursor(all, { before: 's4' }, 3)
    expect(back.items.map((item) => item.id)).toEqual(['s1', 's2', 's3'])
    expect(back.pageInfo.hasPreviousPage).toBe(false)
  })
})
