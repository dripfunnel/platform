import { afterEach, describe, expect, it, vi } from 'vitest'

const answering = (data: unknown) => vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data })))

afterEach(() => vi.unstubAllGlobals())

describe('the Journal API', () => {
  const block = { kind: 'text', text: 'Hello', assetId: null, alt: null, items: null, productIds: null }
  const entry = { id: 'e1', title: 'Care tips', path: '/blog/care', status: 'published', publishAt: null, author: null, waitingForPublish: false, updatedAt: '2026-10-31T10:00:00Z', slug: 'care', body: [block], seoTitle: null, seoDescription: null, tags: [], coverAssetId: null, revision: 1 }

  it('opens a post', async () => {
    answering({ contentEntry: { kind: 'post', ...entry } })
    const { loadContentEntry } = await import('./content')
    expect((await loadContentEntry('e1'))?.title).toBe('Care tips')
  })

  it('reads a content page’s id as missing, even one with a contact form', async () => {
    answering({ contentEntry: { kind: 'page', ...entry, path: '/contact', body: [{ ...block, kind: 'form', text: null }] } })
    const { loadContentEntry } = await import('./content')
    expect(await loadContentEntry('e1')).toBeNull()
  })
})
