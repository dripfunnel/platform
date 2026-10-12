'use client'

import { useMemo, useState } from 'react'
import { z } from 'zod'
import { itemSlug } from '../collections/collections'
import { navigate, useLocation } from '../platform/browser/router'
import type { MessageKey } from '../platform/i18n/messages'
import { asMain, photoOf, videoSchema, type Photo, type VideoFile } from '../platform/media/media'
import { useShopData } from '../platform/render/data'
import { useHead } from '../platform/seo/head'
import { useStorefront } from '../platform/store/context'
import { stockSchema, type Badge, type Stock } from '../pricing/brand'
import { moneySchema, type Money } from '../pricing/money'
import type { LegalNotice } from '../sealed/components'
import { badgesSchema, cardsSchema, moneyFields, productPath, summaryFields, type ProductCard } from './summary'

// A product page (ARCHITECTURE §2.1 `products`; DESIGN §6): which versions exist and can be bought, the chosen version's
// price, stock and photos come from the Shop API; the theme decides only how they look.

const text = z.string().nullable().optional()
const list = <T extends z.ZodType>(item: T) => z.array(item).nullable().optional()
const money = moneySchema.nullable().optional().catch(null)

const productFields = `id name slug description highlights inStock price { ${moneyFields} } compareAt { ${moneyFields} } maxPrice { ${moneyFields} } badges { label tone } photos { alt versionId image { url } } video { file { url } } options { id name values { id name } } versions { id name choices { optionId valueId } price { ${moneyFields} } compareAt { ${moneyFields} } inStock available } specs { name value versionId } faqs { question answer } compliance { region field value } returns warranty seoTitle seoDescription related { ${summaryFields} }`
export const productQuery = `query Product($slug: String!) { product(slug: $slug) { ${productFields} } store { marketId markets { id countries } } }`

const answerSchema = z.object({
  product: z
    .object({
      id: text,
      name: text,
      slug: text,
      description: text,
      highlights: list(z.string()),
      inStock: z.boolean().nullable().optional(),
      price: money,
      compareAt: money,
      maxPrice: money,
      badges: badgesSchema,
      photos: list(z.object({ versionId: text, alt: text, image: z.object({ url: text }).nullable().optional() })),
      video: videoSchema,
      options: list(z.object({ id: text, name: text, values: list(z.object({ id: text, name: text })) })),
      versions: list(z.object({ id: text, name: text, choices: list(z.object({ optionId: text, valueId: text })), price: money, compareAt: money, inStock: z.boolean().nullable().optional(), available: z.number().int().nonnegative().nullable().optional() })),
      specs: list(z.object({ name: text, value: text, versionId: text })),
      faqs: list(z.object({ question: text, answer: text })),
      compliance: list(z.object({ region: text, field: text, value: text })),
      returns: text,
      warranty: text,
      seoTitle: text,
      seoDescription: text,
      related: cardsSchema,
    })
    .nullable(),
  store: z.object({ marketId: text, markets: list(z.object({ id: text, countries: list(z.string()) })) }).nullable().optional(),
})

type Answer = z.infer<typeof answerSchema>
type Decoded = NonNullable<Answer['product']>

export type Version = { id: string; name: string | null; choices: Readonly<Record<string, string>>; price: Money | null; compareAt: Money | null; stock: Stock }
export type ProductOption = { id: string; name: string; values: { id: string; name: string }[] }

export type Product = {
  id: string
  name: string
  href: string
  description: string | null
  highlights: string[]
  badges: Badge[]
  /** The first is the page's main picture; a version's own photos carry its id. */
  photos: (Photo & { versionId: string | null })[]
  video: VideoFile | null
  options: ProductOption[]
  versions: Version[]
  price: Money | null
  compareAt: Money | null
  from: boolean
  stock: Stock
  specs: { name: string; value: string; versionId: string | null }[]
  faqs: { question: string; answer: string }[]
  /** The details the law of the shopper's market asks for (fibre, origin, care), for core's sealed <LegalNotices>. */
  legal: LegalNotice[]
  returns: string | null
  warranty: string | null
  related: ProductCard[]
  seoTitle: string | null
  seoDescription: string | null
}

const legalTitles: Readonly<Record<string, MessageKey>> = { fibre: 'legal.fibre', origin: 'legal.origin', care: 'legal.care' }

/** The market's own value of each field over the one for everywhere ('ALL'), in the engine's field order. */
const legalNotices = (p: Decoded, store: Answer['store'], t: (key: MessageKey) => string): LegalNotice[] => {
  const countries = new Set(store?.markets?.find((m) => m.id && m.id === store.marketId)?.countries ?? [])
  const chosen = new Map<string, string>()
  for (const c of p.compliance ?? []) {
    if (!c.field || !c.value?.trim() || !c.region) continue
    if (countries.has(c.region)) chosen.set(c.field, c.value)
    else if (c.region === 'ALL' && !chosen.has(c.field)) chosen.set(c.field, c.value)
  }
  return [...chosen].map(([field, body]) => ({ title: legalTitles[field] ? t(legalTitles[field]) : field, body }))
}

const decode = (answer: Answer, t: (key: MessageKey) => string): Product | null => {
  const p = answer.product
  if (!p?.id || !p.name || !p.slug) return null
  const options = (p.options ?? []).flatMap((o) => (o.id && o.name ? [{ id: o.id, name: o.name, values: (o.values ?? []).flatMap((v) => (v.id && v.name ? [{ id: v.id, name: v.name }] : [])) }] : []))
  const photos = (p.photos ?? []).flatMap((ph) => (ph.image?.url ? [{ ...photoOf(ph.image.url, ph.alt ?? null), versionId: ph.versionId ?? null }] : []))
  const [first, ...rest] = photos
  return {
    id: p.id,
    name: p.name,
    href: productPath(p.slug),
    description: p.description ?? null,
    highlights: p.highlights ?? [],
    badges: p.badges,
    photos: first ? [{ ...asMain(first), versionId: first.versionId }, ...rest] : [],
    video: p.video,
    options,
    versions: (p.versions ?? []).flatMap((v) =>
      v.id
        ? [
            {
              id: v.id,
              name: v.name ?? null,
              choices: Object.fromEntries((v.choices ?? []).flatMap((c) => (c.optionId && c.valueId ? [[c.optionId, c.valueId]] : []))),
              price: v.price ?? null,
              compareAt: v.compareAt ?? null,
              stock: stockSchema.parse({ inStock: v.inStock ?? false, available: v.available ?? null }),
            },
          ]
        : [],
    ),
    price: p.price ?? null,
    compareAt: p.compareAt ?? null,
    from: !!p.price && !!p.maxPrice && p.price.currency === p.maxPrice.currency && p.price.amount !== p.maxPrice.amount,
    stock: stockSchema.parse({ inStock: p.inStock ?? false, available: null }),
    specs: (p.specs ?? []).flatMap((s) => (s.name && s.value ? [{ name: s.name, value: s.value, versionId: s.versionId ?? null }] : [])),
    faqs: (p.faqs ?? []).flatMap((f) => (f.question && f.answer ? [{ question: f.question, answer: f.answer }] : [])),
    legal: legalNotices(p, answer.store, t),
    returns: p.returns ?? null,
    warranty: p.warranty ?? null,
    related: p.related,
    seoTitle: p.seoTitle ?? null,
    seoDescription: p.seoDescription ?? null,
  }
}

const matches = (version: Version, chosen: Readonly<Record<string, string>>) => Object.entries(chosen).every(([option, value]) => version.choices[option] === value)

/** The chosen values the address names: a version URL's version, or the product's only version. */
const chosenFrom = (product: Product, versionId: string | null): Record<string, string> => {
  const named = product.versions.find((v) => v.id === versionId) ?? (product.versions.length === 1 ? product.versions[0] : undefined)
  return named ? { ...named.choices } : {}
}

export type ProductPage = {
  status: 'loading' | 'ready' | 'missing' | 'error'
  code: string | null
  retry: () => void
  product: Product | null
  /** Each option with its values: chosen, and whether some version in stock has it with the other choices. */
  options: { id: string; name: string; chosen: string | null; values: { id: string; name: string; selected: boolean; available: boolean }[] }[]
  choose: (optionId: string, valueId: string) => void
  /** The version every choice names, once each option is chosen. */
  version: Version | null
  /** Options not chosen yet, which the buy button names ("Choose a size"). */
  missing: { id: string; name: string }[]
  price: Money | null
  compareAt: Money | null
  from: boolean
  stock: Stock | null
  /** The chosen version's photos first. */
  photos: Photo[]
}

/** The product the address names (`/products/{slug}/`, or `/products/{slug}/{version}/` for one version), with its head. */
export const useProduct = (): ProductPage => {
  const { t } = useStorefront()
  const { path } = useLocation()
  const slug = itemSlug(path, '/products/')
  const versionId = slug ? itemSlug(path, `${productPath(slug)}`) : null
  const loaded = useShopData(slug ? JSON.stringify(['product', slug]) : null, async (client) => client.query(productQuery, answerSchema, { slug }))
  const product = useMemo(() => (loaded.data ? decode(loaded.data, t) : null), [loaded.data, t])
  // A partial choice (a colour before a size) lives here; a complete one is the version's own address.
  const [picked, setPicked] = useState<{ productId: string; versionId: string | null; chosen: Record<string, string> } | null>(null)
  const chosen = useMemo(() => {
    if (!product) return {}
    return picked && picked.productId === product.id && picked.versionId === versionId ? picked.chosen : chosenFrom(product, versionId)
  }, [product, versionId, picked])

  const version = product && product.options.every((o) => chosen[o.id]) ? (product.versions.find((v) => matches(v, chosen)) ?? null) : null
  const status = slug === null || (loaded.status === 'ready' && !product) ? 'missing' : loaded.status === 'ready' ? 'ready' : loaded.status === 'error' ? 'error' : 'loading'
  const firstPhoto = product?.photos[0]
  useHead({ title: product ? (product.seoTitle ?? product.name) : null, description: product ? (product.seoDescription ?? product.description) : null, canonical: product?.href, image: firstPhoto?.url, hidden: status === 'missing' || undefined })

  const options = (product?.options ?? []).map((o) => {
    const others = Object.fromEntries(Object.entries(chosen).filter(([id]) => id !== o.id))
    return {
      id: o.id,
      name: o.name,
      chosen: chosen[o.id] ?? null,
      values: o.values.map((v) => ({ id: v.id, name: v.name, selected: chosen[o.id] === v.id, available: product?.versions.some((ver) => ver.stock.inStock && ver.choices[o.id] === v.id && matches(ver, others)) ?? false })),
    }
  })

  const choose = (optionId: string, valueId: string) => {
    if (!product) return
    const next = { ...chosen, [optionId]: valueId }
    const exact = product.options.every((o) => next[o.id]) ? product.versions.find((v) => matches(v, next)) : undefined
    const nextId = exact && product.versions.length > 1 ? exact.id : null
    setPicked({ productId: product.id, versionId: nextId, chosen: next })
    // A version keeps its own address (ARCHITECTURE §4.3), replacing the entry so Back leaves the product.
    if (nextId !== versionId) navigate(nextId ? `${product.href}${encodeURIComponent(nextId)}/` : product.href, { replace: true, inPlace: true })
  }

  const own = version ? (product?.photos.filter((p) => p.versionId === version.id) ?? []) : []
  return {
    status,
    code: loaded.code,
    retry: loaded.retry,
    product,
    options,
    choose,
    version,
    missing: (product?.options ?? []).filter((o) => !chosen[o.id]).map((o) => ({ id: o.id, name: o.name })),
    price: version ? version.price : (product?.price ?? null),
    compareAt: version ? version.compareAt : (product?.compareAt ?? null),
    from: !version && (product?.from ?? false),
    stock: version ? version.stock : (product?.stock ?? null),
    photos: [...own, ...(product?.photos.filter((p) => !own.includes(p)) ?? [])],
  }
}

