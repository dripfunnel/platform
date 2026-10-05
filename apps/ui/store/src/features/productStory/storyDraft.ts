import type { StoredModule, StoryModuleInput } from '../../api/story'

// The A+ editor's draft (CatAPlus): each module as the form edits it. New modules start empty, with placeholders,
// never sample copy that could go live as the product's own (AGENTS "no invented data"); the API says what is
// missing when it is published (storyGaps).

export const storyKinds = ['banner', 'imageText', 'features', 'compare', 'gallery', 'box', 'specs', 'brand', 'faq', 'video'] as const
export type StoryKind = (typeof storyKinds)[number]

/** The API's caps (storyRules.ts): modules per story, and each kind's lists. */
export const maxModules = 10
export const maxFeatures = 4
export const maxGallery = 8
export const maxBoxItems = 20
export const maxCompared = 5

export const storyTemplates = { fashion: ['banner', 'features', 'imageText', 'gallery'], electronics: ['banner', 'features', 'compare', 'specs', 'box'], home: ['banner', 'imageText', 'gallery', 'brand'], beauty: ['banner', 'features', 'imageText', 'faq'] } as const satisfies Record<string, readonly StoryKind[]>
export type StoryTemplate = keyof typeof storyTemplates

export interface DraftPhoto {
  assetId: string | null
  alt: string
}

export interface DraftModule {
  id: string
  kind: StoryKind
  title: string
  body: string
  side: 'left' | 'right'
  photo: DraftPhoto
  items: { title: string; text: string; photo: DraftPhoto }[]
  photos: DraftPhoto[]
  productIds: string[]
  blockId: string | null
  videoUrl: string
}

const isKind = (k: string): k is StoryKind => (storyKinds as readonly string[]).includes(k)

const noPhoto = (): DraftPhoto => ({ assetId: null, alt: '' })

const photoOf = (p: { assetId: string | null; alt: string | null } | null): DraftPhoto => ({ assetId: p?.assetId ?? null, alt: p?.alt ?? '' })

/** A module id the API takes (letters, digits, - and _), unique enough within one story. */
export const newModuleId = (): string => `m${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`

export const blankModule = (kind: StoryKind): DraftModule => ({
  id: newModuleId(),
  kind,
  title: '',
  body: '',
  side: 'left',
  photo: noPhoto(),
  // Features read as three, the prototype's row; each is filled in before publishing.
  items: kind === 'features' ? [0, 1, 2].map(() => ({ title: '', text: '', photo: noPhoto() })) : kind === 'box' ? [{ title: '', text: '', photo: noPhoto() }] : [],
  photos: [],
  productIds: [],
  blockId: null,
  videoUrl: '',
})

/** The stored draft as the form edits it; a kind this editor doesn't know is left out rather than lost silently. */
export const modulesOf = (stored: readonly StoredModule[]): DraftModule[] =>
  stored.flatMap((m) =>
    isKind(m.kind)
      ? [
          {
            id: m.id,
            kind: m.kind,
            title: m.title ?? '',
            body: m.body ?? '',
            side: m.side === 'right' ? 'right' : 'left',
            photo: photoOf(m.photo),
            items: (m.items ?? []).map((i) => ({ title: i.title ?? '', text: i.text ?? '', photo: photoOf(i.photo) })),
            photos: (m.photos ?? []).map(photoOf),
            productIds: m.productIds ?? [],
            blockId: m.blockId,
            videoUrl: m.video?.url ?? '',
          },
        ]
      : [],
  )

type PhotoInput = { assetId: string; alt?: string }

const photoInput = (p: DraftPhoto): PhotoInput | undefined => (p.assetId ? { assetId: p.assetId, ...(p.alt.trim() ? { alt: p.alt.trim() } : {}) } : undefined)

/** `{ [key]: value }`, or nothing when there is no value: a field left out, never sent empty. */
const opt = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> => (value === undefined ? {} : ({ [key]: value } as Record<K, V>))

const words = (t: string): string | undefined => (t.trim() ? t.trim() : undefined)

/** Only the fields the module's kind has (the API refuses any other). */
export const moduleInput = (m: DraftModule): StoryModuleInput => {
  const base = { id: m.id, kind: m.kind, ...opt('title', m.kind === 'brand' ? undefined : words(m.title)) }
  switch (m.kind) {
    case 'banner':
      return { ...base, ...opt('photo', photoInput(m.photo)) }
    case 'imageText':
      return { ...base, ...opt('body', words(m.body)), side: m.side, ...opt('photo', photoInput(m.photo)) }
    case 'features':
      return { ...base, items: m.items.map((i) => ({ ...opt('title', words(i.title)), ...opt('text', words(i.text)), ...opt('photo', photoInput(i.photo)) })) }
    case 'box':
      return { ...base, items: m.items.map((i) => opt('title', words(i.title))) }
    case 'compare':
      return { ...base, productIds: m.productIds }
    case 'gallery':
      return { ...base, photos: m.photos.flatMap((p) => photoInput(p) ?? []) }
    case 'brand':
      return { ...base, ...opt('blockId', m.blockId ?? undefined) }
    case 'video':
      return { ...base, ...opt('video', m.videoUrl.trim() ? { url: m.videoUrl.trim() } : undefined) }
    case 'specs':
    case 'faq':
      return base
  }
}

/** A copy of a module under its own id, placed after it. */
export const duplicateModule = (m: DraftModule): DraftModule => ({ ...structuredClone(m), id: newModuleId() })

/** The modules with one moved up (-1) or down (+1); unchanged at either end. */
export const moved = (modules: readonly DraftModule[], index: number, by: -1 | 1): DraftModule[] => {
  const to = index + by
  if (to < 0 || to >= modules.length) return [...modules]
  const out = [...modules]
  const [m] = out.splice(index, 1)
  if (m) out.splice(to, 0, m)
  return out
}

export const sameModules = (a: readonly DraftModule[], b: readonly DraftModule[]): boolean => JSON.stringify(a) === JSON.stringify(b)
