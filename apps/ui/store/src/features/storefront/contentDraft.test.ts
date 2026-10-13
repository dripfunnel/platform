import { describe, expect, it } from 'vitest'
import { fill, messages } from '../../messages'
import { cleanSlug, draftOf, draftProblem, inputOf, moveBlock, newBlock, pathOf, pathTakenText, schedules, slugShown } from './contentDraft'

const t = messages.storefront.content.taken
const none = () => null

describe('a page’s web address', () => {
  it('takes only what the API’s slug allows', () => {
    expect(cleanSlug('Our Story!')).toBe('ourstory')
    expect(cleanSlug('our--story')).toBe('our-story')
    expect(cleanSlug('x'.repeat(120))).toHaveLength(100)
  })

  it('is the title’s until one is typed, without hyphens at either end', () => {
    expect(slugShown({ title: 'Caring for Linen', slug: '' })).toBe('caring-for-linen')
    expect(slugShown({ title: 'Caring for Linen', slug: '-care-' })).toBe('care')
  })

  it('lives at the top level for a page and under /blog for a post', () => {
    expect(pathOf('page', 'faq')).toBe('/faq')
    expect(pathOf('post', 'linen')).toBe('/blog/linen')
  })
})

describe('the input', () => {
  it('sends each block with its own fields only, and leaves out a photo not uploaded', () => {
    const draft = { ...draftOf(null), title: ' FAQ ', seoTitle: '  ', body: [newBlock('heading', { text: 'Hi' }), newBlock('image'), newBlock('faq', { items: [{ question: 'Q', answer: 'A' }] }), newBlock('products', { productIds: ['p1'] }), newBlock('form')] }
    expect(inputOf('page', draft, false)).toEqual({
      title: 'FAQ',
      slug: 'faq',
      body: [{ kind: 'heading', text: 'Hi' }, { kind: 'faq', items: [{ question: 'Q', answer: 'A' }] }, { kind: 'products', productIds: ['p1'] }, { kind: 'form' }],
      seoTitle: null,
      seoDescription: null,
      publish: false,
      inMenu: false,
    })
  })

  it('needs a title, an address and search words within their limits', () => {
    expect(draftProblem(draftOf(null))?.field).toBe('title')
    expect(draftProblem({ ...draftOf(null), title: '!!!' })?.field).toBe('slug')
    expect(draftProblem({ ...draftOf(null), title: 'A', seoDescription: 'x'.repeat(161) })?.field).toBe('seo')
    expect(draftProblem({ ...draftOf(null), title: 'A' })).toBeNull()
    const dated = { ...draftOf(null, 'post'), title: 'A', publishAt: '2026-09-14T09:00:00.000Z', publishDate: '' }
    expect(draftProblem(dated)?.field).toBe('date')
    expect(draftProblem({ ...dated, publishAt: null })).toBeNull()
  })

  it('moves a block one place', () => {
    const [a, b, c] = [newBlock('heading'), newBlock('text'), newBlock('form')]
    expect(moveBlock([a, b, c], 2, -1).map((x) => x.kind)).toEqual(['heading', 'form', 'text'])
    expect(moveBlock([a, b, c], 0, 1).map((x) => x.kind)).toEqual(['text', 'heading', 'form'])
  })
})

describe('a post’s day', () => {
  it('schedules only a day after today in UTC', () => {
    const now = new Date('2026-10-13T23:30:00Z')
    expect(schedules({ publishDate: '2026-10-14' }, now)).toBe(true)
    expect(schedules({ publishDate: '2026-10-13' }, now)).toBe(false)
    expect(schedules({ publishDate: '' }, now)).toBe(false)
  })

  it('sends the instant read while the day is unchanged, a picked day’s start otherwise, and nothing while empty', () => {
    const draft = { ...draftOf(null, 'post'), title: 'Notes', publishAt: '2026-09-14T09:00:00.000Z', publishDate: '2026-09-14' }
    expect(inputOf('post', draft, true).publishAt).toBe('2026-09-14T09:00:00.000Z')
    expect(inputOf('post', { ...draft, publishDate: '2026-09-20' }, true).publishAt).toBe('2026-09-20T00:00:00.000Z')
    expect(inputOf('post', { ...draft, publishDate: '' }, true)).not.toHaveProperty('publishAt')
    expect(inputOf('post', draft, true)).not.toHaveProperty('inMenu')
  })
})

describe('a clash', () => {
  it('names what holds the address', () => {
    expect(pathTakenText({ path: '/cart', heldBy: 'core' }, none)).toBe(fill(t.coreLine, { path: '/cart', what: t.core.cart }))
    expect(pathTakenText({ path: '/sitemap', heldBy: 'core' }, none)).toBe(fill(t.coreOther, { path: '/sitemap' }))
    expect(pathTakenText({ path: '/about', heldBy: 'custom_page' }, none)).toBe(fill(t.custom, { path: '/about' }))
    expect(pathTakenText({ path: '/hi', heldBy: 'language' }, none)).toBe(fill(t.language, { path: '/hi', language: 'Hindi' }))
    expect(pathTakenText({ path: '/eu', heldBy: 'market' }, none)).toBe(fill(t.market, { path: '/eu' }))
    expect(pathTakenText({ path: '/faq', heldBy: 'content_page' }, () => 'FAQ')).toBe(fill(t.page.named, { path: '/faq', title: 'FAQ' }))
    expect(pathTakenText({ path: '/blog/linen', heldBy: 'blog_post' }, none)).toBe(fill(t.post.unnamed, { path: '/blog/linen' }))
  })
})
