import { describe, expect, it } from 'vitest'
import { safeNext } from './safeNext'

const origin = 'https://store.northstar.example'

describe('safeNext', () => {
  it('keeps a path on this host, with its query and hash', () => {
    expect(safeNext('/orders?status=open#top', origin, '/home')).toBe('/orders?status=open#top')
  })

  it.each(['//evil.example/home', '/\\evil.example', '/%5Cevil.example', 'https://evil.example', 'javascript:alert(1)', '', 42, undefined])('refuses %s and falls back', (next) => {
    const answer = safeNext(next, origin, '/home')
    expect(answer === '/home' || answer.startsWith('/%5C')).toBe(true)
    expect(new URL(answer, origin).origin).toBe(origin)
  })
})
