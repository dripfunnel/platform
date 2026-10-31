import { ApiError } from '@dripfunnel/shared/graphql'
import type { ContentEntry, ContentInput, ContentTranslation, ContentTranslationInput } from '../../api/content'
import { pathOf } from './contentDraft'
import type { StorefrontState } from './storefrontStates'

// The harness's Journal (ui/README.md §6): kept in memory, so a click-through saves, clashes and deletes.

const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

const at = '2026-10-09T10:40:00Z'
const blank = { publishAt: null, author: null, waitingForPublish: false, updatedAt: at, seoTitle: null, seoDescription: null, tags: [], coverAssetId: null, revision: 1 }
const block = (kind: ContentEntry['body'][number]['kind'], more: Partial<ContentEntry['body'][number]> = {}) => ({ kind, text: null, assetId: null, alt: null, items: null, productIds: null, ...more })

const post = (id: string, title: string, slug: string, status: ContentEntry['status'], publishAt: string, author: string, text: string): ContentEntry => ({ ...blank, id, kind: 'post', title, slug, path: pathOf(slug), status, publishAt, author, body: [block('text', { text })] })
const posts = (): ContentEntry[] =>
  harness
    ? [
        post('sample-post-3', 'Dressing for a Jaipur wedding', 'jaipur-wedding', 'scheduled', '2026-11-02T00:00:00.000Z', 'Farhan Ali', 'Five looks, three days, one suitcase.'),
        post('sample-post-1', 'How a block becomes a print', 'how-a-block-becomes-a-print', 'published', '2026-09-28T09:00:00.000Z', 'Farhan Ali', 'From teak block to finished stole: a morning with our printers in Sanganer.'),
        post('sample-post-2', 'Caring for linen', 'caring-for-linen', 'published', '2026-09-14T09:00:00.000Z', 'Priya Shah', 'Wash cool, dry flat, and stop ironing.'),
      ]
    : []

/** `contentEmpty` has no posts; every other state has the sample. */
export const sampleContent = (state: StorefrontState) => {
  let entries = state === 'contentEmpty' ? [] : posts()
  let made = 0
  const translations = new Map<string, ContentTranslation>()
  return {
    loadContentList: () => Promise.resolve({ rows: entries, next: null }),
    loadContentEntry: (id: string) => Promise.resolve(entries.find((e) => e.id === id) ?? null),
    saveContent: (id: string | null, _revision: number | null, input: ContentInput): Promise<ContentEntry> => {
      const path = pathOf(input.slug)
      if (entries.some((e) => e.id !== id && e.path === path)) return Promise.reject(new ApiError('PATH_TAKEN', 'That web address is already used on your shop.', { path, heldBy: 'blog_post' }))
      const was = entries.find((e) => e.id === id)
      const body = input.body.map((b) => block(b.kind, b))
      const saved: ContentEntry = { ...blank, ...was, id: id ?? `sample-new-${(made += 1)}`, kind: 'post', path, title: input.title, slug: input.slug, body, seoTitle: input.seoTitle, seoDescription: input.seoDescription, status: !input.publish ? 'draft' : input.publishAt && input.publishAt > new Date().toISOString() ? 'scheduled' : 'published', publishAt: input.publishAt ?? was?.publishAt ?? new Date().toISOString(), author: input.author, coverAssetId: input.coverAssetId, waitingForPublish: true, updatedAt: new Date().toISOString(), revision: (was?.revision ?? 0) + 1 }
      entries = was ? entries.map((e) => (e.id === id ? saved : e)) : [saved, ...entries]
      return Promise.resolve(saved)
    },
    loadContentTranslation: (id: string, language: string) => Promise.resolve(translations.get(`${id}|${language}`) ?? null),
    saveContentTranslation: (id: string, language: string, input: ContentTranslationInput | null) => {
      if (input) translations.set(`${id}|${language}`, { language, ...input, body: input.body.map((b) => block(b.kind, b)), changed: false })
      else translations.delete(`${id}|${language}`)
      return Promise.resolve()
    },
    deleteContent: (id: string) => {
      entries = entries.filter((e) => e.id !== id)
      return Promise.resolve()
    },
    loadProductNames: (ids: readonly string[]) => Promise.resolve(new Map(ids.flatMap((id): [string, string][] => (id === 'sample-product-1' ? [[id, 'Indigo block-print kurta']] : [])))),
  }
}
