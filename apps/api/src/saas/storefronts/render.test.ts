import { describe, expect, it } from 'vitest'
import { mergeRender, renderRequest } from './render'

describe('a page render’s input', () => {
  it('merges two waiting renders, the later winning: a page asked for and then moved is left out', () => {
    expect(mergeRender({ pages: ['/products/mug'], drop: [] }, { pages: ['/products/blue-mug'], drop: ['/products/mug'] })).toEqual({ pages: ['/products/blue-mug'], drop: ['/products/mug'] })
    expect(mergeRender({ pages: ['/products/b'], drop: ['/products/a'] }, { pages: ['/products/a'], drop: [] })).toEqual({ pages: ['/products/b', '/products/a'], drop: [] })
  })

  it('takes plain addresses on the store’s own host only', () => {
    const ok = (pages: string[]) => renderRequest.safeParse({ storeId: '00000000-0000-4000-8000-000000000001', pages, drop: [] }).success
    expect(ok(['/', '/products/blue-mug', '/hi-in/products/x/'])).toBe(true)
    expect(ok(['//evil.example/'])).toBe(false)
    expect(ok(['/products/../x'])).toBe(false)
    expect(ok(['https://evil.example/'])).toBe(false)
    expect(ok([])).toBe(false)
  })
})
