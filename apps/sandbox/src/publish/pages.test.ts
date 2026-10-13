import { describe, expect, it } from 'vitest'
import { edgeRules, plan } from './pages'

// Card #324: the build plans a page for each of the store's content pages, and the blog's, once the theme maps them.

const store = { name: 'Juniper & Co.', description: null, language: 'en', mainLanguage: 'en', languages: ['en', 'hi'], currency: 'USD', pricingCurrency: 'USD', currencies: [{ code: 'USD' }], pricesIncludeTax: false, timeZone: 'UTC', contactEmail: null, contactPhone: null, logo: null, address: null, favicon: null, tagline: null, social: [], seo: null }
const core = { home: 'HomePage', notFound: 'NotFoundPage' }

describe('the build’s page plan', () => {
  it('gives each content page its own page in every language, and the blog its page and post fallback', () => {
    const pages = plan({ routes: { ...core, contentPage: 'ContentPage', blog: 'BlogPage', blogPost: 'BlogPostPage' } }, store, ['/faq', '/lookbook', '/blog/why-linen', '/Not_Valid'])
    const paths = (route: string) => pages.filter((p) => p.route === route).map((p) => p.path)
    expect(paths('contentPage')).toEqual(['/faq/', '/lookbook/', '/hi/faq/', '/hi/lookbook/'])
    expect(paths('blog')).toEqual(['/blog/', '/hi/blog/'])
    expect(paths('blogPost')).toEqual(['/_fallback/blogPost/', '/hi/_fallback/blogPost/'])
    expect(edgeRules(pages, store).fallbacks).toEqual(expect.arrayContaining([{ prefix: '/blog/', page: '/_fallback/blogPost/' }, { prefix: '/hi/blog/', page: '/hi/_fallback/blogPost/' }]))
  })

  it('plans none of them for a theme that doesn’t map them', () => {
    const pages = plan({ routes: core }, store, ['/faq'])
    expect(pages.some((p) => p.route === 'contentPage' || p.route === 'blog' || p.route === 'blogPost')).toBe(false)
  })
})
