import type { BlockKind, ContentBlockInput, ContentEntry, ContentTranslation, ContentTranslationInput } from '../../api/content'

// Another language's words for a page or post (FIRST-RELEASE §19 "SAPI 24": its own title, blocks and search words): pure.

export interface TranslatedBlock {
  kind: BlockKind
  text: string
  alt: string
  items: { question: string; answer: string }[]
}

export interface TranslationDraft {
  title: string
  seoTitle: string
  seoDescription: string
  /** One per block of the saved page, in its order. */
  blocks: TranslatedBlock[]
}

/** The words as written for each of the page's blocks; a block the translation doesn't have yet starts empty. */
export const translationDraftOf = (main: ContentEntry, written: ContentTranslation | null): TranslationDraft => ({
  title: written?.title ?? '',
  seoTitle: written?.seoTitle ?? '',
  seoDescription: written?.seoDescription ?? '',
  blocks: main.body.map((b, i) => {
    const was = written?.body[i]
    const same = was?.kind === b.kind ? was : null
    return { kind: b.kind, text: same?.text ?? '', alt: same?.alt ?? '', items: (b.items ?? []).map((_, n) => ({ question: same?.items?.[n]?.question ?? '', answer: same?.items?.[n]?.answer ?? '' })) }
  }),
})

const or = (typed: string | undefined, main: string | null | undefined): string => (typed?.trim() ? typed : (main ?? ''))

/** The page's blocks with the words typed, the main language's as they are now where one is empty (#338 keeps a language whole). */
export const translationInputOf = (main: ContentEntry, draft: TranslationDraft): ContentTranslationInput => ({
  title: or(draft.title, main.title).trim(),
  body: main.body.flatMap((b, i): ContentBlockInput[] => {
    const t = draft.blocks[i]
    if (b.kind === 'heading' || b.kind === 'text') return [{ kind: b.kind, text: or(t?.text, b.text) }]
    // A saved photo block always has its photo (content rules.ts), so no block is dropped and indexes stay aligned.
    if (b.kind === 'image') return b.assetId ? [{ kind: 'image', assetId: b.assetId, alt: or(t?.alt, b.alt) }] : []
    if (b.kind === 'faq') return [{ kind: 'faq', items: (b.items ?? []).map((q, n) => ({ question: or(t?.items[n]?.question, q.question), answer: or(t?.items[n]?.answer, q.answer) })) }]
    if (b.kind === 'products') return [{ kind: 'products', productIds: b.productIds ?? [] }]
    return [{ kind: 'form' }]
  }),
  seoTitle: draft.seoTitle.trim() || null,
  seoDescription: draft.seoDescription.trim() || null,
})

/** What a save wrote, read back as the API would answer it, so the fields show what was saved. */
export const writtenOf = (language: string, input: ContentTranslationInput): ContentTranslation => ({
  language,
  ...input,
  body: input.body.map((b) => ({ kind: b.kind, text: b.text ?? null, assetId: b.assetId ?? null, alt: b.alt ?? null, items: b.items ?? null, productIds: b.productIds ?? null })),
  changed: false,
})
