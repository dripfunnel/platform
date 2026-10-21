import { describe, expect, it } from 'vitest'
import { catalogueSnapshotSchema } from '@dripfunnel/storefront-core/guard'
import { edgeRules, pageDocument, plan, sitemap } from './pages'

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

  it('writes a post’s own page in the main language only, leaving another language’s to the posts’ page, which reads its words', () => {
    const pages = plan({ routes: { ...core, blogPost: 'BlogPostPage' } }, store, ['/blog/why-linen'], ['/blog/why-linen'])
    expect(pages.filter((p) => p.route === 'blogPost').map((p) => [p.path, p.language])).toEqual([
      ['/_fallback/blogPost/', 'en'],
      ['/blog/why-linen/', 'en'],
      ['/hi/_fallback/blogPost/', 'hi'],
    ])
    expect(edgeRules(pages, store).fallbacks).toContainEqual({ prefix: '/hi/blog/', page: '/hi/_fallback/blogPost/' })
  })

  it('gives each published post its own page, listed in the sitemap, whose HTML carries its head and Article data', () => {
    const snapshot = catalogueSnapshotSchema.parse({
      version: 1,
      origin: 'https://shop.juniper.example',
      store: { ...store, languages: ['en'] },
      poweredBy: null,
      guard: { locales: ['en'], usedPaths: ['/blog/why-linen'], mediaIds: [], brand: { name: 'Juniper & Co.', tagline: null, email: null, phone: null, address: [], socialLinks: [] } },
      csp: { assetOrigin: null, mediaOrigins: [], analytics: [], payments: [] },
      posts: [{ path: '/blog/why-linen', title: 'Why linen </script>', seoTitle: null, seoDescription: 'It breathes.', author: 'Maya', publishedAt: '2026-10-01T10:00:00.000Z', image: { url: '/shop-api/assets/a1' } }],
      assetBase: null,
    })
    const pages = plan({ routes: { ...core, blogPost: 'BlogPostPage' } }, snapshot.store, snapshot.guard.usedPaths, snapshot.posts.map((p) => p.path))
    const page = pages.find((p) => p.path === '/blog/why-linen/')
    expect(page).toEqual({ path: '/blog/why-linen/', route: 'blogPost', language: 'en', custom: null })
    expect(sitemap(pages, snapshot.origin)).toContain('<loc>https://shop.juniper.example/blog/why-linen/</loc>')
    if (!page) throw new Error('no post page')
    const html = pageDocument(page, snapshot, { body: '', assets: { entry: 'e.js', css: [] }, dir: 'ltr', store: snapshot.store })
    expect(html).toContain('<title>Why linen &lt;/script&gt; · Juniper &amp; Co.</title>')
    expect(html).toContain('<meta name="description" content="It breathes.">')
    expect(html).toContain('<meta property="og:type" content="article">')
    expect(html).toContain('<link rel="canonical" href="https://shop.juniper.example/blog/why-linen/">')
    const ld = /<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)?.[1] ?? '{}'
    expect(ld).not.toContain('</script>')
    expect(JSON.parse(ld)).toEqual({ '@context': 'https://schema.org', '@type': 'Article', headline: 'Why linen </script>', mainEntityOfPage: 'https://shop.juniper.example/blog/why-linen/', publisher: { '@type': 'Organization', name: 'Juniper & Co.' }, datePublished: '2026-10-01T10:00:00.000Z', author: { '@type': 'Person', name: 'Maya' }, image: 'https://shop.juniper.example/shop-api/assets/a1' })
  })
})
