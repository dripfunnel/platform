import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { basics, chrome, previewOrigin, startPreview, type Preview, type ShopRequest } from './test/preview'

// Card #324: the baseline theme's content pages and blog in preview mode, from SAPI 24's answers.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const block = (b: Record<string, unknown>) => ({ text: null, alt: null, image: null, items: null, productSlugs: null, ...b })
const post = (n: number) => ({ title: `Why linen, part ${n}`, path: `/blog/why-linen-${n}`, slug: `why-linen-${n}`, author: 'Maya', publishedAt: '2026-10-01T10:00:00Z', tags: ['linen'], seoTitle: null, seoDescription: null, cover: null, body: [block({ kind: 'text', text: 'It breathes, and it lasts.' })] })

const answer = (asked: ShopRequest[]) => (r: ShopRequest): unknown => {
  asked.push(r)
  if (r.query.startsWith('query ContentPage')) return { data: { contentPage: r.variables['slug'] === 'faq' ? { title: 'Questions we get asked', path: '/faq', slug: 'faq', seoTitle: null, seoDescription: null, updatedAt: null, body: [block({ kind: 'text', text: 'Here is what shoppers ask most.' }), block({ kind: 'faq', items: [{ question: 'Do you ship abroad?', answer: 'Yes, to 30 countries.' }] }), block({ kind: 'form' })] } : null } }
  if (r.query.startsWith('query Blog(')) return { data: { blogPosts: { nodes: r.variables['after'] ? [post(3)] : [post(1), post(2)], pageInfo: { hasNextPage: !r.variables['after'], endCursor: r.variables['after'] ? null : 'c1' } } } }
  if (r.query.startsWith('query BlogPost')) return { data: { blogPost: r.variables['slug'] === 'why-linen-1' ? post(1) : null } }
  return basics(r)
}

let preview: Preview | null = null
beforeAll(async () => {
  if (chrome) preview = await startPreview()
})
afterAll(async () => preview?.close())

describe.skipIf(!chrome)('the baseline theme’s content pages and blog', () => {
  it('shows a content page at its slug with its questions that open, and the 404 words for one the store hasn’t got', async () => {
    if (!preview) throw new Error('no browser')
    const asked: ShopRequest[] = []
    const context = await preview.open(answer(asked), 390)
    try {
      const page = await context.newPage()
      await page.goto(`${previewOrigin}/faq/`)
      await page.getByRole('heading', { level: 1, name: 'Questions we get asked' }).waitFor()
      await page.getByText('Here is what shoppers ask most.').waitFor()
      const question = page.getByRole('button', { name: 'Do you ship abroad?' })
      expect(await question.getAttribute('aria-expanded')).toBe('false')
      await question.click()
      await page.getByText('Yes, to 30 countries.').waitFor()
      await page.goto(`${previewOrigin}/lookbook/`)
      await page.getByRole('heading', { level: 1, name: 'We can’t find that page' }).waitFor()
    } finally {
      await context.close()
    }
  })

  it('lists the journal’s posts with older ones on request, and opens a post with its tags', async () => {
    if (!preview) throw new Error('no browser')
    const asked: ShopRequest[] = []
    const context = await preview.open(answer(asked))
    try {
      const page = await context.newPage()
      await page.goto(`${previewOrigin}/blog/`)
      await page.getByRole('heading', { level: 1, name: 'From the journal' }).waitFor()
      await page.getByRole('heading', { name: 'Why linen, part 2' }).waitFor()
      await page.getByRole('button', { name: 'Older posts' }).click()
      await page.getByRole('heading', { name: 'Why linen, part 3' }).waitFor()
      expect(await page.getByRole('button', { name: 'Older posts' }).count()).toBe(0)
      await page.getByRole('link', { name: /Why linen, part 1/ }).click()
      await page.waitForURL(`${previewOrigin}/blog/why-linen-1/`)
      await page.getByRole('heading', { level: 1, name: 'Why linen, part 1' }).waitFor()
      await page.getByText('October 1, 2026 · by Maya').waitFor()
      expect(await page.getByRole('link', { name: 'linen', exact: true }).getAttribute('href')).toBe('/blog/?tag=linen')
    } finally {
      await context.close()
    }
  })
})
