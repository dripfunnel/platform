import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cleanContent, ContentInvalid, contentPath, namedIn, pathHolder, reservedPathSegments, slugOf } from './rules'

const held = { customPaths: ['/Our-Story/', '/lookbook-spring'], languages: ['en-IN', 'hi-IN'], marketPrefixes: ['us'] }

describe('the one namespace of a store’s paths (storefront ARCHITECTURE §3.1)', () => {
  it('keeps core’s reserved segments as storefront-core has them', () => {
    const core = readFileSync(new URL('../../../../../../packages/storefront-core/src/contracts/routes.ts', import.meta.url), 'utf8')
    const list = /reservedPathSegments: readonly string\[\] = \[([^\]]*)\]/.exec(core)?.[1] ?? ''
    expect([...list.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual(reservedPathSegments)
  })

  it('names what holds a page’s path, and leaves a free one free', () => {
    expect(pathHolder('page', 'cart', held)).toBe('core')
    expect(pathHolder('page', 'blog', held)).toBe('core')
    expect(pathHolder('page', 'en', held)).toBe('language')
    expect(pathHolder('page', 'hi-in', held)).toBe('language')
    expect(pathHolder('page', 'us', held)).toBe('market')
    expect(pathHolder('page', 'our-story', held)).toBe('custom_page')
    expect(pathHolder('page', 'faq', held)).toBeNull()
    // A post lives under core's /blog, which no custom page may start with.
    expect(pathHolder('post', 'cart', held)).toBeNull()
    expect(pathHolder('post', 'our-story', { ...held, customPaths: ['/blog/our-story'] })).toBe('custom_page')
    expect(contentPath('post', 'caring-for-linen')).toBe('/blog/caring-for-linen')
  })
})

describe('a page or post before it is written', () => {
  it('makes an address from the title', () => {
    expect(slugOf('Caring for Linen!')).toBe('caring-for-linen')
    expect(slugOf('Café — été')).toBe('cafe-ete')
    expect(slugOf('x'.repeat(150))).toHaveLength(100)
  })

  it('takes only what its kind has', () => {
    const invalid = (kind: 'page' | 'post', input: unknown) => {
      try {
        cleanContent(kind, input)
        return null
      } catch (error) {
        return error instanceof ContentInvalid ? error.field : 'thrown'
      }
    }
    const base = { title: 'About', body: [], publish: true }
    expect(invalid('page', { ...base, author: 'Priya' })).toBe('kind')
    expect(invalid('page', { ...base, publishAt: '2026-10-12T00:00:00Z' })).toBe('kind')
    expect(invalid('post', { ...base, inMenu: true })).toBe('kind')
    expect(invalid('post', { ...base, body: [{ kind: 'form' }] })).toBe('kind')
    expect(invalid('page', { ...base, body: [{ kind: 'heading', text: 'x', extra: 1 }] })).toBe('body.0')
    expect(invalid('page', { ...base, slug: 'Not A Slug' })).toBe('slug')
    expect(invalid('page', { ...base, title: '!!!' })).toBe('slug')
    expect(invalid('page', { ...base, colour: 'red' })).toBe('input')
    expect(cleanContent('post', { ...base, tags: ['fall', 'fall', ' capsule '], seoTitle: '  ' })).toMatchObject({ slug: 'about', tags: ['fall', 'capsule'], seoTitle: null })
  })

  it('lists each file and product a body names once', () => {
    const a = '00000000-0000-4000-8000-00000000000a'
    const p = '00000000-0000-4000-8000-00000000000b'
    expect(namedIn([{ kind: 'image', assetId: a, alt: '' }, { kind: 'products', productIds: [p, p] }], a)).toEqual({ assetIds: [a], productIds: [p] })
  })
})
