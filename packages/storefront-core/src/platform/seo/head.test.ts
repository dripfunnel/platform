// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { applyHead, mergedHead, storeHead } from './head'

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

  it("keeps the build's canonical on the page it was written for, and drops it once the address moves on", () => {
    document.head.innerHTML = `<link rel="canonical" href="${location.origin}/about/">`
    history.replaceState(null, '', '/about/')
    applyHead(document, { title: 'About' }, location.origin)
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${location.origin}/about/`)
    history.pushState(null, '', '/cart/')
    applyHead(document, { title: 'Cart' }, location.origin)
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull()
  })

  it("writes the store's favicon, and takes it away once the store has none", () => {
    applyHead(document, { title: 'Juniper', icon: '/shop-api/assets/f1' }, 'https://shop.example')
    expect(document.head.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('/shop-api/assets/f1')
    applyHead(document, { title: 'Juniper' }, 'https://shop.example')
    expect(document.head.querySelector('link[rel="icon"]')).toBeNull()
  })

  it('leaves an unchanged favicon link alone, so the browser asks for nothing again', () => {
    applyHead(document, { title: 'Juniper', icon: '/shop-api/assets/f1' }, 'https://shop.example')
    const link = document.head.querySelector('link[rel="icon"]')
    if (!link) throw new Error('no favicon')
    let writes = 0
    new MutationObserver((records) => (writes += records.length)).observe(link, { attributes: true })
    applyHead(document, { title: 'Linen', icon: '/shop-api/assets/f1' }, 'https://shop.example')
    expect(document.head.querySelector('link[rel="icon"]')).toBe(link)
    return new Promise<void>((done) => setTimeout(() => (expect(writes).toBe(0), done())))
  })

  it("keeps the store's favicon over a page's, which useHead never passes on", () => {
    expect(mergedHead([{ level: 0, head: { icon: '/shop-api/assets/f1' } }, { level: 1, head: { title: 'Linen', icon: undefined } }]).icon).toBe('/shop-api/assets/f1')
  })
})

describe('storeHead', () => {
  it("uses the home page's search and sharing on the home page only", () => {
    const store = { name: 'Juniper', description: 'Clothes', seo: { title: 'Juniper linen', description: null, image: { url: 'https://shop.example/s.png' } }, favicon: { url: '/shop-api/assets/f1' } }
    expect(storeHead(store, '/')).toEqual({ title: 'Juniper linen', description: 'Clothes', image: 'https://shop.example/s.png', icon: '/shop-api/assets/f1' })
    expect(storeHead(store, '/about/')).toEqual({ title: 'Juniper', description: 'Clothes', image: null, icon: '/shop-api/assets/f1' })
  })
})
