import { describe, expect, it } from 'vitest'
import { safeNext } from './next'

const origin = 'https://platform.dripfunnel.com'

describe('safeNext', () => {
  it('keeps a path on this host', () => {
    expect(safeNext('/stores?status=live#top', origin)).toBe('/stores?status=live#top')
  })

  it.each([['//evil.example/x'], ['/\\evil.example'], ['https://evil.example/'], ['javascript:alert(1)'], [''], [undefined], [42]])('replaces %s with the default', (next) => {
    expect(safeNext(next, origin)).toBe('/dashboard')
  })
})
