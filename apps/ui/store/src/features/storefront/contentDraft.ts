import type { BlockKind, ContentBlockInput, ContentEntry, ContentInput, ContentKind } from '../../api/content'
import { contentLimits } from '../../api/content'
import { fill, locale, messages } from '../../messages'
import { slugOf } from '../common/slug'
import { languageName } from './studioRules'

// Pages and Journal's editor before it is saved (StorefrontContent; FIRST-RELEASE §14): pure.

const words = messages.storefront.content

export interface DraftBlock {
  /** React's key: stable while blocks move. */
  key: string
  kind: BlockKind
  text: string
  assetId: string | null
  alt: string
  items: { question: string; answer: string }[]
  productIds: string[]
}

export interface ContentDraft {
  title: string
  slug: string
  body: DraftBlock[]
  seoTitle: string
  seoDescription: string
  inMenu: boolean
  /** A post's day (YYYY-MM-DD, UTC), empty until one is picked; `publishAt` is the instant it was read as. */
  publishDate: string
  publishAt: string | null
  author: string
  coverAssetId: string | null
  /** Kept as read: the editor doesn't draw tags, and a save without them would clear them. */
  tags: string[]
}

let made = 0
export const newBlock = (kind: BlockKind, more: Partial<DraftBlock> = {}): DraftBlock => ({ key: `b${(made += 1)}`, kind, text: '', assetId: null, alt: '', items: [], productIds: [], ...more })

const dayOf = (iso: string | null): string => (iso ? iso.slice(0, 10) : '')

/** A new page starts with a heading and a paragraph, a new post with a paragraph, as StorefrontContent's do. */
export const draftOf = (entry: ContentEntry | null, kind: ContentKind = 'page'): ContentDraft =>
  entry
    ? {
        title: entry.title,
        slug: entry.slug,
        body: entry.body.map((b) => newBlock(b.kind, { text: b.text ?? '', assetId: b.assetId, alt: b.alt ?? '', items: b.items ?? [], productIds: b.productIds ?? [] })),
        seoTitle: entry.seoTitle ?? '',
        seoDescription: entry.seoDescription ?? '',
        inMenu: entry.inMenu,
        publishDate: dayOf(entry.publishAt),
        publishAt: entry.publishAt,
        author: entry.author ?? '',
        coverAssetId: entry.coverAssetId,
        tags: entry.tags,
      }
    : { title: '', slug: '', body: kind === 'page' ? [newBlock('heading'), newBlock('text')] : [newBlock('text')], seoTitle: '', seoDescription: '', inMenu: false, publishDate: '', publishAt: null, author: '', coverAssetId: null, tags: [] }

/** The instant a post's day stands for: the one read while the day is unchanged, else the day's start in UTC. */
const publishAtOf = (draft: ContentDraft): string | undefined => {
  if (!draft.publishDate) return undefined
  return draft.publishAt && dayOf(draft.publishAt) === draft.publishDate ? draft.publishAt : `${draft.publishDate}T00:00:00.000Z`
}

/** A day after today (UTC) schedules a post. */
export const schedules = (draft: Pick<ContentDraft, 'publishDate'>, now: Date): boolean => draft.publishDate > now.toISOString().slice(0, 10)

/** What a web address may hold: lower case letters, digits and single hyphens, as the API's slug pattern does. */
export const cleanSlug = (typed: string): string =>
  typed
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, contentLimits.slug)

/** The address the page will have: the one typed, else the title's, as the API makes it. */
export const slugShown = (draft: Pick<ContentDraft, 'title' | 'slug'>): string => draft.slug.replace(/^-+|-+$/g, '') || slugOf(draft.title)

const blockInput = (b: DraftBlock): ContentBlockInput | null => {
  if (b.kind === 'heading' || b.kind === 'text') return { kind: b.kind, text: b.text }
  if (b.kind === 'image') return b.assetId ? { kind: 'image', assetId: b.assetId, alt: b.alt } : null
  if (b.kind === 'faq') return { kind: 'faq', items: b.items }
  if (b.kind === 'products') return { kind: 'products', productIds: b.productIds }
  return { kind: 'form' }
}

const postFields = (draft: ContentDraft): Partial<ContentInput> => {
  const at = publishAtOf(draft)
  return { ...(at ? { publishAt: at } : {}), author: draft.author.trim() || null, tags: draft.tags, coverAssetId: draft.coverAssetId }
}

export const inputOf = (kind: ContentKind, draft: ContentDraft, publish: boolean): ContentInput => ({
  title: draft.title.trim(),
  slug: slugShown(draft),
  body: draft.body.flatMap((b) => blockInput(b) ?? []),
  seoTitle: draft.seoTitle.trim() || null,
  seoDescription: draft.seoDescription.trim() || null,
  publish,
  ...(kind === 'page' ? { inMenu: draft.inMenu } : postFields(draft)),
})

/** Why a save can't go yet, before asking the API: a title, an address, and nothing past its limit. */
export const draftProblem = (draft: ContentDraft): { field: 'title' | 'slug' | 'seo' | 'date'; text: string } | null => {
  if (!draft.title.trim()) return { field: 'title', text: words.editor.needsTitle }
  if (!slugShown(draft)) return { field: 'slug', text: words.editor.needsSlug }
  if (draft.seoTitle.length > contentLimits.seoTitle || draft.seoDescription.length > contentLimits.seoDescription) return { field: 'seo', text: words.editor.seoTooLong }
  // #338 keeps a post's stored date when none is sent, so a dated post can't be emptied (FIRST-RELEASE §14).
  if (draft.publishAt && !draft.publishDate) return { field: 'date', text: words.editor.needsDate }
  return null
}

export const moveBlock = (body: readonly DraftBlock[], index: number, by: -1 | 1): DraftBlock[] => {
  const next = [...body]
  const [moved] = next.splice(index, 1)
  if (moved) next.splice(index + by, 0, moved)
  return next
}

/** Where a page or post lives on the shop (storefront ARCHITECTURE §3.1 "As built on #338"). */
export const pathOf = (kind: ContentKind, slug: string): string => (kind === 'page' ? `/${slug}` : `/blog/${slug}`)

// The first path segments core holds (engine/modules/content/rules.ts reservedPathSegments), in the merchant's words.
const coreNames: Record<string, keyof typeof words.taken.core> = {
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

export interface PathTaken {
  path: string
  heldBy: string
}

/** The PATH_TAKEN refusal in words that name what holds the address; `titleAt` finds a page or post by its path. */
export const pathTakenText = ({ path, heldBy }: PathTaken, titleAt: (path: string) => string | null): string => {
  const t = words.taken
  const segment = path.replace(/^\/+/, '').split('/')[0] ?? ''
  if (heldBy === 'core') {
    const what = coreNames[segment]
    return what ? fill(t.coreLine, { path, what: t.core[what] }) : fill(t.coreOther, { path })
  }
  if (heldBy === 'custom_page') return fill(t.custom, { path })
  if (heldBy === 'language') return fill(t.language, { path, language: languageName(segment, locale) })
  if (heldBy === 'market') return fill(t.market, { path })
  const title = titleAt(path)
  const kind = heldBy === 'blog_post' ? t.post : t.page
  return title ? fill(kind.named, { path, title }) : fill(kind.unnamed, { path })
}
