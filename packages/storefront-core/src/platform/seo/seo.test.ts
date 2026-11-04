import { describe, expect, it } from 'vitest'
import { moneySchema } from '../../pricing/money'
import { jsonLdText, seoFor } from './seo'

const store = { name: 'Juniper & Co.', url: 'https://juniper.example/', logoUrl: 'https://juniper.example/logo.png' }

describe('seoFor', () => {
  it('describes the home page as the store', () => {
    const seo = seoFor({ store, url: store.url, title: store.name, description: 'Everyday clothes.', preview: false })
    expect(seo.title).toBe('Juniper & Co.')
    expect(seo.canonical).toBe(store.url)
    expect(seo.meta).toContainEqual({ name: 'description', content: 'Everyday clothes.' })
    expect(seo.jsonLd[0]).toMatchObject({ '@type': 'Organization', logo: store.logoUrl })
  })

  it('gives a product its offer at the exact price, and never indexes a preview', () => {
    const seo = seoFor({ store, url: 'https://juniper.example/products/tee', title: 'Tee', preview: true, product: { name: 'Tee', price: moneySchema.parse({ amount: '2800', currency: 'USD' }), available: false } })
    expect(seo.title).toBe('Tee · Juniper & Co.')
    expect(seo.meta).toContainEqual({ name: 'robots', content: 'noindex, nofollow' })
    expect(seo.jsonLd[0]).toMatchObject({ '@type': 'Product', offers: { price: '28.00', priceCurrency: 'USD', availability: 'https://schema.org/OutOfStock' } })
    expect(seoFor({ store, url: 'u', title: 'Y', preview: false, product: { name: 'Y', price: moneySchema.parse({ amount: '1200', currency: 'JPY' }), available: true } }).jsonLd[0]).toMatchObject({ offers: { price: '1200' } })
  })

  it('gives a product’s structured data its description as text, without the description’s tags (#1216)', () => {
    const product = { name: 'Tee', price: moneySchema.parse({ amount: '2800', currency: 'USD' }), available: true, description: '<p>Soft <strong>cotton</strong></p><ul><li>Hand wash</li></ul>' }
    expect(seoFor({ store, url: 'u', title: 'Tee', preview: false, product }).jsonLd[0]).toMatchObject({ '@type': 'Product', description: 'Soft cotton Hand wash' })
  })

  it('shares a page on Twitter and Open Graph with its locale and image alt, and passes on its alternates', () => {
    const alternates = [{ language: 'zh-Hant-TW', url: 'https://juniper.example/zh-hant-tw/' }]
    const seo = seoFor({ store, url: 'https://juniper.example/about/', title: 'About', description: 'Us.', image: 'https://media.example/a.jpg', imageAlt: 'The shop', locale: 'zh-Hant-TW', alternates, preview: false })
    expect(seo.meta).toEqual(
      expect.arrayContaining([
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: 'About' },
        { name: 'twitter:description', content: 'Us.' },
        { name: 'twitter:image', content: 'https://media.example/a.jpg' },
        { property: 'og:locale', content: 'zh_Hant_TW' },
        { property: 'og:image:alt', content: 'The shop' },
      ]),
    )
    expect(seo.alternates).toEqual(alternates)
    expect(seoFor({ store, url: 'u', title: 'T', imageAlt: 'No image', preview: false }).meta).not.toContainEqual(expect.objectContaining({ property: 'og:image:alt' }))
  })

  it('adds WebSite search to the home page only when the store has a search page, with its social profiles', () => {
    const home = seoFor({ store: { ...store, search: 'https://juniper.example/search/', sameAs: ['https://instagram.com/juniper'] }, url: store.url, title: store.name, preview: false })
    expect(home.jsonLd[0]).toMatchObject({ '@type': 'Organization', sameAs: ['https://instagram.com/juniper'] })
    expect(home.jsonLd[1]).toMatchObject({ '@type': 'WebSite', potentialAction: { '@type': 'SearchAction', target: { urlTemplate: 'https://juniper.example/search/?q={search_term_string}' } } })
    expect(seoFor({ store, url: store.url, title: store.name, preview: false }).jsonLd.map((d) => d['@type'])).toEqual(['Organization'])
  })

  it('gives a product its description and photos, and a collection its breadcrumbs and products in order', () => {
    const product = seoFor({ store, url: 'https://juniper.example/products/tee/', title: 'Tee', preview: false, product: { name: 'Tee', price: moneySchema.parse({ amount: '2800', currency: 'USD' }), available: true, description: 'Cotton.', images: ['https://media.example/1.jpg', 'https://media.example/2.jpg'] } })
    expect(product.jsonLd[0]).toMatchObject({ '@type': 'Product', description: 'Cotton.', image: ['https://media.example/1.jpg', 'https://media.example/2.jpg'] })
    const one = seoFor({ store, url: 'u', title: 'Y', preview: false, product: { name: 'Y', price: moneySchema.parse({ amount: '1200', currency: 'JPY' }), available: true, image: 'https://media.example/y.jpg' } })
    expect(one.jsonLd[0]).toMatchObject({ image: ['https://media.example/y.jpg'] })
    const crumbs = [{ name: 'Juniper & Co.', url: store.url }, { name: 'Summer', url: 'https://juniper.example/collections/summer/' }]
    const collection = seoFor({ store, url: crumbs[1]?.url ?? '', title: 'Summer', preview: false, breadcrumbs: crumbs, items: [{ name: 'Tee', url: 'https://juniper.example/products/tee/' }, { name: 'Shirt', url: 'https://juniper.example/products/shirt/' }] })
    expect(collection.jsonLd.map((d) => d['@type'])).toEqual(['BreadcrumbList', 'ItemList'])
    expect(collection.jsonLd[1]).toMatchObject({ itemListElement: [{ position: 1, name: 'Tee' }, { position: 2, name: 'Shirt' }] })
  })

  it('escapes < in structured data', () => {
    expect(jsonLdText({ name: '</script><script>x' })).not.toContain('</script>')
  })

  it('describes a blog post as an Article with its date, author and cover', () => {
    const seo = seoFor({ store: { name: 'Juniper & Co.', url: 'https://juniper.example/' }, url: 'https://juniper.example/blog/linen/', title: 'Why linen', preview: false, article: { headline: 'Why linen', datePublished: '2026-10-01T10:00:00Z', author: 'Maya', image: 'https://media.example/1.jpg' } })
    expect(seo.meta).toContainEqual({ property: 'og:type', content: 'article' })
    expect(seo.jsonLd).toContainEqual({ '@context': 'https://schema.org', '@type': 'Article', headline: 'Why linen', mainEntityOfPage: 'https://juniper.example/blog/linen/', publisher: { '@type': 'Organization', name: 'Juniper & Co.' }, datePublished: '2026-10-01T10:00:00Z', author: { '@type': 'Person', name: 'Maya' }, image: 'https://media.example/1.jpg' })
  })
})
