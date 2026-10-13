// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Provided, shopAnswering } from '../../test/shop'
import { useBlog, useBlogPost, useContentPage, useProductCards, type BlogPostView, type BlogView, type ContentPageView } from './content'

let seen: unknown = null
const probe = (hook: () => unknown) => {
  const Probe = () => {
    seen = hook()
    return null
  }
  return Probe
}
const show = async (address: string, hook: () => unknown) => {
  history.replaceState(null, '', address)
  const Probe = probe(hook)
  render(
    <Provided>
      <Probe />
    </Provided>,
  )
  await act(async () => undefined)
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
  seen = null
})

const body = [
  { kind: 'heading', text: 'Sizing', alt: null, image: null, items: null, productSlugs: null },
  { kind: 'text', text: 'Our shirts run true to size.', alt: null, image: null, items: null, productSlugs: null },
  { kind: 'image', text: null, alt: 'The studio', image: { url: 'https://media.example/a.jpg' }, items: null, productSlugs: null },
  { kind: 'faq', text: null, alt: null, image: null, items: [{ question: 'Do you ship abroad?', answer: 'Yes.' }, { question: '', answer: 'dropped' }], productSlugs: null },
  { kind: 'products', text: null, alt: null, image: null, items: null, productSlugs: ['tee'] },
  { kind: 'form', text: null, alt: null, image: null, items: null, productSlugs: null },
  { kind: 'video', text: 'unknown kind', alt: null, image: null, items: null, productSlugs: null },
  { kind: 'text', text: '', alt: null, image: null, items: null, productSlugs: null },
]

describe('useContentPage', () => {
  it('reads the page its one segment names, its blocks as core knows them, with its head', async () => {
    const asked = shopAnswering(() => ({ data: { contentPage: { title: 'Questions', path: '/faq', slug: 'faq', seoTitle: 'FAQ', seoDescription: 'What shoppers ask.', updatedAt: '2026-10-10T00:00:00Z', body } } }))
    await show('/faq/', useContentPage)
    expect(asked[0]?.variables).toEqual({ slug: 'faq' })
    const view = seen as ContentPageView
    expect(view.status).toBe('ready')
    expect(view.page?.body.map((b) => b.kind)).toEqual(['heading', 'text', 'image', 'faq', 'products', 'form'])
    expect(view.page?.body[3]).toEqual({ kind: 'faq', items: [{ question: 'Do you ship abroad?', answer: 'Yes.' }] })
    expect(document.title).toContain('FAQ')
  })

  it('is missing for a page the store hasn’t got, and for an address that is no slug, asking nothing then', async () => {
    shopAnswering(() => ({ data: { contentPage: null } }))
    await show('/lookbook/', useContentPage)
    expect((seen as ContentPageView).status).toBe('missing')
    cleanup()
    vi.unstubAllGlobals()
    const asked = shopAnswering(() => ({ data: {} }))
    await show('/Not_A_Slug/', useContentPage)
    expect((seen as ContentPageView).status).toBe('missing')
    expect(asked).toHaveLength(0)
  })
})

const post = (n: number, extra: Record<string, unknown> = {}) => ({ title: `Post ${n}`, path: `/blog/post-${n}`, slug: `post-${n}`, author: 'Maya', publishedAt: '2026-10-01T10:00:00Z', tags: ['linen'], seoTitle: null, seoDescription: null, cover: { url: `https://media.example/${n}.jpg` }, body: [{ kind: 'text', text: 'word '.repeat(60), alt: null, image: null, items: null, productSlugs: null }], ...extra })

describe('useBlog and useBlogPost', () => {
  it('lists the newest posts, dated in the store’s time zone with an excerpt cut at a word, and adds older ones', async () => {
    const asked = shopAnswering((a) => (a.variables['after'] ? { data: { blogPosts: { nodes: [post(3)], pageInfo: { hasNextPage: false, endCursor: 'c2' } } } } : { data: { blogPosts: { nodes: [post(1), post(2)], pageInfo: { hasNextPage: true, endCursor: 'c1' } } } }))
    await show('/blog/', useBlog)
    let blog = seen as BlogView
    expect(blog.posts.map((p) => p.title)).toEqual(['Post 1', 'Post 2'])
    expect(blog.posts[0]).toMatchObject({ path: '/blog/post-1', author: 'Maya', published: 'October 1, 2026', tags: [{ name: 'linen', href: '/blog/?tag=linen' }] })
    expect(blog.posts[0]?.excerpt?.endsWith('…')).toBe(true)
    expect((blog.posts[0]?.excerpt ?? '').length).toBeLessThanOrEqual(181)
    expect(blog.more).toBe(true)
    await act(async () => blog.loadMore())
    blog = seen as BlogView
    expect(blog.posts.map((p) => p.title)).toEqual(['Post 1', 'Post 2', 'Post 3'])
    expect(blog.more).toBe(false)
    expect(asked.map((a) => a.variables)).toEqual([{ first: 12, after: null, tag: null }, { first: 12, after: 'c1', tag: null }])
  })

  it('narrows the list to ?tag=, and reads the post its address names under /blog/', async () => {
    const asked = shopAnswering((a) => (a.query.includes('blogPost(') ? { data: { blogPost: post(7, { seoTitle: 'Seven' }) } } : { data: { blogPosts: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }))
    await show('/blog/?tag=linen', useBlog)
    expect((seen as BlogView).tag).toBe('linen')
    expect(asked[0]?.variables).toMatchObject({ tag: 'linen' })
    cleanup()
    await show('/blog/post-7/', useBlogPost)
    const view = seen as BlogPostView
    expect(asked.find((a) => a.query.includes('blogPost('))?.variables).toEqual({ slug: 'post-7' })
    expect(view.post).toMatchObject({ title: 'Post 7', cover: { url: 'https://media.example/7.jpg' } })
    expect(document.title).toContain('Seven')
  })
})

describe('useProductCards', () => {
  it('asks for every slug in one request and keeps the ones the store still sells, in order', async () => {
    const usd = (n: number) => ({ amount: String(n), currency: 'USD' })
    const card = (slug: string) => ({ id: slug, name: slug.toUpperCase(), slug, inStock: true, price: usd(2800), compareAt: null, maxPrice: null, photos: [{ alt: 'front', image: { url: `https://media.example/${slug}.jpg` } }], badges: [] })
    const asked = shopAnswering(() => ({ data: { p0: card('tee'), p1: null, p2: card('cap') } }))
    await show('/faq/', () => useProductCards(['tee', 'gone', 'cap']))
    expect(asked).toHaveLength(1)
    expect(asked[0]?.variables).toEqual({ s0: 'tee', s1: 'gone', s2: 'cap' })
    const { cards } = seen as ReturnType<typeof useProductCards>
    expect(cards.map((c) => [c.name, c.href, c.photo?.url])).toEqual([
      ['TEE', '/products/tee/', 'https://media.example/tee.jpg'],
      ['CAP', '/products/cap/', 'https://media.example/cap.jpg'],
    ])
  })

  it('leaves out a product the schema refuses, keeping the rest', async () => {
    const usd = (n: number) => ({ amount: String(n), currency: 'USD' })
    shopAnswering(() => ({ data: { p0: { id: 'tee', name: 'Tee', slug: 'tee', inStock: true, price: usd(2800), compareAt: null, maxPrice: null, photos: [], badges: [] }, p1: { id: 'odd', name: 'Odd', slug: 'odd', inStock: 'maybe', price: { amount: '28.00', currency: 'USD' }, photos: [], badges: [] } } }))
    await show('/faq/', () => useProductCards(['tee', 'odd']))
    expect((seen as ReturnType<typeof useProductCards>).cards.map((c) => c.name)).toEqual(['Tee'])
  })
})

describe('the blog when the Shop API misbehaves', () => {
  it('gives each tag an encoded address, shows a malformed date as none, and says when older posts didn’t load', async () => {
    let fail = true
    shopAnswering((a) =>
      a.variables['after']
        ? fail
          ? { errors: [{ message: 'down', extensions: { code: 'UNAVAILABLE' } }] }
          : { data: { blogPosts: { nodes: [post(9)], pageInfo: { hasNextPage: false, endCursor: null } } } }
        : { data: { blogPosts: { nodes: [post(1, { publishedAt: 'not a date', tags: ['news & offers', 'c#'] })], pageInfo: { hasNextPage: true, endCursor: 'c1' } } } },
    )
    await show('/blog/', useBlog)
    let blog = seen as BlogView
    expect(blog.posts[0]?.published).toBeNull()
    expect(blog.posts[0]?.tags).toEqual([{ name: 'news & offers', href: '/blog/?tag=news%20%26%20offers' }, { name: 'c#', href: '/blog/?tag=c%23' }])
    await act(async () => blog.loadMore())
    blog = seen as BlogView
    expect(blog.loadMoreFailed).toBe(true)
    expect(blog.more).toBe(true)
    fail = false
    await act(async () => blog.loadMore())
    blog = seen as BlogView
    expect(blog.loadMoreFailed).toBe(false)
    expect(blog.posts.map((p) => p.title)).toEqual(['Post 1', 'Post 9'])
  })
})
