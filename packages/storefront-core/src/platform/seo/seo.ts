import { textOfRichText } from '../text/richText'
import { toDecimal, type Money } from '../../pricing/money'

// Metadata every page gets from core, which a theme can't remove (storefront ARCHITECTURE §8):
// canonical, hreflang, Open Graph and Twitter cards, noindex in preview, and structured data.

type Link = { name: string; url: string }

export type SeoInput = {
  /** `search`: the search page's address, for the home page's SearchAction; `sameAs`: the store's social profiles. */
  store: { name: string; url: string; logoUrl?: string | null | undefined; search?: string | null | undefined; sameAs?: readonly string[] | undefined }
  /** The page's absolute URL, without a query string. */
  url: string
  title: string
  description?: string | null | undefined
  image?: string | null | undefined
  imageAlt?: string | null | undefined
  /** The page's language (`en-IN`), as Open Graph's `og:locale`. */
  locale?: string | null | undefined
  /** The same page in each language, `x-default` among them (ARCHITECTURE §8 "hreflang"). */
  alternates?: readonly { language: string; url: string }[] | undefined
  preview: boolean
  product?: { name: string; price: Money; available: boolean; description?: string | null | undefined; image?: string | null | undefined; images?: readonly string[] | undefined } | undefined
  breadcrumbs?: readonly Link[] | undefined
  /** A collection's products, in the order its page lists them. */
  items?: readonly Link[] | undefined
  /** A blog post: its title, when it was published (ISO 8601), its author and cover. */
  article?: { headline: string; datePublished: string | null; author: string | null; image?: string | null | undefined } | undefined
}

export type Seo = {
  title: string
  meta: { name?: string; property?: string; content: string }[]
  canonical: string
  alternates: { language: string; url: string }[]
  jsonLd: Record<string, unknown>[]
}

const context = 'https://schema.org'
const listOf = (links: readonly Link[]) => links.map((l, i) => ({ '@type': 'ListItem', position: i + 1, name: l.name, item: l.url }))

export const seoFor = (p: SeoInput): Seo => {
  const title = p.title === p.store.name ? p.title : `${p.title} · ${p.store.name}`
  const meta: Seo['meta'] = [
    { property: 'og:title', content: p.title },
    { property: 'og:site_name', content: p.store.name },
    { property: 'og:url', content: p.url },
    { property: 'og:type', content: p.product ? 'product' : p.article ? 'article' : 'website' },
    { name: 'twitter:card', content: p.image ? 'summary_large_image' : 'summary' },
    { name: 'twitter:title', content: p.title },
  ]
  if (p.locale) meta.push({ property: 'og:locale', content: p.locale.replaceAll('-', '_') })
  if (p.description) meta.push({ name: 'description', content: p.description }, { property: 'og:description', content: p.description }, { name: 'twitter:description', content: p.description })
  if (p.image) meta.push({ property: 'og:image', content: p.image }, { name: 'twitter:image', content: p.image })
  if (p.image && p.imageAlt) meta.push({ property: 'og:image:alt', content: p.imageAlt }, { name: 'twitter:image:alt', content: p.imageAlt })
  if (p.preview) meta.push({ name: 'robots', content: 'noindex, nofollow' })
  const jsonLd: Record<string, unknown>[] = []
  if (p.url === p.store.url) {
    jsonLd.push({
      '@context': context,
      '@type': 'Organization',
      name: p.store.name,
      url: p.store.url,
      ...(p.store.logoUrl ? { logo: p.store.logoUrl } : {}),
      ...(p.store.sameAs?.length ? { sameAs: p.store.sameAs } : {}),
    })
    if (p.store.search)
      jsonLd.push({
        '@context': context,
        '@type': 'WebSite',
        name: p.store.name,
        url: p.store.url,
        potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${p.store.search}?q={search_term_string}` }, 'query-input': 'required name=search_term_string' },
      })
  }
  const images = p.product?.images ?? (p.product?.image ? [p.product.image] : [])
  if (p.product)
    jsonLd.push({
      '@context': context,
      '@type': 'Product',
      name: p.product.name,
      ...(p.product.description ? { description: textOfRichText(p.product.description) } : {}),
      ...(images.length ? { image: images } : {}),
      offers: {
        '@type': 'Offer',
        url: p.url,
        price: toDecimal(p.product.price),
        priceCurrency: p.product.price.currency,
        availability: p.product.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      },
    })
  if (p.breadcrumbs?.length) jsonLd.push({ '@context': context, '@type': 'BreadcrumbList', itemListElement: listOf(p.breadcrumbs) })
  if (p.items?.length) jsonLd.push({ '@context': context, '@type': 'ItemList', itemListElement: listOf(p.items) })
  if (p.article)
    jsonLd.push({
      '@context': context,
      '@type': 'Article',
      headline: p.article.headline,
      mainEntityOfPage: p.url,
      publisher: { '@type': 'Organization', name: p.store.name },
      ...(p.article.datePublished ? { datePublished: p.article.datePublished } : {}),
      ...(p.article.author ? { author: { '@type': 'Person', name: p.article.author } } : {}),
      ...(p.article.image ? { image: p.article.image } : {}),
    })
  return { title, meta, canonical: p.url, alternates: [...(p.alternates ?? [])], jsonLd }
}

/** JSON-LD for a script tag: `<` escaped so a product name can't close the tag. */
export const jsonLdText = (data: Record<string, unknown>): string => JSON.stringify(data).replace(/</g, '\\u003c')
