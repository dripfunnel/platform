import { describe, expect, it } from 'vitest'
import type { ContentEntry } from '../../api/content'
import { translationDraftOf, translationInputOf, writtenOf } from './contentTranslation'

const block = (kind: ContentEntry['body'][number]['kind'], more: Partial<ContentEntry['body'][number]> = {}) => ({ kind, text: null, assetId: null, alt: null, items: null, productIds: null, ...more })
const main: ContentEntry = {
  id: 'p',
  kind: 'page',
  title: 'About',
  slug: 'about',
  path: '/about',
  status: 'published',
  inMenu: false,
  publishAt: null,
  author: null,
  waitingForPublish: false,
  updatedAt: '2026-10-09T10:40:00Z',
  seoTitle: null,
  seoDescription: 'Who we are.',
  tags: [],
  coverAssetId: null,
  revision: 1,
  body: [block('heading', { text: 'Our story' }), block('image', { assetId: 'a1', alt: 'Printers' }), block('faq', { items: [{ question: 'Q?', answer: 'A.' }] }), block('form')],
}

describe('a translation', () => {
  it('keeps the words written for a block of the same kind, and starts the others empty', () => {
    const draft = translationDraftOf(main, { language: 'hi', title: 'हम', body: [block('heading', { text: 'कहानी' }), block('text', { text: 'x' })], seoTitle: null, seoDescription: null, changed: false })
    expect(draft.title).toBe('हम')
    expect(draft.blocks.map((b) => b.text)).toEqual(['कहानी', '', '', ''])
    expect(draft.blocks[2]?.items).toEqual([{ question: '', answer: '' }])
  })

  it('sends the page’s blocks with the main words where a field is empty, photos and the form as they are', () => {
    const draft = translationDraftOf(main, null)
    expect(translationInputOf(main, { ...draft, blocks: draft.blocks.map((b, i) => (i === 1 ? { ...b, alt: 'छपाई' } : b)) })).toEqual({
      title: 'About',
      body: [{ kind: 'heading', text: 'Our story' }, { kind: 'image', assetId: 'a1', alt: 'छपाई' }, { kind: 'faq', items: [{ question: 'Q?', answer: 'A.' }] }, { kind: 'form' }],
      seoTitle: null,
      seoDescription: null,
    })
  })

  it('reads back what a save wrote, a field left empty now holding the main words', () => {
    const input = translationInputOf(main, { ...translationDraftOf(main, null), title: 'हम' })
    const again = translationDraftOf(main, writtenOf('hi', input))
    expect(again.title).toBe('हम')
    expect(again.blocks.map((b) => b.text || b.alt)).toEqual(['Our story', 'Printers', '', ''])
    expect(again.blocks[2]?.items).toEqual([{ question: 'Q?', answer: 'A.' }])
  })
})
