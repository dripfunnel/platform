import { describe, expect, it } from 'vitest'
import { safeNext } from './safeNext'

const origin = 'https://store.northstar.example'

describe('safeNext', () => {
  it('keeps a path on this host, with its query and hash', () => {
    expect(safeNext('/orders?status=open#top', origin, '/home')).toBe('/orders?status=open#top')
  })

  it.each(['//evil.example/home', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '', 42, undefined])('refuses %s with exactly the fallback', (next) => {
    expect(safeNext(next, origin, '/home')).toBe('/home')
  })

  it('keeps an encoded backslash as a path on this host, which the browser never reads as a host', () => {
    expect(safeNext('/%5Cevil.example', origin, '/home')).toBe('/%5Cevil.example')
  })
})
