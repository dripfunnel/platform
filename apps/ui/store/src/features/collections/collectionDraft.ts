import type { Collection, CollectionRule, CollectionSummary, RuleInput } from '../../api/collections'
import type { Facet } from '../../api/productEditor'

/** "Name contains" in the rule builder's field list; every other field is a filter's id. */
export const nameField = 'name'

/** One sentence of the rule builder (CATALOG H4): a filter and the values that may match, or a name to look for. */
export interface RuleRow {
  key: string
  field: string
  values: string[]
  text: string
}

export interface CollectionDraft {
  id: string | null
  revision: number | null
  name: string
  description: string
  kind: 'manual' | 'automatic'
  match: 'all' | 'any'
  parentId: string | null
  inheritParent: boolean
  visible: boolean
  rows: RuleRow[]
  /** Rules this screen doesn't draw (a product, a version, a price range): kept as they are on save. */
  others: CollectionRule[]
  productIds: string[]
  /** What this screen doesn't draw (its image, sort, SEO): sent back as loaded, so a save never clears it. Null when new. */
  kept: Pick<Collection, 'imageAssetId' | 'sort' | 'seoTitle' | 'seoDescription'> | null
}

let rowKey = 0
export const newRow = (field: string): RuleRow => ({ key: `r${++rowKey}`, field, values: [], text: '' })

/** The filters a rule may use: those shoppers see, as the prototype offers, and any a saved rule already uses. */
export const ruleFields = (facets: readonly Facet[], rows: readonly RuleRow[]): Facet[] => facets.filter((f) => f.shopperVisible || rows.some((r) => r.field === f.id))

export const blankDraft = (facets: readonly Facet[]): CollectionDraft => ({
  id: null,
  revision: null,
  name: '',
  description: '',
  kind: 'automatic',
  match: 'all',
  parentId: null,
  inheritParent: false,
  visible: true,
  rows: [newRow(facets.find((f) => f.shopperVisible)?.id ?? nameField)],
  others: [],
  productIds: [],
  kept: null,
})

const facetOfValue = (facets: readonly Facet[]) => new Map(facets.flatMap((f) => f.values.map((v) => [v.id, f.id] as const)))

/** The saved rules as the builder's sentences: a filter's values together, a name on its own, the rest kept aside. */
export const rowsOf = (rules: readonly CollectionRule[], facets: readonly Facet[]): { rows: RuleRow[]; others: CollectionRule[] } => {
  const owner = facetOfValue(facets)
  const rows: RuleRow[] = []
  const others: CollectionRule[] = []
  for (const rule of rules) {
    const facet = rule.kind === 'filter_value' && rule.valueId ? owner.get(rule.valueId) : undefined
    if (facet && rule.valueId) {
      const row = rows.find((r) => r.field === facet)
      if (row) row.values.push(rule.valueId)
      else rows.push({ ...newRow(facet), values: [rule.valueId] })
    } else if (rule.kind === 'name_contains' && rule.text) rows.push({ ...newRow(nameField), text: rule.text })
    else others.push(rule)
  }
  return { rows, others }
}

export const draftOf = (c: Collection, facets: readonly Facet[], productIds: readonly string[]): CollectionDraft => {
  const { rows, others } = rowsOf(c.rules, facets)
  return {
    id: c.id,
    revision: c.revision,
    name: c.name,
    description: c.description,
    kind: c.kind,
    match: c.match,
    parentId: c.parentId,
    inheritParent: c.inheritParent,
    visible: c.visible,
    rows: rows.length > 0 || others.length > 0 ? rows : [newRow(facets.find((f) => f.shopperVisible)?.id ?? nameField)],
    others,
    productIds: [...productIds],
    kept: { imageAssetId: c.imageAssetId, sort: c.sort, seoTitle: c.seoTitle, seoDescription: c.seoDescription },
  }
}

const otherInput = (r: CollectionRule): RuleInput => {
  const input: RuleInput = { kind: r.kind }
  for (const key of ['valueId', 'text', 'productId', 'versionId', 'currency', 'min', 'max'] as const) {
    const value = r[key]
    if (value !== null) input[key] = value
  }
  return input
}

/** The rules a save sends: each value picked, each name typed, then the ones this screen keeps aside. Empty rows go. */
export const ruleInputs = (d: Pick<CollectionDraft, 'rows' | 'others'>): RuleInput[] => [
  ...d.rows.flatMap((r): RuleInput[] => (r.field === nameField ? (r.text.trim() ? [{ kind: 'name_contains', text: r.text.trim() }] : []) : r.values.map((valueId) => ({ kind: 'filter_value', valueId })))),
  ...d.others.map(otherInput),
]

export interface SentenceWords {
  is: string
  or: string
  and: string
  orJoin: string
  nameContains: string
  product: string
  version: string
  priceRange: string
}

/** What an automatic collection holds, in the rule builder's words: "Fabric is Linen or Cotton and name contains “shirt”". */
export const sentenceOf = (c: Pick<CollectionSummary, 'rules' | 'match'>, facets: readonly Facet[], w: SentenceWords): string => {
  const { rows, others } = rowsOf(c.rules, facets)
  const names = new Map(facets.flatMap((f) => f.values.map((v) => [v.id, v.name] as const)))
  const parts = [
    ...rows.map((r) => {
      if (r.field === nameField) return w.nameContains.replace('{text}', r.text)
      const facet = facets.find((f) => f.id === r.field)
      return `${facet?.name ?? ''} ${w.is} ${r.values.map((v) => names.get(v) ?? '').join(` ${w.orJoin} `)}`
    }),
    ...others.map((r) => (r.kind === 'product' ? w.product : r.kind === 'version' ? w.version : w.priceRange)),
  ]
  return parts.join(` ${c.match === 'any' ? w.or : w.and} `)
}

/** The list's order: each top-level collection, then the ones inside it, depth first; one whose parent is gone sits at the top. */
export const nested = (all: readonly CollectionSummary[]): { c: CollectionSummary; depth: number }[] => {
  const ids = new Set(all.map((c) => c.id))
  const under = (parent: CollectionSummary, depth: number, seen: Set<string>): { c: CollectionSummary; depth: number }[] =>
    seen.has(parent.id) ? [] : [{ c: parent, depth }, ...all.filter((k) => k.parentId === parent.id).flatMap((k) => under(k, depth + 1, new Set([...seen, parent.id])))]
  return all.filter((c) => c.parentId === null || !ids.has(c.parentId)).flatMap((top) => under(top, 0, new Set()))
}

/** The web address a new collection gets from its name, as the API makes it (rules.ts slugFrom). */
export const slugOf = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/, '')

/** Who may do what here (FIRST-RELEASE §12): the merchant side reads; `catalog.write` changes, unless the store is read-only. */
export const collectionsAccess = (acting: { permissions: readonly string[]; seller: unknown }, readOnly: boolean) => ({
  canRead: acting.seller === null && acting.permissions.includes('catalog.read'),
  canEdit: acting.seller === null && acting.permissions.includes('catalog.write') && !readOnly,
})
