import type { ContentKind, ContentRow } from '../../api/content'
import type { StorefrontState } from './storefrontStates'

// The harness's Pages and Journal (ui/README.md §6).

const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

const at = '2026-10-09T10:40:00Z'
const blank = { inMenu: false, publishAt: null, author: null, waitingForPublish: false, updatedAt: at }

const pages = (): (ContentRow & { kind: ContentKind })[] =>
  harness
    ? [
        { ...blank, id: 'sample-faq', kind: 'page', title: 'Questions we get asked', path: '/faq', status: 'published', inMenu: true },
        { ...blank, id: 'sample-contact', kind: 'page', title: 'Contact', path: '/contact', status: 'published', inMenu: true },
        { ...blank, id: 'sample-lookbook', kind: 'page', title: 'Sangeet to pheras', path: '/lookbook', status: 'draft', updatedAt: '2026-10-12T08:15:00Z' },
      ]
    : []

const customPaths = harness ? ['/about', '/our-story'] : []

/** `contentEmpty` has no pages and no AI pages; every other state has the sample. */
export const sampleContent = (state: StorefrontState) => {
  const entries = state === 'contentEmpty' ? [] : pages()
  const custom = state === 'contentEmpty' ? [] : customPaths
  const of = (kind: ContentKind) => entries.filter((e) => e.kind === kind)
  return {
    loadContentList: (kind: ContentKind) => Promise.resolve({ rows: of(kind), next: null }),
    loadCustomPaths: () => Promise.resolve(custom),
  }
}
