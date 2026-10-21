import type { StoredModule, StoryModuleInput } from '../../../api/productStory'

// The A+ editor's draft (CatAPlus): each module as the form edits it. A new module starts empty, never with sample copy that could
// go live as the product's own (AGENTS.md "No invented data"); the API says what is missing when it is published.

export const storyKinds = ['banner', 'imageText', 'features', 'compare', 'gallery', 'box', 'specs', 'brand', 'faq', 'video'] as const
export type StoryKind = (typeof storyKinds)[number]

/** The API's caps (storyRules.ts): modules per story, and each kind's lists. */
export const maxModules = 10
export const maxFeatures = 4
export const maxGallery = 8
export const maxBoxItems = 20
export const maxCompared = 5

export const storyTemplates = {
  fashion: ['banner', 'features', 'imageText', 'gallery'],
  electronics: ['banner', 'features', 'compare', 'specs', 'box'],
  home: ['banner', 'imageText', 'gallery', 'brand'],
  beauty: ['banner', 'features', 'imageText', 'faq'],
} as const satisfies Record<string, readonly StoryKind[]>
export type StoryTemplate = keyof typeof storyTemplates

export type DraftStoryPhoto = { assetId: string | null; alt: string; /** The phone's own file, shown while it uploads and after. */ localUri: string | null }

export type DraftModule = {
  id: string
  kind: StoryKind
  title: string
  body: string
  side: 'left' | 'right'
  photo: DraftStoryPhoto
  items: { title: string; text: string; photo: DraftStoryPhoto }[]
  photos: DraftStoryPhoto[]
  productIds: string[]
  blockId: string | null
  videoUrl: string
}

const isKind = (kind: string): kind is StoryKind => (storyKinds as readonly string[]).includes(kind)

const noPhoto = (): DraftStoryPhoto => ({ assetId: null, alt: '', localUri: null })

const photoOf = (photo: { assetId: string | null; alt: string | null } | null): DraftStoryPhoto => ({ assetId: photo?.assetId ?? null, alt: photo?.alt ?? '', localUri: null })

let counter = 0

/** A module id the API takes (letters, digits, - and _), unique within one story. */
const newModuleId = (): string => `m${Date.now().toString(36)}${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`

const blankItem = () => ({ title: '', text: '', photo: noPhoto() })

export const blankModule = (kind: StoryKind): DraftModule => ({
  id: newModuleId(),
  kind,
  title: '',
  body: '',
  side: 'left',
  photo: noPhoto(),
  items: kind === 'features' ? [blankItem(), blankItem(), blankItem()] : kind === 'box' ? [blankItem()] : [],
  photos: [],
  productIds: [],
  blockId: null,
  videoUrl: '',
})

/** The stored draft as the form edits it; a kind this editor doesn't know is left out rather than lost silently. */
export const modulesOf = (stored: readonly StoredModule[]): DraftModule[] =>
  stored.flatMap((module) =>
    isKind(module.kind)
      ? [
          {
            id: module.id,
            kind: module.kind,
            title: module.title ?? '',
            body: module.body ?? '',
            side: module.side === 'right' ? ('right' as const) : ('left' as const),
            photo: photoOf(module.photo),
            items: (module.items ?? []).map((item) => ({ title: item.title ?? '', text: item.text ?? '', photo: photoOf(item.photo) })),
            photos: (module.photos ?? []).map(photoOf),
            productIds: module.productIds ?? [],
            blockId: module.blockId,
            videoUrl: module.video?.url ?? '',
          },
        ]
      : [],
  )

const photoInput = (photo: DraftStoryPhoto): { assetId: string; alt?: string } | undefined => (photo.assetId ? { assetId: photo.assetId, ...(photo.alt.trim() ? { alt: photo.alt.trim() } : {}) } : undefined)

/** `{ [key]: value }`, or nothing when there is no value: a field left out, never sent empty. */
const opt = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> => (value === undefined ? {} : ({ [key]: value } as Record<K, V>))

const words = (text: string): string | undefined => (text.trim() ? text.trim() : undefined)

/** Only the fields the module's kind has (the API refuses any other). */
export const moduleInput = (module: DraftModule): StoryModuleInput => {
  const base = { id: module.id, kind: module.kind, ...opt('title', module.kind === 'brand' ? undefined : words(module.title)) }
  switch (module.kind) {
    case 'banner':
      return { ...base, ...opt('photo', photoInput(module.photo)) }
    case 'imageText':
      return { ...base, ...opt('body', words(module.body)), side: module.side, ...opt('photo', photoInput(module.photo)) }
    case 'features':
      return { ...base, items: module.items.map((item) => ({ ...opt('title', words(item.title)), ...opt('text', words(item.text)), ...opt('photo', photoInput(item.photo)) })) }
    case 'box':
      return { ...base, items: module.items.map((item) => opt('title', words(item.title))) }
    case 'compare':
      return { ...base, productIds: module.productIds }
    case 'gallery':
      return { ...base, photos: module.photos.flatMap((photo) => photoInput(photo) ?? []) }
    case 'brand':
      return { ...base, ...opt('blockId', module.blockId ?? undefined) }
    case 'video':
      return { ...base, ...opt('video', module.videoUrl.trim() ? { url: module.videoUrl.trim() } : undefined) }
    case 'specs':
    case 'faq':
      return base
  }
}

/** A copy of a module under its own id, placed after it. */
export const duplicateModule = (module: DraftModule): DraftModule => ({ ...JSON.parse(JSON.stringify(module)), id: newModuleId() }) as DraftModule

/** The modules with one moved up (-1) or down (+1); unchanged at either end. */
export const moved = (modules: readonly DraftModule[], index: number, by: -1 | 1): DraftModule[] => {
  const to = index + by
  if (to < 0 || to >= modules.length) return [...modules]
  const out = [...modules]
  const [module] = out.splice(index, 1)
  if (module) out.splice(to, 0, module)
  return out
}

export const sameModules = (a: readonly DraftModule[], b: readonly DraftModule[]): boolean => JSON.stringify(a) === JSON.stringify(b)

const photosOf = (module: DraftModule): DraftStoryPhoto[] => [module.photo, ...module.items.map((item) => item.photo), ...module.photos]

/** Whether a photo is still on its way to the API (picked, not yet answered with an asset): a save would leave it out. */
export const hasUploading = (modules: readonly DraftModule[]): boolean => modules.some((module) => photosOf(module).some((photo) => photo.localUri !== null && photo.assetId === null))
