import { contentLimits, type BlockKind, type ContentBlockInput, type ContentEntry, type ContentInput, type ContentKind } from '../../../api/storefrontContent'
import { t } from '../../../messages'

// Pages and Journal's editor before it is saved (StorefrontContent; FIRST-RELEASE (store) §14): pure.

export type DraftBlock = {
  /** The list's key: stable while blocks move. */
  key: string
  kind: BlockKind
  text: string
  assetId: string | null
  alt: string
  items: { question: string; answer: string }[]
  productIds: string[]
}

export type ContentDraft = {
  title: string
  slug: string
  body: DraftBlock[]
  seoTitle: string
  seoDescription: string
  inMenu: boolean
  /** Kept as read: the phone draws no cover, date, author or tags, and a save without them would clear them (decided on #513). */
  publishAt: string | null
  author: string
  coverAssetId: string | null
  tags: string[]
}

let made = 0
export const newBlock = (kind: BlockKind, more: Partial<DraftBlock> = {}): DraftBlock => ({ key: `b${(made += 1)}`, kind, text: '', assetId: null, alt: '', items: [], productIds: [], ...more })

/** A new page starts with a heading and a paragraph, a new post with a paragraph, as StorefrontContent's do. */
export const draftOf = (entry: ContentEntry | null, kind: ContentKind): ContentDraft =>
  entry
    ? {
        title: entry.title,
        slug: entry.slug,
        body: entry.body.map((block) => newBlock(block.kind, { text: block.text ?? '', assetId: block.assetId, alt: block.alt ?? '', items: block.items ?? [], productIds: block.productIds ?? [] })),
        seoTitle: entry.seoTitle ?? '',
        seoDescription: entry.seoDescription ?? '',
        inMenu: entry.inMenu,
        publishAt: entry.publishAt,
        author: entry.author ?? '',
        coverAssetId: entry.coverAssetId,
        tags: entry.tags,
      }
    : { title: '', slug: '', body: kind === 'page' ? [newBlock('heading'), newBlock('text')] : [newBlock('text')], seoTitle: '', seoDescription: '', inMenu: false, publishAt: null, author: '', coverAssetId: null, tags: [] }

const shapeOf = (draft: ContentDraft): string =>
  JSON.stringify({ ...draft, body: draft.body.map(({ kind, text, assetId, alt, items, productIds }) => ({ kind, text, assetId, alt, items, productIds })) })

export const isDraftDirty = (draft: ContentDraft, saved: ContentDraft): boolean => shapeOf(draft) !== shapeOf(saved)

/** What a web address may hold: lower case letters, digits and single hyphens, as the API's slug pattern does. */
export const cleanSlug = (typed: string): string =>
  typed
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, contentLimits.slug)

const slugOf = (title: string): string => cleanSlug(title.trim().toLowerCase().replace(/\s+/g, '-')).replace(/^-+|-+$/g, '')

/** The address the page will have: the one typed, else the title's, as the API makes it. */
export const slugShown = (draft: Pick<ContentDraft, 'title' | 'slug'>): string => draft.slug.replace(/^-+|-+$/g, '') || slugOf(draft.title)

/** Where a page or post lives on the shop (storefront ARCHITECTURE §3.1). */
export const pathOf = (kind: ContentKind, slug: string): string => (kind === 'page' ? `/${slug}` : `/blog/${slug}`)

const blockInput = (block: DraftBlock): ContentBlockInput | null => {
  if (block.kind === 'heading' || block.kind === 'text') return { kind: block.kind, text: block.text }
  if (block.kind === 'image') return block.assetId ? { kind: 'image', assetId: block.assetId, alt: block.alt } : null
  if (block.kind === 'faq') return { kind: 'faq', items: block.items }
  if (block.kind === 'products') return { kind: 'products', productIds: block.productIds }
  return { kind: 'form' }
}

export const inputOf = (kind: ContentKind, draft: ContentDraft, publish: boolean): ContentInput => ({
  title: draft.title.trim(),
  slug: slugShown(draft),
  body: draft.body.flatMap((block) => blockInput(block) ?? []),
  seoTitle: draft.seoTitle.trim() || null,
  seoDescription: draft.seoDescription.trim() || null,
  publish,
  ...(kind === 'page' ? { inMenu: draft.inMenu } : { ...(draft.publishAt ? { publishAt: draft.publishAt } : {}), author: draft.author.trim() || null, tags: draft.tags, coverAssetId: draft.coverAssetId }),
})

/** Why a save can't go yet, before asking the API: a title, an address, and nothing past its limit. */
export const draftProblem = (draft: ContentDraft): { field: 'title' | 'slug' | 'seo'; text: string } | null => {
  if (!draft.title.trim()) return { field: 'title', text: t('storefront.content.editor.needsTitle') }
  if (!slugShown(draft)) return { field: 'slug', text: t('storefront.content.editor.needsSlug') }
  if (draft.seoTitle.length > contentLimits.seoTitle || draft.seoDescription.length > contentLimits.seoDescription) return { field: 'seo', text: t('storefront.content.editor.seoTooLong') }
  return null
}

export const moveBlock = (body: readonly DraftBlock[], index: number, by: -1 | 1): DraftBlock[] => {
  const next = [...body]
  const [moved] = next.splice(index, 1)
  if (moved) next.splice(index + by, 0, moved)
  return next
}

// The first path segments core holds (engine/modules/content/rules.ts reservedPathSegments), in the merchant's words.
const coreNames: Record<string, 'cart' | 'checkout' | 'orders' | 'accounts' | 'signIn' | 'search' | 'products' | 'collections' | 'policies' | 'journal'> = {
  cart: 'cart',
  checkout: 'checkout',
  order: 'orders',
  orders: 'orders',
  account: 'accounts',
  'sign-in': 'signIn',
  register: 'signIn',
  verify: 'signIn',
  'forgot-password': 'signIn',
  'reset-password': 'signIn',
  search: 'search',
  products: 'products',
  collections: 'collections',
  policies: 'policies',
  blog: 'journal',
}

/** The `PATH_TAKEN` refusal in words that name what holds the address (storefront ARCHITECTURE §3.1). */
export const pathTakenText = (path: string, heldBy: string): string => {
  const segment = path.replace(/^\/+/, '').split('/')[0] ?? ''
  if (heldBy === 'core') {
    const what = coreNames[segment]
    return what ? t('storefront.content.taken.coreLine', { path, what: t(`storefront.content.taken.core.${what}`) }) : t('storefront.content.taken.coreOther', { path })
  }
  if (heldBy === 'custom_page') return t('storefront.content.taken.custom', { path })
  if (heldBy === 'language') return t('storefront.content.taken.language', { path })
  if (heldBy === 'market') return t('storefront.content.taken.market', { path })
  return t(heldBy === 'blog_post' ? 'storefront.content.taken.post' : 'storefront.content.taken.page', { path })
}
