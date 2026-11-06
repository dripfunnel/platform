import { describe, expect, it } from 'vitest'
import { idParam } from '@dripfunnel/shared/search'
import { cursorParam } from './rolloutSearch'

describe('cursorParam', () => {
  it('keeps a page cursor longer than an id, which idParam would drop', () => {
    const cursor = btoa('2026-11-02T06:30:47.699Z|f477af24-ed09-47c7-b649-710a098fa2fe').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    expect(cursor.length).toBeGreaterThan(64)
    expect(idParam.parse(cursor)).toBeUndefined()
    expect(cursorParam.parse(cursor)).toBe(cursor)
  })

  it('drops anything that is not base64url', () => {
    expect(cursorParam.parse('a b')).toBeUndefined()
    expect(cursorParam.parse('x'.repeat(1025))).toBeUndefined()
  })
})
