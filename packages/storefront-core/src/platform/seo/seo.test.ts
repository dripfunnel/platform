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

  it('escapes < in structured data', () => {
    expect(jsonLdText({ name: '</script><script>x' })).not.toContain('</script>')
  })

  it('describes a blog post as an Article with its date, author and cover', () => {
    const seo = seoFor({ store: { name: 'Juniper & Co.', url: 'https://juniper.example/' }, url: 'https://juniper.example/blog/linen/', title: 'Why linen', preview: false, article: { headline: 'Why linen', datePublished: '2026-10-01T10:00:00Z', author: 'Maya', image: 'https://media.example/1.jpg' } })
    expect(seo.meta).toContainEqual({ property: 'og:type', content: 'article' })
    expect(seo.jsonLd).toContainEqual({ '@context': 'https://schema.org', '@type': 'Article', headline: 'Why linen', mainEntityOfPage: 'https://juniper.example/blog/linen/', publisher: { '@type': 'Organization', name: 'Juniper & Co.' }, datePublished: '2026-10-01T10:00:00Z', author: { '@type': 'Person', name: 'Maya' }, image: 'https://media.example/1.jpg' })
  })
})
