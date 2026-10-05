import type { ProductStory } from '../../api/story'

// The A+ editor's states under ?state= (ui/README.md §6): loading, error, empty (no modules yet), draft (never
// published), live, changed (a draft beside the live page), supplier, staff, readOnly.
export const storyStates = ['loading', 'error', 'empty', 'draft', 'live', 'changed', 'supplier', 'staff', 'readOnly'] as const

export type StoryState = (typeof storyStates)[number]

interface StorySample {
  seat: { permissions: string[]; seller: { id: string; name: string } | null }
  readOnly: boolean
  loaded: { productId: string; productName: string; story: ProductStory; blocks: { id: string; name: string }[]; video: 'on' | 'off' | 'plan' }
}

const owner = { permissions: ['catalog.read', 'catalog.write', 'stock.write'], seller: null }
const photo = { assetId: null, alt: null }
const module = (id: string, kind: string, title: string | null, extra: Partial<ProductStory['modules'][number]> = {}) => ({ id, kind, title, body: null, side: null, photo: null, items: null, photos: null, productIds: null, blockId: null, video: null, ...extra })

// A build-time constant Vite folds, so a production bundle carries none of these literals.
const story: ProductStory | null =
  import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'
    ? {
        revision: 3,
        status: 'live',
        template: 'fashion',
        publishedAt: '2026-10-01T10:00:00Z',
        products: [],
        modules: [
          module('m-banner', 'banner', 'Made to be lived in', { photo }),
          module('m-features', 'features', 'Why it’s worth it', { items: [{ title: 'Pre-washed', text: 'No shrinking after the first wash', photo: null }, { title: '180 gsm linen', text: null, photo: null }, { title: 'Woven in Jaipur', text: null, photo: null }] }),
          module('m-text', 'imageText', 'From flax to shirt', { body: 'Grown, spun and woven in one region, then stitched in our studio.', side: 'left', photo }),
        ],
      }
    : null

export const storySample = (state: StoryState | null): StorySample | null => {
  if (!story || !state || state === 'loading' || state === 'error') return null
  const loaded = { productId: 'p-mara', productName: 'Mara Linen Shirt', story, blocks: [{ id: 'sb-1', name: 'Our studio' }], video: 'plan' as const }
  switch (state) {
    case 'empty':
      return { seat: owner, readOnly: false, loaded: { ...loaded, story: { ...story, revision: 0, status: 'draft', template: null, publishedAt: null, modules: [] } } }
    case 'draft':
      return { seat: owner, readOnly: false, loaded: { ...loaded, story: { ...story, status: 'draft', publishedAt: null } } }
    case 'changed':
      return { seat: owner, readOnly: false, loaded: { ...loaded, story: { ...story, status: 'changed' } } }
    case 'supplier':
      return { seat: { permissions: ['catalog.read', 'catalog.write', 'stock.write'], seller: { id: 'seller-northwind', name: 'Northwind Textiles' } }, readOnly: false, loaded: { ...loaded, blocks: [], video: 'on' } }
    case 'staff':
      return { seat: { permissions: ['catalog.read'], seller: null }, readOnly: false, loaded }
    case 'readOnly':
      return { seat: owner, readOnly: true, loaded }
    default:
      return { seat: owner, readOnly: false, loaded }
  }
}
