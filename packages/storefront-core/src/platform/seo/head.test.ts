// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { applyHead, mergedHead } from './head'

describe('the head', () => {
  it("puts a page's fields over the store's whatever order they came in, and keeps any noindex", () => {
    const merged = mergedHead([
      { level: 1, head: { title: 'Linen', canonical: '/collections/linen/' } },
      { level: 0, head: { title: 'Juniper', description: 'Clothes', hidden: true } },
      { level: 1, head: { hidden: false, description: null } },
    ])
    expect(merged).toEqual({ title: 'Linen', description: 'Clothes', canonical: '/collections/linen/', hidden: true })
  })

  it('writes the title, description, Open Graph and canonical, and never a canonical on a hidden page', () => {
    applyHead(document, { title: 'Linen', description: 'All linen', canonical: '/collections/linen/' }, 'https://shop.example')
    expect(document.title).toBe('Linen')
    expect(document.head.querySelector('meta[property="og:description"]')?.getAttribute('content')).toBe('All linen')
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://shop.example/collections/linen/')
    applyHead(document, { title: 'Search', hidden: true }, 'https://shop.example')
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull()
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow')
    expect(document.head.querySelector('meta[name="description"]')).toBeNull()
  })
})
