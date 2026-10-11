import { z } from 'zod'
import type { ContentKind } from '#db/scoped/storefrontContent'

// Content pages and posts before they are written (StorefrontContent; storefront ARCHITECTURE §3.1): pure.

/** The first path segments core's routes and files use, as storefront-core's contracts/routes.ts has them (ARCHITECTURE §3.1). */
export const reservedPathSegments: readonly string[] = [
  'account', 'api', 'assets', 'blog', 'cart', 'checkout', 'collections', 'core', 'forgot-password', 'media', 'order',
  'orders', 'pages', 'policies', 'products', 'register', 'reset-password', 'search', 'shop-api', 'sign-in', 'sitemap', 'verify',
]

export const maxBlocks = 100
const maxQuestions = 50
const maxProducts = 24

const words = (max: number) => z.string().max(max).transform((s) => s.trim())
const optionalWords = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((s) => (s?.trim() ? s.trim() : null))

// Every word is the merchant's own plain text: the theme renders it as text, never as markup (ARCHITECTURE §3.4).
const blockSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('heading'), text: words(200) }),
  z.strictObject({ kind: z.literal('text'), text: words(10_000) }),
  z.strictObject({ kind: z.literal('image'), assetId: z.uuid(), alt: words(300) }),
  z.strictObject({ kind: z.literal('faq'), items: z.array(z.strictObject({ question: words(300), answer: words(5_000) })).max(maxQuestions) }),
  z.strictObject({ kind: z.literal('products'), productIds: z.array(z.uuid()).max(maxProducts) }),
  z.strictObject({ kind: z.literal('form') }),
])
export type ContentBlock = z.infer<typeof blockSchema>

export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const inputSchema = z.strictObject({
  title: words(200).pipe(z.string().min(1)),
  slug: z.string().max(100).regex(slugPattern).nullish(),
  body: z.array(blockSchema).max(maxBlocks),
  seoTitle: optionalWords(60),
  seoDescription: optionalWords(160),
  publish: z.boolean(),
  inMenu: z.boolean().nullish(),
  publishAt: z.iso.datetime({ offset: true }).nullish(),
  author: optionalWords(80),
  tags: z.array(words(40).pipe(z.string().min(1))).max(20).nullish(),
  coverAssetId: z.uuid().nullish(),
})

export class ContentInvalid extends Error {
  constructor(readonly field: string) {
    super(`content: ${field}`)
  }
}

/** A title as a web address: "Caring for linen" is caring-for-linen. */
export const slugOf = (title: string): string =>
  title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/, '')

/** Where a page or post lives on the store: pages at the top level, posts under core's /blog. */
export const contentPath = (kind: ContentKind, slug: string): string => (kind === 'page' ? `/${slug}` : `/blog/${slug}`)

export interface CleanContent {
  title: string
  slug: string
  body: ContentBlock[]
  seoTitle: string | null
  seoDescription: string | null
  publish: boolean
  inMenu: boolean
  publishAt: Date | null
  author: string | null
  tags: string[]
  coverAssetId: string | null
}

/** The input checked against its kind: a page has no date, author, tags or cover; a post no footer place and no contact form. */
export const cleanContent = (kind: ContentKind, input: unknown): CleanContent => {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) throw new ContentInvalid(parsed.error.issues[0]?.path.join('.') || 'input')
  const v = parsed.data
  if (kind === 'page' && (v.publishAt || v.author || (v.tags?.length ?? 0) > 0 || v.coverAssetId)) throw new ContentInvalid('kind')
  if (kind === 'post' && (v.inMenu || v.body.some((b) => b.kind === 'form'))) throw new ContentInvalid('kind')
  const slug = v.slug ?? slugOf(v.title)
  if (!slugPattern.test(slug)) throw new ContentInvalid('slug')
  return {
    title: v.title,
    slug,
    body: v.body,
    seoTitle: v.seoTitle,
    seoDescription: v.seoDescription,
    publish: v.publish,
    inMenu: v.inMenu ?? false,
    publishAt: v.publishAt ? new Date(v.publishAt) : null,
    author: v.author,
    tags: [...new Set(v.tags ?? [])],
    coverAssetId: v.coverAssetId ?? null,
  }
}

/** The files and products a body and cover name, each once. */
export const namedIn = (body: readonly ContentBlock[], coverAssetId: string | null) => ({
  assetIds: [...new Set([...(coverAssetId ? [coverAssetId] : []), ...body.flatMap((b) => (b.kind === 'image' ? [b.assetId.toLowerCase()] : []))])],
  productIds: [...new Set(body.flatMap((b) => (b.kind === 'products' ? b.productIds.map((p) => p.toLowerCase()) : [])))],
})

export type PathHolder = 'core' | 'language' | 'market' | 'custom_page' | 'content_page' | 'blog_post'

/** A path as the store compares paths, as storefront-core's guard does: one leading slash, none trailing, lower case. */
export const comparablePath = (path: string): string => `/${path.trim().toLowerCase().replace(/^\/+|\/+$/g, '')}`

/**
 * Who already holds a page's or post's path in the store's one namespace (ARCHITECTURE §3.1), or null when it's free.
 * Another page or post of the same kind is the unique index's to refuse.
 */
export const pathHolder = (kind: ContentKind, slug: string, held: { customPaths: readonly string[]; languages: readonly string[]; marketPrefixes: readonly string[] }): PathHolder | null => {
  if (kind === 'page') {
    if (reservedPathSegments.includes(slug)) return 'core'
    if (held.languages.some((l) => [l.toLowerCase(), l.split('-')[0]?.toLowerCase()].includes(slug))) return 'language'
    if (held.marketPrefixes.includes(slug)) return 'market'
  }
  const path = comparablePath(contentPath(kind, slug))
  return held.customPaths.some((p) => comparablePath(p) === path) ? 'custom_page' : null
}
