import { describe, expect, it } from 'vitest'
import { decodeCursor, decodeValueCursor, encodeCursor, encodeValueCursor } from './cursor'

describe('keyset cursors', () => {
  const key = { occurredAt: new Date('2026-10-02T09:00:00.123Z'), id: '0d1c9f2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f' }

  it('round-trip, as a URL-safe string', () => {
    const cursor = encodeCursor(key)
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeCursor(cursor)).toEqual(key)
  })

  it('refuse anything that is not one of ours', () => {
    for (const bad of ['', 'not base64!', btoa('only-one-part'), btoa('2026-10-02T09:00:00Z|not-a-uuid'), btoa('nonsense|' + key.id), btoa(`x|${key.id}|extra`)]) {
      expect([bad, decodeCursor(bad)]).toEqual([bad, null])
    }
  })
})

describe('value cursors', () => {
  it('carry a sort value and id back for the same sort, names with any text included', () => {
    const id = '00000000-0000-4000-8000-000000000001'
    const cursor = encodeValueCursor({ sort: 'name', value: 'linen | कुर्ता', id })
    expect(decodeValueCursor(cursor, 'name')).toEqual({ sort: 'name', value: 'linen | कुर्ता', id })
  })

  it('refuse another sort’s cursor, a time cursor and anything made up', () => {
    const id = '00000000-0000-4000-8000-000000000001'
    expect(decodeValueCursor(encodeValueCursor({ sort: 'name', value: 'x', id }), 'stock')).toBeNull()
    expect(decodeValueCursor(encodeCursor({ occurredAt: new Date(), id }), 'name')).toBeNull()
    expect(decodeValueCursor('not-a-cursor', 'name')).toBeNull()
  })
})
