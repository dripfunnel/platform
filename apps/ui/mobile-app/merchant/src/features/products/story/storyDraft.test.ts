import type { StoredModule } from '../../../api/productStory'
import { blankModule, duplicateModule, hasUploading, modulesOf, moduleInput, moved, sameModules, type DraftModule } from './storyDraft'

const stored = (kind: string, extra: Partial<StoredModule> = {}): StoredModule => ({ id: `m-${kind}`, kind, title: null, body: null, side: null, photo: null, items: null, photos: null, productIds: null, blockId: null, video: null, ...extra })

describe('A+ module drafts', () => {
  it('start empty, so no sample copy can go live as the product’s own', () => {
    const features = blankModule('features')
    expect(features.items).toHaveLength(3)
    expect(features.items.every((item) => item.title === '' && item.text === '' && item.photo.assetId === null)).toBe(true)
    expect(blankModule('banner').title).toBe('')
  })

  it('send only the fields their kind has, and leave out what is empty', () => {
    const banner = { ...blankModule('banner'), id: 'm1', title: ' Made to be lived in ', photo: { assetId: 'a-1', alt: ' A shirt ', localUri: 'file:///x.jpg' } }
    expect(moduleInput(banner)).toEqual({ id: 'm1', kind: 'banner', title: 'Made to be lived in', photo: { assetId: 'a-1', alt: 'A shirt' } })
    expect(moduleInput({ ...blankModule('banner'), id: 'm2' })).toEqual({ id: 'm2', kind: 'banner' })
    expect(moduleInput({ ...blankModule('brand'), id: 'm3', title: 'ignored', blockId: 'sb-1' })).toEqual({ id: 'm3', kind: 'brand', blockId: 'sb-1' })
    expect(moduleInput({ ...blankModule('compare'), id: 'm4', productIds: ['p-1', 'p-2'] })).toEqual({ id: 'm4', kind: 'compare', productIds: ['p-1', 'p-2'] })
    expect(moduleInput({ ...blankModule('video'), id: 'm5', videoUrl: ' https://youtu.be/x ' })).toEqual({ id: 'm5', kind: 'video', video: { url: 'https://youtu.be/x' } })
    expect(moduleInput({ ...blankModule('specs'), id: 'm6' })).toEqual({ id: 'm6', kind: 'specs' })
  })

  it('read a stored draft back, leaving out a kind this editor doesn’t know rather than losing it silently', () => {
    const modules = modulesOf([stored('banner', { title: 'Hi', photo: { assetId: 'a-1', alt: null } }), stored('hologram')])
    expect(modules).toHaveLength(1)
    expect(modules[0]).toMatchObject({ kind: 'banner', title: 'Hi', photo: { assetId: 'a-1', alt: '' } })
  })

  it('move up and down, copy under their own id, and compare by value', () => {
    const [a, b, c] = ['banner', 'imageText', 'gallery'].map((kind) => blankModule(kind as DraftModule['kind']))
    const list = [a, b, c] as DraftModule[]
    expect(moved(list, 1, -1).map((m) => m.kind)).toEqual(['imageText', 'banner', 'gallery'])
    expect(moved(list, 0, -1)).toEqual(list)
    expect(moved(list, 2, 1)).toEqual(list)
    const copy = duplicateModule(list[1] as DraftModule)
    expect(copy.id).not.toBe(b?.id)
    expect({ ...copy, id: b?.id }).toEqual(b)
    expect(sameModules(list, [...list])).toBe(true)
    expect(sameModules(list, moved(list, 1, -1))).toBe(false)
  })

  it('know when a photo is still on its way, since a save would leave it out', () => {
    const uploading = { ...blankModule('banner'), photo: { assetId: null, alt: '', localUri: 'file:///x.jpg' } }
    const done = { ...blankModule('banner'), photo: { assetId: 'a-1', alt: '', localUri: 'file:///x.jpg' } }
    expect(hasUploading([uploading])).toBe(true)
    expect(hasUploading([done, blankModule('imageText')])).toBe(false)
  })
})
