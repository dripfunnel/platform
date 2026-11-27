import type { Collection, CollectionRule, CollectionSummary, RuleInput } from '../../api/collections'
import type { Facet } from '../../api/productEditor'

/** "Name contains" in a filter block's field list; every other field is a filter's id. */
export const nameField = 'name'

/** What a block of the Filters card holds: picked products, one filter's values, a name, or a rule this screen keeps as it is. */
export type BlockKind = 'picks' | 'filter' | 'name' | 'kept'

/** One block of the Filters card (#1558); `joiner` joins it to the block above, and the first one's is unused. */
export interface Block {
  key: string
  kind: BlockKind
  joiner: 'and' | 'or'
  /** A filter block: the filter's id. */
  field: string
  /** A filter block: the values ticked, and whether a product needs any or all of them. */
  values: string[]
  match: 'any' | 'all'
  /** A name block: the text to look for. */
  text: string
  /** A picks block: the products, in the order picked. */
  productIds: string[]
  /** A rule this screen doesn't draw (a product, a version, a price range): sent back as it is. */
  rule: CollectionRule | null
}

export interface CollectionDraft {
  id: string | null
  revision: number | null
  name: string
  description: string
  parentId: string | null
  inheritParent: boolean
  visible: boolean
  imageAssetId: string | null
  blocks: Block[]
  /** What this screen doesn't draw (its sort, SEO): sent back as loaded, so a save never clears it. Null when new. */
  kept: Pick<Collection, 'sort' | 'seoTitle' | 'seoDescription'> | null
}

let blockKey = 0
export const newBlock = (kind: BlockKind, field = nameField): Block => ({ key: `b${++blockKey}`, kind, joiner: 'and', field, values: [], match: 'any', text: '', productIds: [], rule: null })

/** The filters a block may use: those shoppers see, and any a saved block already uses. */
export const blockFields = (facets: readonly Facet[], blocks: readonly Block[]): Facet[] => facets.filter((f) => f.shopperVisible || blocks.some((b) => b.kind === 'filter' && b.field === f.id))

const firstFilterBlock = (facets: readonly Facet[]): Block => {
  const facet = facets.find((f) => f.shopperVisible)
  return facet ? newBlock('filter', facet.id) : newBlock('name')
}

export const blankDraft = (facets: readonly Facet[]): CollectionDraft => ({
  id: null,
  revision: null,
  name: '',
  description: '',
  parentId: null,
  inheritParent: false,
  visible: true,
  imageAssetId: null,
  blocks: [firstFilterBlock(facets)],
  kept: null,
})

const facetOfValue = (facets: readonly Facet[]) => new Map(facets.flatMap((f) => f.values.map((v) => [v.id, f.id] as const)))

/** The saved rules as the card's blocks, in their order with their joiners. */
export const blocksOf = (rules: readonly CollectionRule[], facets: readonly Facet[]): Block[] => {
  const owner = facetOfValue(facets)
  return rules.map((rule): Block => {
    const joiner = rule.joiner === 'or' ? 'or' : 'and'
    if (rule.kind === 'picks') return { ...newBlock('picks'), joiner, productIds: [...rule.productIds] }
    const facet = rule.kind === 'filter_value' ? owner.get(rule.valueIds[0] ?? '') : undefined
    if (facet) return { ...newBlock('filter', facet), joiner, values: [...rule.valueIds], match: rule.valueMatch === 'all' ? 'all' : 'any' }
    if (rule.kind === 'name_contains' && rule.text) return { ...newBlock('name'), joiner, text: rule.text }
    return { ...newBlock('kept'), joiner, rule }
  })
}

export const draftOf = (c: Collection, facets: readonly Facet[]): CollectionDraft => {
  const blocks = blocksOf(c.rules, facets)
  return {
    id: c.id,
    revision: c.revision,
    name: c.name,
    description: c.description,
    parentId: c.parentId,
    inheritParent: c.inheritParent,
    visible: c.visible,
    imageAssetId: c.imageAssetId,
    blocks: blocks.length > 0 ? blocks : [firstFilterBlock(facets)],
    kept: { sort: c.sort, seoTitle: c.seoTitle, seoDescription: c.seoDescription },
  }
}

const keptInput = (r: CollectionRule): RuleInput => {
  const input: RuleInput = { kind: r.kind }
  for (const key of ['text', 'productId', 'versionId', 'currency', 'min', 'max'] as const) {
    const value = r[key]
    if (value !== null) input[key] = value
  }
  return input
}

const inputOfBlock = (b: Block): RuleInput | null => {
  switch (b.kind) {
    case 'picks':
      return b.productIds.length > 0 ? { kind: 'picks', productIds: b.productIds } : null
    case 'filter':
      return b.values.length > 0 ? { kind: 'filter_value', valueIds: b.values, valueMatch: b.match } : null
    case 'name':
      return b.text.trim() ? { kind: 'name_contains', text: b.text.trim() } : null
    case 'kept':
      return b.rule ? keptInput(b.rule) : null
  }
}

/** The blocks a save sends, each with how it joins the one before; blocks with nothing in them go. */
export const ruleInputs = (blocks: readonly Block[]): RuleInput[] =>
  blocks.flatMap((b) => {
    const input = inputOfBlock(b)
    return input ? [{ ...input, joiner: b.joiner }] : []
  })

/** A collection that is only picked products (or nothing) is "hand-picked"; anything with a filter fills by itself. */
export const onlyPicks = (blocks: readonly Block[]): boolean => blocks.every((b) => b.kind === 'picks')

export interface SentenceWords {
  is: string
  or: string
  and: string
  orJoin: string
  nameContains: string
  product: string
  version: string
  priceRange: string
  picked: string
}

/** What a collection holds, in the Filters card's words: "picked products or Fabric is Linen and name contains “shirt”". */
export const sentenceOf = (c: Pick<CollectionSummary, 'rules'>, facets: readonly Facet[], w: SentenceWords): string => {
  const names = new Map(facets.flatMap((f) => f.values.map((v) => [v.id, v.name] as const)))
  return blocksOf(c.rules, facets)
    .map((b, i) => {
      const text =
        b.kind === 'picks'
          ? w.picked
          : b.kind === 'name'
            ? w.nameContains.replace('{text}', b.text)
            : b.kind === 'filter'
              ? `${facets.find((f) => f.id === b.field)?.name ?? ''} ${w.is} ${b.values.map((v) => names.get(v) ?? '').join(` ${w.orJoin} `)}`
              : b.rule?.kind === 'product'
                ? w.product
                : b.rule?.kind === 'version'
                  ? w.version
                  : w.priceRange
      return i === 0 ? text : `${b.joiner === 'or' ? w.or : w.and} ${text}`
    })
    .join(' ')
}

/** The list's order: each top-level collection, then the ones inside it, depth first; one whose parent is gone sits at the top. */
export const nested = (all: readonly CollectionSummary[]): { c: CollectionSummary; depth: number }[] => {
  const ids = new Set(all.map((c) => c.id))
  const under = (parent: CollectionSummary, depth: number, seen: Set<string>): { c: CollectionSummary; depth: number }[] =>
    seen.has(parent.id) ? [] : [{ c: parent, depth }, ...all.filter((k) => k.parentId === parent.id).flatMap((k) => under(k, depth + 1, new Set([...seen, parent.id])))]
  return all.filter((c) => c.parentId === null || !ids.has(c.parentId)).flatMap((top) => under(top, 0, new Set()))
}

/** Who may do what here (FIRST-RELEASE §12): the merchant side reads; `catalog.write` changes, unless the store is read-only. */
export const collectionsAccess = (acting: { permissions: readonly string[]; seller: unknown }, readOnly: boolean) => ({
  canRead: acting.seller === null && acting.permissions.includes('catalog.read'),
  canEdit: acting.seller === null && acting.permissions.includes('catalog.write') && !readOnly,
})
