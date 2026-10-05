import { describe, expect, it } from 'vitest'
import type { StoredModule } from '../../api/story'
import { blankModule, duplicateModule, moduleInput, modulesOf, moved, newModuleId, storyKinds, storyTemplates } from './storyDraft'

const stored = (m: Partial<StoredModule> & Pick<StoredModule, 'id' | 'kind'>): StoredModule => ({ title: null, body: null, side: null, photo: null, items: null, photos: null, productIds: null, blockId: null, video: null, ...m })

describe('the A+ draft (CatAPlus)', () => {
  it('starts a module empty, with its kind’s rows, never sample copy', () => {
    expect(blankModule('banner')).toMatchObject({ kind: 'banner', title: '', body: '', items: [] })
    expect(blankModule('features').items.map((i) => i.title)).toEqual(['', '', ''])
    expect(blankModule('box').items).toHaveLength(1)
    expect(newModuleId()).toMatch(/^[A-Za-z0-9_-]{1,40}$/)
  })

  it('sends only the fields a module’s kind has, and nothing empty', () => {
    const banner = { ...blankModule('banner'), id: 'a', title: ' Linen ', body: 'never sent', photo: { assetId: 'f1', alt: ' On a chair ' } }
    expect(moduleInput(banner)).toEqual({ id: 'a', kind: 'banner', title: 'Linen', photo: { assetId: 'f1', alt: 'On a chair' } })
    expect(moduleInput({ ...blankModule('imageText'), id: 'b', body: 'Two lines', side: 'right' })).toEqual({ id: 'b', kind: 'imageText', body: 'Two lines', side: 'right' })
    expect(moduleInput({ ...blankModule('box'), id: 'c', items: [{ title: 'A shirt', text: 'dropped', photo: { assetId: 'f', alt: '' } }] })).toEqual({ id: 'c', kind: 'box', items: [{ title: 'A shirt' }] })
    expect(moduleInput({ ...blankModule('gallery'), id: 'd', photos: [{ assetId: null, alt: '' }, { assetId: 'f2', alt: '' }] })).toEqual({ id: 'd', kind: 'gallery', photos: [{ assetId: 'f2' }] })
    expect(moduleInput({ ...blankModule('brand'), id: 'e', title: 'never sent', blockId: 'b1' })).toEqual({ id: 'e', kind: 'brand', blockId: 'b1' })
    expect(moduleInput({ ...blankModule('video'), id: 'f', videoUrl: ' https://vimeo.com/1 ' })).toEqual({ id: 'f', kind: 'video', video: { url: 'https://vimeo.com/1' } })
    expect(moduleInput({ ...blankModule('specs'), id: 'g' })).toEqual({ id: 'g', kind: 'specs' })
  })

  it('reads a stored draft back, leaving out a kind it doesn’t know', () => {
    const read = modulesOf([stored({ id: 'a', kind: 'imageText', title: 'T', body: 'B', side: 'right', photo: { assetId: 'f', alt: null } }), stored({ id: 'z', kind: 'hologram' })])
    expect(read).toHaveLength(1)
    expect(read[0]).toMatchObject({ id: 'a', title: 'T', body: 'B', side: 'right', photo: { assetId: 'f', alt: '' } })
    expect(moduleInput(read[0] ?? blankModule('banner'))).toEqual({ id: 'a', kind: 'imageText', title: 'T', body: 'B', side: 'right', photo: { assetId: 'f' } })
  })

  it('moves, duplicates under a new id, and keeps every template within the kinds', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((id) => ({ ...blankModule('faq'), id }))
    const list = [a, b, c].filter((m) => m !== undefined)
    expect(moved(list, 0, 1).map((m) => m.id)).toEqual(['b', 'a', 'c'])
    expect(moved(list, 0, -1).map((m) => m.id)).toEqual(['a', 'b', 'c'])
    const copy = duplicateModule({ ...blankModule('features'), id: 'x', title: 'Why' })
    expect([copy.id === 'x', copy.title]).toEqual([false, 'Why'])
    expect(Object.values(storyTemplates).flat().every((k) => (storyKinds as readonly string[]).includes(k))).toBe(true)
  })
})
