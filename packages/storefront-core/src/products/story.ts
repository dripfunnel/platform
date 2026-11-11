import { z } from 'zod'
import { photoSchema, videoSchema, type Photo, type VideoFile } from '../platform/media/photo'
import { cardsSchema, summaryFields, type ProductCard } from './summary'

// A product's published A+ content (ShopProduct.story, apps/api/src/engine/modules/catalog/storyRules.ts): the modules
// in the merchant's order. A kind core doesn't know, or a module with nothing to show, is left out.

const photoFields = 'alt image { url }'
export const storyFields = `storyTemplate story { id kind title body side photo { ${photoFields} } photos { ${photoFields} } items { title text photo { ${photoFields} } } block { title body photo { ${photoFields} } } products { ${summaryFields} } video { file { url } url } }`

export type StoryItem = { title: string | null; text: string | null; photo: Photo | null }

export type StoryModule =
  | { id: string; kind: 'banner'; title: string | null; photo: Photo }
  | { id: string; kind: 'imageText'; title: string | null; body: string | null; side: 'left' | 'right'; photo: Photo }
  | { id: string; kind: 'features'; title: string | null; items: StoryItem[] }
  | { id: string; kind: 'compare'; title: string | null; products: ProductCard[] }
  | { id: string; kind: 'gallery'; title: string | null; photos: Photo[] }
  | { id: string; kind: 'box'; title: string | null; items: StoryItem[] }
  /** Their content is the product's own specifications and questions. */
  | { id: string; kind: 'specs' | 'faq'; title: string | null }
  | { id: string; kind: 'brand'; title: string | null; body: string | null; photo: Photo | null }
  /** `file` is an upload; `link` the address of a video hosted elsewhere, which core links to and never embeds. */
  | { id: string; kind: 'video'; title: string | null; file: VideoFile | null; link: string | null }

const text = z.string().nullable().optional()
const photo = photoSchema.nullable().optional().catch(null)
const item = z.object({ title: text, text, photo })

const rawModule = z.object({
  id: z.string().min(1),
  kind: z.string(),
  title: text,
  body: text,
  side: text,
  photo,
  photos: z.array(photo).nullable().optional().catch(null),
  items: z.array(item).nullable().optional().catch(null),
  products: cardsSchema.catch([]),
  block: z.object({ title: text, body: text, photo }).nullable().optional().catch(null),
  video: z.object({ file: z.object({ url: text }).nullable().optional(), url: text }).nullable().optional().catch(null),
})
type Raw = z.infer<typeof rawModule>

const words = (value: string | null | undefined) => (value && value.trim() !== '' ? value : null)
const itemsOf = (raw: Raw): StoryItem[] => (raw.items ?? []).flatMap((i) => (words(i.title) ? [{ title: words(i.title), text: words(i.text), photo: i.photo ?? null }] : []))
const secure = (value: string | null | undefined) => (value && /^https:\/\//i.test(value) ? value : null)

const moduleOf = (raw: Raw): StoryModule | null => {
  const base = { id: raw.id, title: words(raw.title) }
  switch (raw.kind) {
    case 'banner':
      return raw.photo ? { ...base, kind: 'banner', photo: raw.photo } : null
    case 'imageText':
      return raw.photo ? { ...base, kind: 'imageText', body: words(raw.body), side: raw.side === 'right' ? 'right' : 'left', photo: raw.photo } : null
    case 'features':
    case 'box': {
      const items = itemsOf(raw)
      return items.length > 0 ? { ...base, kind: raw.kind, items } : null
    }
    case 'compare':
      return raw.products.length >= 2 ? { ...base, kind: 'compare', products: raw.products } : null
    case 'gallery': {
      const photos = (raw.photos ?? []).flatMap((p) => p ?? [])
      return photos.length > 0 ? { ...base, kind: 'gallery', photos } : null
    }
    case 'specs':
    case 'faq':
      return { ...base, kind: raw.kind }
    case 'brand':
      return raw.block && (words(raw.block.body) || raw.block.photo) ? { id: raw.id, kind: 'brand', title: words(raw.block.title) ?? base.title, body: words(raw.block.body), photo: raw.block.photo ?? null } : null
    case 'video': {
      const file = videoSchema.parse({ file: raw.video?.file })
      const link = secure(raw.video?.url)
      return file || link ? { ...base, kind: 'video', file, link } : null
    }
    default:
      return null
  }
}

/** The modules core can draw, in the answer's order; one that fails to decode is left out rather than failing the page. */
export const storySchema = z
  .array(z.unknown())
  .nullable()
  .optional()
  .transform((list) =>
    (list ?? []).flatMap((m) => {
      const parsed = rawModule.safeParse(m)
      return parsed.success ? (moduleOf(parsed.data) ?? []) : []
    }),
  )
