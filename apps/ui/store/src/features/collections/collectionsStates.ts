import type { CollectionRule, CollectionSummary } from '../../api/collections'
import type { Filter } from '../../api/filters'
import type { Menu } from '../../api/menu'
import type { SizeChart } from '../../api/sizeCharts'
import type { EditorReads } from './CollectionEditor'
import type { ChartReads } from './SizeChartsArea'

// The Collections area's states under ?state= (ui/README.md §6): loading, error, empty, list, staff (looks only),
// readOnly (a store past due) and denied (a seat without the catalogue).
export const collectionsStates = ['loading', 'error', 'empty', 'list', 'staff', 'readOnly', 'denied'] as const

export type CollectionsState = (typeof collectionsStates)[number]

const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

const values = (counts: Record<string, number>) => Object.entries(counts).map(([name, products]) => ({ id: `fv-${name}`, name, products }))

export const sampleFilters: Filter[] = harness
  ? [
      { id: 'f-fabric', name: 'Fabric', position: 0, revision: 1, shopperVisible: true, values: values({ Linen: 9, Cotton: 14, Silk: 3 }) },
      { id: 'f-colour', name: 'Colour', position: 1, revision: 1, shopperVisible: true, values: values({ 'Off-white': 6, 'Off white': 2, Indigo: 5 }) },
      { id: 'f-occasion', name: 'Occasion', position: 2, revision: 1, shopperVisible: true, values: values({ Everyday: 11, Festive: 7, Wedding: 4 }) },
      { id: 'f-reorder', name: 'Reorder soon', position: 3, revision: 1, shopperVisible: false, values: values({ Yes: 2 }) },
    ]
  : []

export const sampleMenu: Menu | null = harness
  ? {
      name: 'Main menu',
      revision: 3,
      items: [
        { id: 'm1', parentId: null, kind: 'collection', label: 'Summer edit', collectionId: 'c-summer', url: null },
        { id: 'm2', parentId: null, kind: 'collection', label: 'Men', collectionId: 'c-men', url: null },
        { id: 'm3', parentId: 'm2', kind: 'collection', label: 'Shirts', collectionId: 'c-shirts', url: null },
        { id: 'm4', parentId: null, kind: 'collection', label: 'Staff picks', collectionId: 'c-offer', url: null },
      ],
    }
  : null

const block = (kind: string, rest: Partial<CollectionRule>): CollectionRule => ({ kind, joiner: 'and', valueIds: [], valueMatch: null, productIds: [], text: null, productId: null, versionId: null, currency: null, min: null, max: null, ...rest })
const rule = (valueIds: string[], joiner = 'and') => block('filter_value', { valueIds, valueMatch: 'any', joiner })
const picks = (productIds: string[]) => block('picks', { productIds })
const summary = (c: Partial<CollectionSummary> & Pick<CollectionSummary, 'id' | 'name'>): CollectionSummary => ({
  visible: true,
  parentId: null,
  inheritParent: false,
  imageAssetId: null,
  rules: [],
  products: 0,
  computedAt: '2026-10-05T09:00:00Z',
  ...c,
})

export const sampleCollections: CollectionSummary[] = harness
  ? [
      summary({ id: 'c-summer', name: 'Summer edit', rules: [rule(['fv-Linen', 'fv-Cotton'])], products: 18 }),
      summary({ id: 'c-men', name: 'Men', rules: [picks(['p1', 'p2'])], products: 42 }),
      summary({ id: 'c-shirts', name: 'Shirts', parentId: 'c-men', inheritParent: true, rules: [rule(['fv-Linen'])], products: 12 }),
      summary({ id: 'c-wedding', name: 'Wedding guest', rules: [rule(['fv-Wedding']), rule(['fv-Silk'])], products: 7, computedAt: null }),
      summary({ id: 'c-offer', name: 'Staff picks', visible: false, rules: [picks(['p3'])], products: 5 }),
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
  // AND binds tighter than OR, as the API reads the blocks.
  preview: async ({ rules }) => {
    const matches = (p: (typeof sampleProducts)[number], r: (typeof rules)[number]) =>
      r.kind === 'picks' ? (r.productIds ?? []).includes(p.id) : r.kind === 'name_contains' ? p.name.toLowerCase().includes((r.text ?? '').toLowerCase()) : r.valueMatch === 'all' ? (r.valueIds ?? []).every((v) => p.values.includes(v)) : (r.valueIds ?? []).some((v) => p.values.includes(v))
    const groups = rules.reduce<(typeof rules)[]>((acc, r, i) => (i === 0 || r.joiner === 'or' ? [...acc, [r]] : [...acc.slice(0, -1), [...(acc.at(-1) ?? []), r]]), [])
    const hit = sampleProducts.filter((p) => groups.some((g) => g.every((r) => matches(p, r))))
    return { count: hit.length, products: hit.map(({ id, name }) => ({ id, name, imageAssetId: null })) }
  },
  search: async (q) => sampleProducts.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).map(({ id, name, visible, approval }) => ({ id, name, visible, approval, photoUrl: null })),
}

const sampleCharts: SizeChart[] = harness
  ? [
      {
        id: 'sc-tops',
        name: 'Tops & shirts',
        unit: 'cm',
        systems: [],
        measurements: ['Chest', 'Waist', 'Length'],
        rows: ['S', 'M', 'L', 'XL'].map((size, i) => ({ size, values: [86 + i * 5, 71 + i * 5, 68 + i * 2].map(String) })),
        howToMeasure: [],
        fitNotes: 'Runs small — order one size up.',
        modelInfo: null,
        revision: 2,
        products: 24,
        supplierId: null,
      },
      { id: 'sc-kurta', name: 'Kurtas', unit: 'cm', systems: [], measurements: ['Chest', 'Length', 'Shoulder'], rows: [{ size: 'M', values: ['101', '109', '39'] }], howToMeasure: [], fitNotes: null, modelInfo: null, revision: 1, products: 1, supplierId: null },
    ]
  : []

/** The size charts' reads under ?state=: two sample charts, or none for `empty`. */
export const sampleChartReads = (state: CollectionsState): ChartReads => ({
  list: async () => {
    if (state === 'loading') return new Promise(() => undefined)
    if (state === 'error') throw new Error('sample')
    const charts = state === 'empty' ? [] : sampleCharts
    return { charts: charts.map(({ id, name, unit, products, supplierId }) => ({ id, name, unit, products, supplierId })), limit: 200, feature: { enabled: true, inPlan: true }, unit: 'cm', india: true }
  },
  chart: async (id) => sampleCharts.find((c) => c.id === id) ?? null,
})
