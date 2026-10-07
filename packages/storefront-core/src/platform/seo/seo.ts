import type { ShopMoney } from '../pricing/money'

// Metadata every page gets from core, which a theme can't remove (storefront ARCHITECTURE §8):
// canonical, Open Graph, noindex in preview, and structured data.

export type SeoInput = {
  store: { name: string; url: string; logoUrl?: string | null | undefined }
  /** The page's absolute URL, without a query string. */
  url: string
  title: string
  description?: string | null | undefined
  image?: string | null | undefined
  preview: boolean
  product?: { name: string; price: ShopMoney; available: boolean; image?: string | null | undefined } | undefined
  breadcrumbs?: readonly { name: string; url: string }[] | undefined
}

export type Seo = {
  title: string
  meta: { name?: string; property?: string; content: string }[]
  canonical: string
  jsonLd: Record<string, unknown>[]
}

const decimal = ({ amount, currency }: ShopMoney): string => {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  const minor = BigInt(amount)
  const scale = 10n ** BigInt(digits)
  const whole = `${minor < 0n ? '-' : ''}${(minor < 0n ? -minor : minor) / scale}`
  return digits ? `${whole}.${((minor < 0n ? -minor : minor) % scale).toString().padStart(digits, '0')}` : whole
}

export const seoFor = (p: SeoInput): Seo => {
  const title = p.title === p.store.name ? p.title : `${p.title} · ${p.store.name}`
  const meta: Seo['meta'] = [
    { property: 'og:title', content: p.title },
    { property: 'og:site_name', content: p.store.name },
    { property: 'og:url', content: p.url },
    { property: 'og:type', content: p.product ? 'product' : 'website' },
  ]
  if (p.description) meta.push({ name: 'description', content: p.description }, { property: 'og:description', content: p.description })
  if (p.image) meta.push({ property: 'og:image', content: p.image })
  if (p.preview) meta.push({ name: 'robots', content: 'noindex, nofollow' })
  const jsonLd: Record<string, unknown>[] = []
  if (p.url === p.store.url) jsonLd.push({ '@context': 'https://schema.org', '@type': 'Organization', name: p.store.name, url: p.store.url, ...(p.store.logoUrl ? { logo: p.store.logoUrl } : {}) })
  if (p.product)
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.product.name,
      ...(p.product.image ? { image: p.product.image } : {}),
      offers: {
        '@type': 'Offer',
        url: p.url,
        price: decimal(p.product.price),
        priceCurrency: p.product.price.currency,
        availability: p.product.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      },
    })
  if (p.breadcrumbs?.length)
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: p.breadcrumbs.map((b, i) => ({ '@type': 'ListItem', position: i + 1, name: b.name, item: b.url })),
    })
  return { title, meta, canonical: p.url, jsonLd }
}

/** JSON-LD for a script tag: `<` escaped so a product name can't close the tag. */
export const jsonLdText = (data: Record<string, unknown>): string => JSON.stringify(data).replace(/</g, '\\u003c')
