import { ApiError } from '@dripfunnel/shared/graphql'
import type { ContentEntry, ContentInput, ContentKind } from '../../api/content'
import { pathOf } from './contentDraft'
import type { StorefrontState } from './storefrontStates'

// The harness's Pages and Journal (ui/README.md §6): kept in memory, so a click-through saves, clashes and deletes.

const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

const at = '2026-10-09T10:40:00Z'
const blank = { inMenu: false, publishAt: null, author: null, waitingForPublish: false, updatedAt: at, seoTitle: null, seoDescription: null, tags: [], coverAssetId: null, revision: 1 }
const block = (kind: ContentEntry['body'][number]['kind'], more: Partial<ContentEntry['body'][number]> = {}) => ({ kind, text: null, assetId: null, alt: null, items: null, productIds: null, ...more })

const pages = (): ContentEntry[] =>
  harness
    ? [
        {
          ...blank,
          id: 'sample-faq',
          kind: 'page',
          title: 'Questions we get asked',
          slug: 'faq',
          path: '/faq',
          status: 'published',
          inMenu: true,
          seoDescription: 'Delivery, returns and care.',
          body: [block('heading', { text: 'Questions we get asked' }), block('faq', { items: [{ question: 'How long does delivery take?', answer: '3–5 working days anywhere in India.' }, { question: 'Can I return something?', answer: 'Yes, within 14 days of delivery.' }] })],
        },
        { ...blank, id: 'sample-contact', kind: 'page', title: 'Contact', slug: 'contact', path: '/contact', status: 'published', inMenu: true, body: [block('heading', { text: 'Talk to us' }), block('text', { text: 'We reply within a working day.' }), block('form')] },
        { ...blank, id: 'sample-lookbook', kind: 'page', title: 'Sangeet to pheras', slug: 'lookbook', path: '/lookbook', status: 'draft', updatedAt: '2026-10-12T08:15:00Z', body: [block('heading', { text: 'Sangeet to pheras' }), block('products', { productIds: ['sample-product-1'] })] },
      ]
    : []

const customPaths = harness ? ['/about', '/our-story'] : []
const core = ['account', 'blog', 'cart', 'checkout', 'collections', 'policies', 'products', 'search', 'sign-in']

/** `contentEmpty` has no pages and no AI pages; every other state has the sample. */
export const sampleContent = (state: StorefrontState) => {
  let entries = state === 'contentEmpty' ? [] : pages()
  const custom = state === 'contentEmpty' ? [] : customPaths
  let made = 0
  const of = (kind: ContentKind) => entries.filter((e) => e.kind === kind)
  return {
    loadContentList: (kind: ContentKind) => Promise.resolve({ rows: of(kind), next: null }),
    loadCustomPaths: () => Promise.resolve(custom),
    loadContentEntry: (id: string) => Promise.resolve(entries.find((e) => e.id === id) ?? null),
    saveContent: (kind: ContentKind, id: string | null, _revision: number | null, input: ContentInput): Promise<ContentEntry> => {
      const path = pathOf(kind, input.slug)
      const held = kind === 'page' && core.includes(input.slug) ? 'core' : custom.includes(path) ? 'custom_page' : entries.some((e) => e.id !== id && e.path === path) ? (kind === 'page' ? 'content_page' : 'blog_post') : null
      if (held) return Promise.reject(new ApiError('PATH_TAKEN', 'That web address is already used on your shop.', { path, heldBy: held }))
      const was = entries.find((e) => e.id === id)
      const body = input.body.map((b) => block(b.kind, b))
      const saved: ContentEntry = { ...blank, ...was, id: id ?? `sample-new-${(made += 1)}`, kind, path, title: input.title, slug: input.slug, body, seoTitle: input.seoTitle, seoDescription: input.seoDescription, inMenu: input.inMenu ?? false, status: input.publish ? 'published' : 'draft', waitingForPublish: true, updatedAt: new Date().toISOString(), revision: (was?.revision ?? 0) + 1 }
      entries = was ? entries.map((e) => (e.id === id ? saved : e)) : [saved, ...entries]
      return Promise.resolve(saved)
    },
    deleteContent: (_kind: ContentKind, id: string) => {
      entries = entries.filter((e) => e.id !== id)
      return Promise.resolve()
    },
    loadProductNames: (ids: readonly string[]) => Promise.resolve(new Map(ids.flatMap((id): [string, string][] => (id === 'sample-product-1' ? [[id, 'Indigo block-print kurta']] : [])))),
  }
}
