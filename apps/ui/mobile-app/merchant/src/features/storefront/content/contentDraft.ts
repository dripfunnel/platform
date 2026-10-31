import { contentLimits, type BlockKind, type ContentBlockInput, type ContentEntry, type ContentInput } from '../../../api/storefrontContent'
import { t } from '../../../messages'

// Journal's editor before it is saved (StorefrontContent; FIRST-RELEASE (store) §14): pure.

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
  /** Kept as read: the phone draws no cover, date, author or tags, and a save without them would clear them (decided on #513). */
  publishAt: string | null
  author: string
  coverAssetId: string | null
  tags: string[]
}

let made = 0
export const newBlock = (kind: BlockKind, more: Partial<DraftBlock> = {}): DraftBlock => ({ key: `b${(made += 1)}`, kind, text: '', assetId: null, alt: '', items: [], productIds: [], ...more })

/** A new post starts with a paragraph, as StorefrontContent's does. */
export const draftOf = (entry: ContentEntry | null): ContentDraft =>
  entry
    ? {
        title: entry.title,
        slug: entry.slug,
        body: entry.body.map((block) => newBlock(block.kind, { text: block.text ?? '', assetId: block.assetId, alt: block.alt ?? '', items: block.items ?? [], productIds: block.productIds ?? [] })),
        seoTitle: entry.seoTitle ?? '',
        seoDescription: entry.seoDescription ?? '',
        publishAt: entry.publishAt,
        author: entry.author ?? '',
        coverAssetId: entry.coverAssetId,
        tags: entry.tags,
      }
    : { title: '', slug: '', body: [newBlock('text')], seoTitle: '', seoDescription: '', publishAt: null, author: '', coverAssetId: null, tags: [] }

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

/** The address the post will have: the one typed, else the title's, as the API makes it. */
export const slugShown = (draft: Pick<ContentDraft, 'title' | 'slug'>): string => draft.slug.replace(/^-+|-+$/g, '') || slugOf(draft.title)

/** Where a post lives on the shop (storefront ARCHITECTURE §3.1). */
export const pathOf = (slug: string): string => `/blog/${slug}`

const blockInput = (block: DraftBlock): ContentBlockInput | null => {
  if (block.kind === 'heading' || block.kind === 'text') return { kind: block.kind, text: block.text }
  if (block.kind === 'image') return block.assetId ? { kind: 'image', assetId: block.assetId, alt: block.alt } : null
  if (block.kind === 'faq') return { kind: 'faq', items: block.items }
  return { kind: 'products', productIds: block.productIds }
}

export const inputOf = (draft: ContentDraft, publish: boolean): ContentInput => ({
  title: draft.title.trim(),
  slug: slugShown(draft),
  body: draft.body.flatMap((block) => blockInput(block) ?? []),
  seoTitle: draft.seoTitle.trim() || null,
  seoDescription: draft.seoDescription.trim() || null,
  publish,
  ...(draft.publishAt ? { publishAt: draft.publishAt } : {}),
  author: draft.author.trim() || null,
  tags: draft.tags,
  coverAssetId: draft.coverAssetId,
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

/** The `PATH_TAKEN` refusal naming what holds a post's address: an AI page or another post (content rules.ts pathHolder). */
export const pathTakenText = (path: string, heldBy: string): string =>
  t(heldBy === 'custom_page' ? 'storefront.content.taken.custom' : 'storefront.content.taken.post', { path })
