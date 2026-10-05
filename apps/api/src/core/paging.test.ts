import { describe, expect, it } from 'vitest'
import { encodeCursor } from './cursor'
import { pageOf, pageWindow } from './paging'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const row = (n: number) => ({ id: id(n), occurredAt: new Date(Date.UTC(2026, 9, 1, 0, n)) })
const key = (r: ReturnType<typeof row>) => ({ occurredAt: r.occurredAt, id: r.id })

describe('pageWindow', () => {
  it('caps a page at the maximum and never goes below one', () => {
    expect(pageWindow({ first: 500 }, 50)).toEqual({ ok: true, window: { limit: 50, after: null, before: null } })
    expect(pageWindow({ first: 0 }, 50)).toMatchObject({ ok: true, window: { limit: 1 } })
    expect(pageWindow({}, 50)).toMatchObject({ ok: true, window: { limit: 50 } })
  })

  it('refuses a cursor it did not make', () => {
    expect(pageWindow({ after: 'not-a-cursor' }, 50)).toEqual({ ok: false, code: 'INVALID_CURSOR' })
    expect(pageWindow({ before: btoa('2026-10-01T00:00:00.000Z|nope') }, 50)).toEqual({ ok: false, code: 'INVALID_CURSOR' })
  })
})

describe('pageOf', () => {
  it('says another page follows when it fetched one row past the limit', () => {
    const window = { limit: 2, after: null, before: null }
    const page = pageOf([row(5), row(4), row(3)], window, key)
    expect(page.nodes.map((r) => r.id)).toEqual([id(5), id(4)])
    expect(page.pageInfo).toEqual({ startCursor: encodeCursor(key(row(5))), endCursor: encodeCursor(key(row(4))), hasPreviousPage: false, hasNextPage: true })
  })

  it('turns a backwards page round, newest first, and knows there is a newer one', () => {
    const window = { limit: 2, after: null, before: key(row(3)) }
    const page = pageOf([row(4), row(5), row(6)], window, key)
    expect(page.nodes.map((r) => r.id)).toEqual([id(5), id(4)])
    expect(page.pageInfo.hasPreviousPage).toBe(true)
    expect(page.pageInfo.hasNextPage).toBe(true)
  })

  it('gives an empty page null cursors', () => {
    expect(pageOf([], { limit: 50, after: null, before: null }, key).pageInfo).toEqual({ startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false })
  })
})
