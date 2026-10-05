import type { CollectionSummary } from '../../api/collections'
import type { Facet } from '../../api/productEditor'
import type { EditorReads } from './CollectionEditor'

// The Collections area's states under ?state= (ui/README.md §6): loading, error, empty, list, staff (looks only),
// readOnly (a store past due) and denied (a seat without the catalogue).
export const collectionsStates = ['loading', 'error', 'empty', 'list', 'staff', 'readOnly', 'denied'] as const

export type CollectionsState = (typeof collectionsStates)[number]

const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

export const sampleFacets: Facet[] = harness
  ? [
      { id: 'f-fabric', name: 'Fabric', shopperVisible: true, values: ['Linen', 'Cotton', 'Silk'].map((name) => ({ id: `fv-${name}`, name })) },
      { id: 'f-occasion', name: 'Occasion', shopperVisible: true, values: ['Everyday', 'Festive', 'Wedding'].map((name) => ({ id: `fv-${name}`, name })) },
      { id: 'f-reorder', name: 'Reorder soon', shopperVisible: false, values: [{ id: 'fv-yes', name: 'Yes' }] },
    ]
  : []

const rule = (valueId: string) => ({ kind: 'filter_value', valueId, text: null, productId: null, versionId: null, currency: null, min: null, max: null })
const summary = (c: Partial<CollectionSummary> & Pick<CollectionSummary, 'id' | 'name'>): CollectionSummary => ({
  kind: 'manual',
  visible: true,
  parentId: null,
  inheritParent: false,
  match: 'all',
  rules: [],
  products: 0,
  computedAt: '2026-10-05T09:00:00Z',
  ...c,
})

export const sampleCollections: CollectionSummary[] = harness
  ? [
      summary({ id: 'c-summer', name: 'Summer edit', kind: 'automatic', rules: [rule('fv-Linen'), rule('fv-Cotton')], products: 18 }),
      summary({ id: 'c-men', name: 'Men', products: 42 }),
      summary({ id: 'c-shirts', name: 'Shirts', parentId: 'c-men', inheritParent: true, kind: 'automatic', rules: [rule('fv-Linen')], products: 12 }),
      summary({ id: 'c-wedding', name: 'Wedding guest', kind: 'automatic', rules: [rule('fv-Wedding'), rule('fv-Silk')], products: 7, computedAt: null }),
      summary({ id: 'c-offer', name: 'Staff picks', visible: false, products: 5 }),
    ]
  : []

const sampleProducts = harness
  ? [
      { id: 'p1', name: 'Mara Linen Shirt', visible: true, approval: null, values: ['fv-Linen', 'fv-Everyday'] },
      { id: 'p2', name: 'Block-print Cushion Cover', visible: true, approval: null, values: ['fv-Cotton'] },
      { id: 'p3', name: 'Indigo Linen Kurta', visible: true, approval: null, values: ['fv-Linen', 'fv-Festive'] },
      { id: 'p4', name: 'Silk Dupatta', visible: false, approval: null, values: ['fv-Silk', 'fv-Wedding'] },
      { id: 'p5', name: 'Handloom Cotton Saree', visible: false, approval: 'pending', values: ['fv-Cotton', 'fv-Wedding'] },
    ]
  : []

/** The editor's reads under ?state=: the sample collections and products, matched in the browser. */
export const sampleReads: EditorReads = {
  collection: async (id) => {
    const s = sampleCollections.find((c) => c.id === id)
    return s ? { ...s, slug: id.replace(/^c-/, ''), description: '', imageAssetId: null, sort: 'newest', seoTitle: null, seoDescription: null, revision: 1 } : null
  },
  members: async () => sampleProducts.slice(0, 2).map(({ id, name }) => ({ id, name })),
  preview: async ({ rules, match }) => {
    const wanted = rules.flatMap((r) => (r.valueId ? [r.valueId] : []))
    const groups = sampleFacets.map((f) => f.values.map((v) => v.id).filter((v) => wanted.includes(v))).filter((g) => g.length > 0)
    const hit = sampleProducts.filter((p) => (match === 'any' ? wanted.some((v) => p.values.includes(v)) : groups.length > 0 && groups.every((g) => g.some((v) => p.values.includes(v)))))
    return { count: hit.length, products: hit.map(({ id, name }) => ({ id, name })) }
  },
  search: async (q) => sampleProducts.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).map(({ id, name, visible, approval }) => ({ id, name, visible, approval })),
}
