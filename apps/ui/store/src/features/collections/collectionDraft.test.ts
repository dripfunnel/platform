import { describe, expect, it } from 'vitest'
import type { Collection, CollectionRule, CollectionSummary } from '../../api/collections'
import type { Facet } from '../../api/productEditor'
import { blankDraft, blockFields, blocksOf, collectionsAccess, draftOf, nameField, nested, newBlock, onlyPicks, ruleInputs, sentenceOf } from './collectionDraft'
import { slugOf } from '../common/slug'

const facets: Facet[] = [
  { id: 'fabric', name: 'Fabric', shopperVisible: true, values: [{ id: 'linen', name: 'Linen' }, { id: 'cotton', name: 'Cotton' }] },
  { id: 'occasion', name: 'Occasion', shopperVisible: true, values: [{ id: 'wedding', name: 'Wedding' }] },
  { id: 'tag', name: 'Reorder soon', shopperVisible: false, values: [{ id: 'yes', name: 'Yes' }] },
]

const rule = (r: Partial<CollectionRule> & Pick<CollectionRule, 'kind'>): CollectionRule => ({ joiner: 'and', valueIds: [], valueMatch: null, productIds: [], text: null, productId: null, versionId: null, currency: null, min: null, max: null, ...r })
const words = { is: 'is', or: 'or', and: 'and', orJoin: 'or', nameContains: 'name contains “{text}”', product: 'a chosen product', version: 'a chosen version', priceRange: 'a price range', picked: '{count} picked products' }

describe('the Filters card’s blocks', () => {
  const rules = [
    rule({ kind: 'picks', productIds: ['p1', 'p2'] }),
    rule({ kind: 'filter_value', valueIds: ['linen', 'cotton'], valueMatch: 'all', joiner: 'or' }),
    rule({ kind: 'name_contains', text: 'shirt' }),
    rule({ kind: 'price_range', currency: 'INR', min: '0', max: '99900', joiner: 'or' }),
  ]

  it('reads saved rules as blocks, in order with their joiners, keeping those it doesn’t draw aside', () => {
    const blocks = blocksOf(rules, facets)
    expect(blocks.map((b) => [b.kind, b.joiner, b.field, b.values, b.match, b.text, b.productIds])).toEqual([
      ['picks', 'and', nameField, [], 'any', '', ['p1', 'p2']],
      ['filter', 'or', 'fabric', ['linen', 'cotton'], 'all', '', []],
      ['name', 'and', nameField, [], 'any', 'shirt', []],
      ['kept', 'or', nameField, [], 'any', '', []],
    ])
  })

  it('sends them back as the API stores them: a block each, empty ones gone, the kept ones as they came', () => {
    const blocks = [...blocksOf(rules, facets), { ...newBlock('filter', 'occasion') }, newBlock('picks'), newBlock('name')]
    expect(ruleInputs(blocks)).toEqual([
      { kind: 'picks', productIds: ['p1', 'p2'], joiner: 'and' },
      { kind: 'filter_value', valueIds: ['linen', 'cotton'], valueMatch: 'all', joiner: 'or' },
      { kind: 'name_contains', text: 'shirt', joiner: 'and' },
      { kind: 'price_range', currency: 'INR', min: '0', max: '99900', joiner: 'or' },
    ])
  })

  it('says what a collection holds in words, each block joined to the one before it', () => {
    expect(sentenceOf({ rules }, facets, words)).toBe('2 picked products or Fabric is Linen or Cotton and name contains “shirt” or a price range')
  })

  it('calls a collection of picks alone, or nothing, hand-picked', () => {
    expect(onlyPicks(blocksOf([rule({ kind: 'picks', productIds: ['p1'] })], facets))).toBe(true)
    expect(onlyPicks([])).toBe(true)
    expect(onlyPicks(blocksOf(rules, facets))).toBe(false)
  })

  it('offers the filters shoppers see, and an internal one only when a saved block uses it', () => {
    expect(blockFields(facets, []).map((f) => f.id)).toEqual(['fabric', 'occasion'])
    expect(blockFields(facets, [{ ...newBlock('filter', 'tag'), values: ['yes'] }]).map((f) => f.id)).toEqual(['fabric', 'occasion', 'tag'])
  })
})

describe('a collection being edited', () => {
  const saved: Collection = { id: 'c1', name: 'Summer', slug: 'summer', description: '', parentId: null, inheritParent: false, visible: true, imageAssetId: null, sort: 'newest', seoTitle: null, seoDescription: null, revision: 4, rules: [rule({ kind: 'filter_value', valueIds: ['linen'], valueMatch: 'any' })] }

  it('starts from the first filter shoppers see, and reads a saved one back as its blocks', () => {
    expect(blankDraft(facets).blocks.map((b) => b.field)).toEqual(['fabric'])
    expect(blankDraft([]).blocks.map((b) => b.field)).toEqual([nameField])
    const draft = draftOf(saved, facets)
    expect([draft.id, draft.revision, draft.blocks.map((b) => [b.field, b.values])]).toEqual(['c1', 4, [['fabric', ['linen']]]])
  })

  it('makes a web address the way the API does', () => {
    expect(slugOf('Gifts under ₹999 — Diwali!')).toBe('gifts-under-999-diwali')
    expect(slugOf('Crème Brûlée')).toBe('creme-brulee')
  })
})

describe('the list', () => {
  const c = (id: string, parentId: string | null = null): CollectionSummary => ({ id, name: id, visible: true, parentId, inheritParent: false, imageAssetId: null, rules: [], products: 0, computedAt: null })

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
