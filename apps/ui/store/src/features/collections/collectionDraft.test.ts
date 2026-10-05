import { describe, expect, it } from 'vitest'
import type { Collection, CollectionRule, CollectionSummary } from '../../api/collections'
import type { Facet } from '../../api/productEditor'
import { blankDraft, collectionsAccess, draftOf, nameField, nested, ruleFields, ruleInputs, rowsOf, sentenceOf, slugOf } from './collectionDraft'

const facets: Facet[] = [
  { id: 'fabric', name: 'Fabric', shopperVisible: true, values: [{ id: 'linen', name: 'Linen' }, { id: 'cotton', name: 'Cotton' }] },
  { id: 'occasion', name: 'Occasion', shopperVisible: true, values: [{ id: 'wedding', name: 'Wedding' }] },
  { id: 'tag', name: 'Reorder soon', shopperVisible: false, values: [{ id: 'yes', name: 'Yes' }] },
]

const rule = (r: Partial<CollectionRule> & Pick<CollectionRule, 'kind'>): CollectionRule => ({ valueId: null, text: null, productId: null, versionId: null, currency: null, min: null, max: null, ...r })
const words = { is: 'is', or: 'or', and: 'and', orJoin: 'or', nameContains: 'name contains “{text}”', product: 'a chosen product', version: 'a chosen version', priceRange: 'a price range' }

describe('the rule builder’s sentences', () => {
  it('groups a filter’s values into one sentence, and keeps rules it doesn’t draw aside', () => {
    const rules = [rule({ kind: 'filter_value', valueId: 'linen' }), rule({ kind: 'name_contains', text: 'shirt' }), rule({ kind: 'filter_value', valueId: 'cotton' }), rule({ kind: 'price_range', currency: 'INR', min: '0', max: '99900' })]
    const { rows, others } = rowsOf(rules, facets)
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
    expect(sentenceOf({ rules, match: 'all' }, facets, words)).toBe('Fabric is Linen or Cotton and Occasion is Wedding')
    expect(sentenceOf({ rules: [...rules, rule({ kind: 'name_contains', text: 'kurta' })], match: 'any' }, facets, words)).toBe('Fabric is Linen or Cotton or Occasion is Wedding or name contains “kurta”')
  })

  it('offers the filters shoppers see, and an internal one only when a saved rule uses it', () => {
    expect(ruleFields(facets, []).map((f) => f.id)).toEqual(['fabric', 'occasion'])
    expect(ruleFields(facets, [{ key: 'k', field: 'tag', values: ['yes'], text: '' }]).map((f) => f.id)).toEqual(['fabric', 'occasion', 'tag'])
  })
})

describe('a collection being edited', () => {
  const saved: Collection = { id: 'c1', name: 'Summer', slug: 'summer', description: '', kind: 'automatic', match: 'all', parentId: null, inheritParent: false, visible: true, imageAssetId: null, sort: 'newest', seoTitle: null, seoDescription: null, revision: 4, rules: [rule({ kind: 'filter_value', valueId: 'linen' })] }

  it('starts from the first filter shoppers see, and reads a saved one back as its sentences', () => {
    expect(blankDraft(facets).rows.map((r) => r.field)).toEqual(['fabric'])
    expect(blankDraft([]).rows.map((r) => r.field)).toEqual([nameField])
    const draft = draftOf(saved, facets, [])
    expect([draft.id, draft.revision, draft.rows.map((r) => [r.field, r.values])]).toEqual(['c1', 4, [['fabric', ['linen']]]])
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
    expect(collectionsAccess({ permissions: ['catalog.read', 'catalog.write'], seller: null }, false)).toEqual({ canRead: true, canEdit: true })
    expect(collectionsAccess({ permissions: ['catalog.read', 'catalog.write'], seller: null }, true)).toEqual({ canRead: true, canEdit: false })
    expect(collectionsAccess({ permissions: ['catalog.read'], seller: null }, false)).toEqual({ canRead: true, canEdit: false })
    expect(collectionsAccess({ permissions: ['catalog.read', 'catalog.write'], seller: { id: 'v1' } }, false)).toEqual({ canRead: false, canEdit: false })
  })
})
