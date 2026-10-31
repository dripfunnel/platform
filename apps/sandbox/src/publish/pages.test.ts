import { describe, expect, it } from 'vitest'
import { catalogueSnapshotSchema } from '@dripfunnel/storefront-core/guard'
import { checkedPages, edgeRules, itemFacts, pageDocument, plan, sitemap } from './pages'

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

// Card #1011: with the catalogue in the snapshot, each product, version and collection gets its own page.
describe('the catalogue’s pages', () => {
  const catalogue = {
    answers: [
      { operation: 'Product', variables: { slug: 'linen-shirt' }, data: { product: { name: 'Linen shirt <b>', seoTitle: null, seoDescription: null, description: 'Soft.', inStock: true, price: { amount: '249900', currency: 'INR' }, photos: [{ image: { url: '/shop-api/assets/p1' } }] } } },
      { operation: 'Collection', variables: { slug: 'summer' }, data: { collection: { name: 'Summer', seoTitle: 'Summer linen', seoDescription: null, description: 'Light.' } } },
    ],
    products: [
      { slug: 'linen-shirt', versions: ['v1', 'v2'] },
      { slug: 'kurta', versions: [] },
    ],
    collections: [{ slug: 'summer' }],
  }
  const routes = { routes: { ...core, product: 'ProductPage', collection: 'CollectionPage' } }

  it('plans each product, its versions and each collection, plus every product’s collection, in the main language only', () => {
    const pages = plan(routes, store, [], [], catalogue)
    const paths = (route: string) => pages.filter((p) => p.route === route).map((p) => p.path)
    expect(paths('product')).toEqual(['/_fallback/product/', '/products/linen-shirt/', '/products/linen-shirt/v1/', '/products/linen-shirt/v2/', '/products/kurta/', '/hi/_fallback/product/'])
    expect(paths('collection')).toEqual(['/_fallback/collection/', '/collections/summer/', '/collections/all/', '/hi/_fallback/collection/'])
    expect(sitemap(pages, 'https://shop.juniper.example')).toContain('<loc>https://shop.juniper.example/products/kurta/</loc>')
    expect(sitemap(pages, 'https://shop.juniper.example')).not.toContain('/products/linen-shirt/v1/')
  })

  it('plans no item pages without a catalogue or for a theme that doesn’t map the route', () => {
    expect(plan(routes, store).some((p) => p.path.startsWith('/products/'))).toBe(false)
    expect(plan({ routes: core }, store, [], [], catalogue).some((p) => p.path.startsWith('/products/') || p.path.startsWith('/collections/'))).toBe(false)
  })

  it('checks every page but the items past the first few of each route', () => {
    const checked = checkedPages(plan(routes, store, [], [], catalogue)).map((p) => p.path)
    expect(checked).toContain('/_fallback/product/')
    expect(checked.filter((p) => p.startsWith('/products/'))).toEqual(['/products/linen-shirt/', '/products/linen-shirt/v1/'])
    expect(checked.filter((p) => p.startsWith('/collections/'))).toEqual(['/collections/summer/', '/collections/all/'])
  })

  it('writes a product’s head from its recorded answer, canonical to the product, and its answers for hydration', () => {
    const snapshot = catalogueSnapshotSchema.parse({
      version: 2,
      origin: 'https://shop.juniper.example',
      store: { ...store, languages: ['en'] },
      poweredBy: null,
      guard: { locales: ['en'], usedPaths: [], mediaIds: [], brand: { name: 'Juniper & Co.', tagline: null, email: null, phone: null, address: [], socialLinks: [] } },
      csp: { assetOrigin: null, mediaOrigins: [], analytics: [], payments: [] },
      catalogue,
      assetBase: null,
    })
    const page = { path: '/products/linen-shirt/v2/', route: 'product', language: 'en', custom: null } as const
    const html = pageDocument(page, snapshot, { body: '', assets: { entry: 'e.js', css: [] }, dir: 'ltr', store: snapshot.store, answers: { '["product","linen-shirt"]': { name: '</script>' } } })
    expect(html).toContain('<title>Linen shirt &lt;b&gt;</title>')
    expect(html).toContain('<meta name="description" content="Soft.">')
    expect(html).toContain('<meta property="og:type" content="product">')
    expect(html).toContain('<link rel="canonical" href="https://shop.juniper.example/products/linen-shirt/">')
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)?.[1] ?? '{}') as { offers?: { price?: string } }
    expect(ld.offers?.price).toBe('2499.00')
    const live = /<script type="application\/json" id="df-page">(.*?)<\/script>/.exec(html)?.[1] ?? ''
    expect(live).not.toContain('</script>')
    expect((JSON.parse(live) as { answers: unknown }).answers).toEqual({ '["product","linen-shirt"]': { name: '</script>' } })

    const collection = pageDocument({ path: '/collections/summer/', route: 'collection', language: 'en', custom: null }, snapshot, { body: '', assets: { entry: 'e.js', css: [] }, dir: 'ltr', store: snapshot.store })
    expect(collection).toContain('<title>Summer linen</title>')
    expect(collection).not.toContain('"answers"')
  })
it('says what each product page shows for the gate: the price its address names and its market’s legal notices', () => {
    const answers = [
      { operation: 'Product', variables: { slug: 'shirt' }, data: { product: { price: { amount: '100', currency: 'USD' }, versions: [{ id: 'v1', price: null }, { id: 'v2', price: { amount: '100', currency: 'USD' } }], compliance: [{ region: 'IN', field: 'origin', value: 'India' }] }, store: { marketId: 'm1', markets: [{ id: 'm1', countries: ['IN'] }] } } },
      { operation: 'Product', variables: { slug: 'gift' }, data: { product: { price: null, versions: [], compliance: [{ region: 'US', field: 'care', value: 'Dry' }] }, store: { marketId: 'm1', markets: [{ id: 'm1', countries: ['IN'] }] } } },
    ]
    const snapshot = catalogueSnapshotSchema.parse({
      version: 2, origin: 'https://shop.juniper.example', store: { ...store, languages: ['en'] }, poweredBy: null,
      guard: { locales: ['en'], usedPaths: [], mediaIds: [], brand: { name: 'Juniper & Co.', tagline: null, email: null, phone: null, address: [], socialLinks: [] } },
      csp: { assetOrigin: null, mediaOrigins: [], analytics: [], payments: [] }, assetBase: null,
      catalogue: { answers, products: [{ slug: 'shirt', versions: ['v1', 'v2'] }, { slug: 'gift', versions: [] }], collections: [] },
    })
    const facts = itemFacts(plan(routes, snapshot.store, [], [], snapshot.catalogue), snapshot)
    expect(Object.fromEntries(facts)).toEqual({
      '/products/shirt/': { priced: true, legal: true },
      '/products/shirt/v1/': { priced: false, legal: true },
      '/products/shirt/v2/': { priced: true, legal: true },
      '/products/gift/': { priced: false, legal: false },
    })
  })
})
