import type { Collection, CollectionRule, CollectionSummary } from '../../api/collections'
import type { Filter } from '../../api/filters'
import { collectionsAccess } from './access'
import { blankDraft, collectionInput, draftOf, isCollectionDirty, nameField, nested, ruleCount, ruleFields, ruleInputs, rowsOf, sentenceOf, slugOf } from './collectionDraft'

const filter = (id: string, name: string, shopperVisible: boolean, values: [string, string][]): Filter => ({ id, name, position: 0, revision: 1, shopperVisible, values: values.map(([vid, vname]) => ({ id: vid, name: vname, products: 0 })) })

const filters: Filter[] = [
  filter('fabric', 'Fabric', true, [['linen', 'Linen'], ['cotton', 'Cotton']]),
  filter('occasion', 'Occasion', true, [['wedding', 'Wedding']]),
  filter('tag', 'Reorder soon', false, [['yes', 'Yes']]),
]

const rule = (r: Partial<CollectionRule> & Pick<CollectionRule, 'kind'>): CollectionRule => ({ valueId: null, text: null, productId: null, versionId: null, currency: null, min: null, max: null, ...r })
const words = { is: 'is', or: 'or', and: 'and', orJoin: 'or', nameContains: 'name contains “{text}”', product: 'a chosen product', version: 'a chosen version', priceRange: 'a price range' }

describe('the rule builder’s sentences', () => {
  it('groups a filter’s values into one sentence, and keeps rules it doesn’t draw aside', () => {
    const rules = [rule({ kind: 'filter_value', valueId: 'linen' }), rule({ kind: 'name_contains', text: 'shirt' }), rule({ kind: 'filter_value', valueId: 'cotton' }), rule({ kind: 'price_range', currency: 'INR', min: '0', max: '99900' })]
    const { rows, others } = rowsOf(rules, filters)

    expect(rows.map((r) => [r.field, r.values, r.text])).toEqual([['fabric', ['linen', 'cotton'], ''], [nameField, [], 'shirt']])
    expect(others.map((r) => r.kind)).toEqual(['price_range'])
    // Sent back as the API stores them: one rule per value, the kept ones as they came, empty rows gone.
    expect(ruleInputs({ rows: [...rows, { key: 'x', field: 'occasion', values: [], text: '' }], others })).toEqual([
      { kind: 'filter_value', valueId: 'linen' },
      { kind: 'filter_value', valueId: 'cotton' },
      { kind: 'name_contains', text: 'shirt' },
      { kind: 'price_range', currency: 'INR', min: '0', max: '99900' },
    ])
  })

  it('says what a collection holds in words, joined by its match', () => {
    const rules = [rule({ kind: 'filter_value', valueId: 'linen' }), rule({ kind: 'filter_value', valueId: 'cotton' }), rule({ kind: 'filter_value', valueId: 'wedding' })]

    expect(sentenceOf({ rules, match: 'all' }, filters, words)).toBe('Fabric is Linen or Cotton and Occasion is Wedding')
    expect(sentenceOf({ rules: [...rules, rule({ kind: 'name_contains', text: 'kurta' })], match: 'any' }, filters, words)).toBe('Fabric is Linen or Cotton or Occasion is Wedding or name contains “kurta”')
    expect(ruleCount({ rules }, filters)).toBe(2)
  })

  it('offers the filters shoppers see, and an internal one only when a saved rule uses it', () => {
    expect(ruleFields(filters, []).map((f) => f.id)).toEqual(['fabric', 'occasion'])
    expect(ruleFields(filters, [{ key: 'k', field: 'tag', values: ['yes'], text: '' }]).map((f) => f.id)).toEqual(['fabric', 'occasion', 'tag'])
  })
})

describe('a collection being edited', () => {
  const saved: Collection = {
    id: 'c1',
    name: 'Summer',
    slug: 'summer',
    description: 'Light things',
    kind: 'automatic',
    match: 'any',
    parentId: 'c0',
    inheritParent: true,
    visible: false,
    imageAssetId: 'img-1',
    sort: 'newest',
    seoTitle: 'Summer',
    seoDescription: null,
    revision: 4,
    rules: [rule({ kind: 'filter_value', valueId: 'linen' }), rule({ kind: 'product', productId: 'p1' })],
  }

  it('starts from the first filter shoppers see, and reads a saved one back as its sentences', () => {
    expect(blankDraft(filters).rows.map((r) => r.field)).toEqual(['fabric'])
    expect(blankDraft([]).rows.map((r) => r.field)).toEqual([nameField])

    const draft = draftOf(saved, filters, [])
    expect([draft.id, draft.revision, draft.rows.map((r) => [r.field, r.values]), draft.others.map((r) => r.kind)]).toEqual(['c1', 4, [['fabric', ['linen']]], ['product']])
  })

  it('round-trips to the API’s input: what was loaded and not edited is sent back as it was', () => {
    const draft = draftOf(saved, filters, [])

    expect(collectionInput(draft)).toEqual({
      name: 'Summer',
      description: 'Light things',
      kind: 'automatic',
      match: 'any',
      parentId: 'c0',
      inheritParent: true,
      visible: false,
      rules: [{ kind: 'filter_value', valueId: 'linen' }, { kind: 'product', productId: 'p1' }],
      productIds: [],
      imageAssetId: 'img-1',
      sort: 'newest',
      seoTitle: 'Summer',
      seoDescription: null,
    })
  })

  it('sends one kind’s half only, and an inherit switch only while there is a parent', () => {
    const manual = { ...draftOf(saved, filters, ['p1', 'p2']), kind: 'manual' as const, parentId: null }

    expect(collectionInput(manual)).toEqual(expect.objectContaining({ kind: 'manual', rules: [], productIds: ['p1', 'p2'], inheritParent: false }))
    expect(collectionInput({ ...draftOf(saved, filters, ['p1']), kind: 'automatic' })).toEqual(expect.objectContaining({ productIds: [] }))
  })

  it('is dirty only once something that would be sent has changed', () => {
    const start = draftOf(saved, filters, [])

    expect(isCollectionDirty({ ...start, rows: start.rows.map((r) => ({ ...r, key: 'other' })) }, start)).toBe(false)
    expect(isCollectionDirty({ ...start, name: 'Summer edit' }, start)).toBe(true)
    expect(isCollectionDirty({ ...start, rows: start.rows.map((r) => ({ ...r, values: [...r.values, 'cotton'] })) }, start)).toBe(true)
  })

  it('makes a web address the way the API does', () => {
    expect(slugOf('Gifts under ₹999 — Diwali!')).toBe('gifts-under-999-diwali')
    expect(slugOf('Crème Brûlée')).toBe('creme-brulee')
  })
})

describe('the list', () => {
  const c = (id: string, parentId: string | null = null): CollectionSummary => ({ id, name: id, kind: 'manual', visible: true, parentId, inheritParent: false, match: 'all', rules: [], products: 0, computedAt: null })

  it('puts each collection under its parent, however deep, and an orphan at the top', () => {
    expect(nested([c('a'), c('b', 'a'), c('c', 'b'), c('d', 'gone'), c('e')]).map(({ c: x, depth }) => `${x.id}${depth}`)).toEqual(['a0', 'b1', 'c2', 'd0', 'e0'])
  })
})

describe('who may change collections', () => {
  it('lets catalog.write change them unless the store is read-only, and never a supplier', () => {
    expect(collectionsAccess({ permissions: ['catalog.read', 'catalog.write'], supplier: false }, false)).toEqual({ canRead: true, canEdit: true })
    expect(collectionsAccess({ permissions: ['catalog.read', 'catalog.write'], supplier: false }, true)).toEqual({ canRead: true, canEdit: false })
    expect(collectionsAccess({ permissions: ['catalog.read'], supplier: false }, false)).toEqual({ canRead: true, canEdit: false })
    expect(collectionsAccess({ permissions: ['catalog.read', 'catalog.write'], supplier: true }, false)).toEqual({ canRead: false, canEdit: false })
  })
})
