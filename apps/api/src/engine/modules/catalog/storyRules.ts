import { isVideoUrl } from './rules'

// A+ content before it is written (CATALOG Q): pure, as listing.ts. A draft may be unfinished (Q9);
// `storyGaps` says what still stops it going live.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const moduleId = /^[A-Za-z0-9_-]{1,40}$/

export const storyKinds = ['banner', 'imageText', 'features', 'compare', 'gallery', 'box', 'specs', 'brand', 'faq', 'video'] as const
export type StoryKind = (typeof storyKinds)[number]
export const storyTemplates = ['fashion', 'electronics', 'home', 'beauty'] as const

export const maxModules = 10
export const maxCopyTargets = 50
const maxFeatures = 4
const maxGallery = 8
const maxBoxItems = 20
const maxCompared = 5

export class StoryInvalid extends Error {
  constructor(readonly field: string) {
    super(`story: ${field}`)
  }
}

export interface StoryPhoto {
  assetId: string | null
  alt: string | null
}

export interface StoryItem {
  title: string | null
  text: string | null
  photo: StoryPhoto | null
}

/** One module as stored: only the fields its kind has (CatAPlus). */
export type StoryModule =
  | { id: string; kind: 'banner'; title: string | null; photo: StoryPhoto }
  | { id: string; kind: 'imageText'; title: string | null; body: string | null; side: 'left' | 'right'; photo: StoryPhoto }
  | { id: string; kind: 'features'; title: string | null; items: StoryItem[] }
  | { id: string; kind: 'compare'; title: string | null; productIds: string[] }
  | { id: string; kind: 'gallery'; title: string | null; photos: StoryPhoto[] }
  | { id: string; kind: 'box'; title: string | null; items: StoryItem[] }
  | { id: string; kind: 'specs' | 'faq'; title: string | null }
  | { id: string; kind: 'brand'; blockId: string | null }
  | { id: string; kind: 'video'; title: string | null; video: { assetId: string | null; url: string | null } }

export interface StoryModuleInput {
  id: string
  kind: string
  title?: string | null | undefined
  body?: string | null | undefined
  side?: string | null | undefined
  photo?: { assetId?: string | null | undefined; alt?: string | null | undefined } | null | undefined
  items?: readonly { title?: string | null | undefined; text?: string | null | undefined; photo?: { assetId?: string | null | undefined; alt?: string | null | undefined } | null | undefined }[] | null | undefined
  photos?: readonly { assetId?: string | null | undefined; alt?: string | null | undefined }[] | null | undefined
  productIds?: readonly string[] | null | undefined
  blockId?: string | null | undefined
  video?: { assetId?: string | null | undefined; url?: string | null | undefined } | null | undefined
}

type Field = Exclude<keyof StoryModuleInput, 'id' | 'kind'>
const fieldsOf: Record<StoryKind, readonly Field[]> = {
  banner: ['title', 'photo'],
  imageText: ['title', 'body', 'side', 'photo'],
  features: ['title', 'items'],
  compare: ['title', 'productIds'],
  gallery: ['title', 'photos'],
  box: ['title', 'items'],
  specs: ['title'],
  faq: ['title'],
  brand: ['blockId'],
  video: ['title', 'video'],
}

const text = (value: string | null | undefined, max: number, field: string): string | null => {
  const trimmed = value?.trim() ?? ''
  if (trimmed.length > max) throw new StoryInvalid(field)
  return trimmed === '' ? null : trimmed
}

const id = (value: string | null | undefined, field: string): string | null => {
  const trimmed = value?.trim().toLowerCase() ?? ''
  if (trimmed === '') return null
  if (!uuid.test(trimmed)) throw new StoryInvalid(field)
  return trimmed
}

const photo = (value: StoryModuleInput['photo']): StoryPhoto => ({ assetId: id(value?.assetId, 'photo'), alt: text(value?.alt, 250, 'alt') })

const items = (values: StoryModuleInput['items'], max: number, withPhotos: boolean): StoryItem[] => {
  const list = values ?? []
  if (list.length > max) throw new StoryInvalid('items')
  return list.map((item) => {
    if (!withPhotos && item.photo) throw new StoryInvalid('items')
    return { title: text(item.title, 80, 'items'), text: withPhotos ? text(item.text, 300, 'items') : null, photo: withPhotos && item.photo ? photo(item.photo) : null }
  })
}

const cleanModule = (input: StoryModuleInput, productId: string): StoryModule => {
  if (!moduleId.test(input.id)) throw new StoryInvalid('id')
  const kind = storyKinds.find((k) => k === input.kind)
  if (!kind) throw new StoryInvalid('kind')
  const allowed = fieldsOf[kind]
  for (const key of Object.keys(input) as (keyof StoryModuleInput)[]) {
    if (key !== 'id' && key !== 'kind' && input[key] !== undefined && input[key] !== null && !allowed.includes(key)) throw new StoryInvalid(key)
  }
  const title = text(input.title, 120, 'title')
  switch (kind) {
    case 'banner':
      return { id: input.id, kind, title, photo: photo(input.photo) }
    case 'imageText': {
      const side = input.side ?? 'left'
      if (side !== 'left' && side !== 'right') throw new StoryInvalid('side')
      return { id: input.id, kind, title, body: text(input.body, 1000, 'body'), side, photo: photo(input.photo) }
    }
    case 'features':
      return { id: input.id, kind, title, items: items(input.items, maxFeatures, true) }
    case 'box':
      return { id: input.id, kind, title, items: items(input.items, maxBoxItems, false) }
    case 'compare': {
      const ids = [...new Set((input.productIds ?? []).map((p) => id(p, 'productIds')))]
      if (ids.length > maxCompared || ids.some((p) => p === null || p === productId)) throw new StoryInvalid('productIds')
      return { id: input.id, kind, title, productIds: ids.filter((p): p is string => p !== null) }
    }
    case 'gallery': {
      const photos = input.photos ?? []
      if (photos.length > maxGallery) throw new StoryInvalid('photos')
      return { id: input.id, kind, title, photos: photos.map(photo) }
    }
    case 'specs':
    case 'faq':
      return { id: input.id, kind, title }
    case 'brand':
      return { id: input.id, kind, blockId: id(input.blockId, 'blockId') }
    case 'video': {
      const assetId = id(input.video?.assetId, 'video')
      const url = text(input.video?.url, 500, 'video')
      if ((assetId !== null && url !== null) || (url !== null && !isVideoUrl(url))) throw new StoryInvalid('video')
      return { id: input.id, kind, title, video: { assetId, url } }
    }
  }
}

export interface StoryInput {
  template?: string | null | undefined
  modules: readonly StoryModuleInput[]
}

export interface CleanStory {
  template: string | null
  modules: StoryModule[]
}

/** A supplier's story never carries the merchant's brand story (Q5). */
export const cleanStory = (input: StoryInput, productId: string, supplier: boolean): CleanStory => {
  const template = input.template ?? null
  if (template !== null && !(storyTemplates as readonly string[]).includes(template)) throw new StoryInvalid('template')
  if (input.modules.length > maxModules) throw new StoryInvalid('modules')
  const modules = input.modules.map((m) => cleanModule(m, productId))
  if (new Set(modules.map((m) => m.id)).size !== modules.length) throw new StoryInvalid('id')
  if (supplier && modules.some((m) => m.kind === 'brand')) throw new StoryInvalid('kind')
  return { template, modules }
}

export type StoryGapField = 'title' | 'body' | 'photo' | 'alt' | 'items' | 'products' | 'block' | 'video'
export interface StoryGap {
  moduleId: string
  field: StoryGapField
}

const photoGaps = (moduleId: string, p: StoryPhoto | null, required: boolean): StoryGap[] => {
  if (!p?.assetId) return required ? [{ moduleId, field: 'photo' }] : []
  return p.alt ? [] : [{ moduleId, field: 'alt' }]
}

/** What stops the draft going live, in module order: every photo described (Q7), every placeholder replaced (Q4). */
export const storyGaps = (modules: readonly StoryModule[]): StoryGap[] =>
  modules.flatMap((m): StoryGap[] => {
    const gap = (field: StoryGapField): StoryGap[] => [{ moduleId: m.id, field }]
    switch (m.kind) {
      case 'banner':
        return [...(m.title ? [] : gap('title')), ...photoGaps(m.id, m.photo, true)]
      case 'imageText':
        return [...(m.body ? [] : gap('body')), ...photoGaps(m.id, m.photo, true)]
      case 'features':
        return [...(m.items.length >= 3 && m.items.every((i) => i.title) ? [] : gap('items')), ...m.items.flatMap((i) => photoGaps(m.id, i.photo, false))]
      case 'box':
        return m.items.length > 0 && m.items.every((i) => i.title) ? [] : gap('items')
      case 'compare':
        return m.productIds.length >= 2 ? [] : gap('products')
      case 'gallery':
        return m.photos.length > 0 ? m.photos.flatMap((p) => photoGaps(m.id, p, true)) : gap('photo')
      case 'brand':
        return m.blockId ? [] : gap('block')
      case 'video':
        return m.video.assetId || m.video.url ? [] : gap('video')
      case 'specs':
      case 'faq':
        return []
    }
  })

export interface StoryBlockInput {
  name: string
  title: string
  body: string
  photo?: { assetId?: string | null | undefined; alt?: string | null | undefined } | null | undefined
}

export const cleanStoryBlock = (input: StoryBlockInput) => {
  const name = text(input.name, 80, 'name')
  const title = text(input.title, 120, 'title')
  const body = text(input.body, 1000, 'body')
  if (name === null || title === null || body === null) throw new StoryInvalid(name === null ? 'name' : title === null ? 'title' : 'body')
  const picture = input.photo ? photo(input.photo) : null
  // A brand story is shown as saved, on every product at once, so its photo is described now.
  if (picture?.assetId && !picture.alt) throw new StoryInvalid('alt')
  return { name, content: { title, body, photo: picture?.assetId ? picture : null } }
}
