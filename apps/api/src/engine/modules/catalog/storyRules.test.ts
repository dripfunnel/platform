import { describe, expect, it } from 'vitest'
import { cleanStory, cleanStoryBlock, StoryInvalid, storyGaps } from './storyRules'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const self = id(99)
const refused = (work: () => unknown) => {
  try {
    work()
    return null
  } catch (error) {
    if (error instanceof StoryInvalid) return error.field
    throw error
  }
}
const one = (module: Record<string, unknown>) => cleanStory({ modules: [{ id: 'm', ...module } as { id: string; kind: string }] }, self, false).modules

describe('cleanStory', () => {
  it('keeps only the fields each kind has, trimmed, with placeholders left empty', () => {
    expect(one({ kind: 'imageText', title: '  Seed to shirt ', photo: { assetId: id(1).toUpperCase() } })).toEqual([
      { id: 'm', kind: 'imageText', title: 'Seed to shirt', body: null, side: 'left', photo: { assetId: id(1), alt: null } },
    ])
    expect(one({ kind: 'box', items: [{ title: 'Shirt' }, { title: '' }] })).toEqual([{ id: 'm', kind: 'box', title: null, items: [{ title: 'Shirt', text: null, photo: null }, { title: null, text: null, photo: null }] }])
    expect(one({ kind: 'brand', blockId: id(3) })).toEqual([{ id: 'm', kind: 'brand', blockId: id(3) }])
    expect(one({ kind: 'video', video: { url: 'https://videos.example/watch/1' } })).toEqual([{ id: 'm', kind: 'video', title: null, video: { assetId: null, url: 'https://videos.example/watch/1' } }])
  })

  it('refuses what the module can’t hold', () => {
    expect(refused(() => one({ kind: 'banner', items: [] }))).toBe('items')
    expect(refused(() => one({ kind: 'imageText', side: 'top' }))).toBe('side')
    expect(refused(() => one({ kind: 'features', items: Array.from({ length: 5 }, () => ({ title: 'x' })) }))).toBe('items')
    expect(refused(() => one({ kind: 'box', items: [{ title: 'x', photo: { assetId: id(1) } }] }))).toBe('items')
    expect(refused(() => one({ kind: 'gallery', photos: Array.from({ length: 9 }, () => ({})) }))).toBe('photos')
    expect(refused(() => one({ kind: 'compare', productIds: [id(1), id(2), id(3), id(4), id(5), id(6)] }))).toBe('productIds')
    expect(refused(() => one({ kind: 'video', video: { assetId: id(1), url: 'https://videos.example/1' } }))).toBe('video')
    expect(refused(() => one({ kind: 'banner', title: 'x'.repeat(121) }))).toBe('title')
    expect(refused(() => one({ kind: 'banner', photo: { assetId: 'not-a-file' } }))).toBe('photo')
    expect(refused(() => cleanStory({ modules: [{ id: 'has space', kind: 'faq' }] }, self, false))).toBe('id')
    expect(refused(() => cleanStory({ template: 'garden', modules: [] }, self, false))).toBe('template')
  })

  it('counts one comparison entry per product and keeps a supplier from the brand story', () => {
    expect(one({ kind: 'compare', productIds: [id(1), id(1).toUpperCase(), id(2)] })).toMatchObject([{ productIds: [id(1), id(2)] }])
    expect(refused(() => cleanStory({ modules: [{ id: 'b', kind: 'brand', blockId: id(1) }] }, self, true))).toBe('kind')
  })
})

describe('storyGaps', () => {
  it('names each unfinished module and field in order', () => {
    const modules = cleanStory(
      {
        modules: [
          { id: 'a', kind: 'banner', photo: { assetId: id(1) } },
          { id: 'b', kind: 'features', items: [{ title: 'One', photo: { assetId: id(2) } }, { title: 'Two' }] },
          { id: 'c', kind: 'compare', productIds: [id(3)] },
          { id: 'd', kind: 'gallery' },
          { id: 'e', kind: 'brand' },
          { id: 'f', kind: 'video' },
          { id: 'g', kind: 'specs' },
        ],
      },
      self,
      false,
    ).modules
    expect(storyGaps(modules)).toEqual([
      { moduleId: 'a', field: 'title' },
      { moduleId: 'a', field: 'alt' },
      { moduleId: 'b', field: 'items' },
      { moduleId: 'b', field: 'alt' },
      { moduleId: 'c', field: 'products' },
      { moduleId: 'd', field: 'photo' },
      { moduleId: 'e', field: 'block' },
      { moduleId: 'f', field: 'video' },
    ])
  })

  it('has nothing to say about a finished story', () => {
    const modules = one({ kind: 'imageText', body: 'Grown in Gujarat.', photo: { assetId: id(1), alt: 'Cotton field' } })
    expect(storyGaps(modules)).toEqual([])
  })
})

describe('cleanStoryBlock', () => {
  it('needs a name, a title and text, and a description for its photo', () => {
    expect(cleanStoryBlock({ name: 'Ours', title: 'Since 1998', body: 'Hand-loomed.', photo: { assetId: id(1), alt: 'The loom' } })).toEqual({
      name: 'Ours',
      content: { title: 'Since 1998', body: 'Hand-loomed.', photo: { assetId: id(1), alt: 'The loom' } },
    })
    expect(cleanStoryBlock({ name: 'Ours', title: 'T', body: 'B', photo: {} }).content.photo).toBeNull()
    expect(refused(() => cleanStoryBlock({ name: ' ', title: 'T', body: 'B' }))).toBe('name')
    expect(refused(() => cleanStoryBlock({ name: 'N', title: 'T', body: 'B', photo: { assetId: id(1) } }))).toBe('alt')
  })
})
