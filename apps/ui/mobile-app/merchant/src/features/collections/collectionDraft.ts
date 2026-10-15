import type { Collection, CollectionRule, CollectionSummary, RuleInput } from '../../api/collections'
import type { Filter } from '../../api/filters'

/** "Name contains" in the rule builder's field list; every other field is a filter's id. */
export const nameField = 'name'

/** One sentence of the rule builder (CATALOG-DESIGN.md H4): a filter and the values that may match, or a name to look for. */
export type RuleRow = {
  key: string
  field: string
  values: string[]
  text: string
}

export type CollectionDraft = {
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
export const ruleFields = (filters: readonly Filter[], rows: readonly RuleRow[]): Filter[] => filters.filter((f) => f.shopperVisible || rows.some((r) => r.field === f.id))

const firstField = (filters: readonly Filter[]): string => filters.find((f) => f.shopperVisible)?.id ?? nameField

export const blankDraft = (filters: readonly Filter[]): CollectionDraft => ({
  id: null,
  revision: null,
  name: '',
  description: '',
  kind: 'automatic',
  match: 'all',
  parentId: null,
  inheritParent: false,
  visible: true,
  rows: [newRow(firstField(filters))],
  others: [],
  productIds: [],
  kept: null,
})

const filterOfValue = (filters: readonly Filter[]) => new Map(filters.flatMap((f) => f.values.map((v) => [v.id, f.id] as const)))

/** The saved rules as the builder's sentences: a filter's values together, a name on its own, the rest kept aside. */
export const rowsOf = (rules: readonly CollectionRule[], filters: readonly Filter[]): { rows: RuleRow[]; others: CollectionRule[] } => {
  const owner = filterOfValue(filters)
  const rows: RuleRow[] = []
  const others: CollectionRule[] = []
  for (const rule of rules) {
    const filter = rule.kind === 'filter_value' && rule.valueId ? owner.get(rule.valueId) : undefined
    if (filter && rule.valueId) {
      const row = rows.find((r) => r.field === filter)
      if (row) row.values.push(rule.valueId)
      else rows.push({ ...newRow(filter), values: [rule.valueId] })
    } else if (rule.kind === 'name_contains' && rule.text) rows.push({ ...newRow(nameField), text: rule.text })
    else others.push(rule)
  }
  return { rows, others }
}

export const draftOf = (c: Collection, filters: readonly Filter[], productIds: readonly string[]): CollectionDraft => {
  const { rows, others } = rowsOf(c.rules, filters)
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
    rows: rows.length > 0 || others.length > 0 ? rows : [newRow(firstField(filters))],
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

/** What a save writes: the API's input, from the draft. A kind's other half (rules for a hand-picked one, picks for an automatic one) is dropped. */
export const collectionInput = (d: CollectionDraft) => ({
  name: d.name.trim(),
  description: d.description,
  kind: d.kind,
  match: d.match,
  parentId: d.parentId,
  inheritParent: d.parentId !== null && d.inheritParent,
  visible: d.visible,
  rules: d.kind === 'automatic' ? ruleInputs(d) : [],
  productIds: d.kind === 'manual' ? d.productIds : [],
  ...d.kept,
})

export type SentenceWords = {
  is: string
  or: string
  and: string
  orJoin: string
  /** With `{text}` where the name goes. */
  nameContains: string
  product: string
  version: string
  priceRange: string
}

/** What an automatic collection holds, in the rule builder's words: "Fabric is Linen or Cotton and name contains “shirt”". */
export const sentenceOf = (c: Pick<CollectionSummary, 'rules' | 'match'>, filters: readonly Filter[], w: SentenceWords): string => {
  const { rows, others } = rowsOf(c.rules, filters)
  const names = new Map(filters.flatMap((f) => f.values.map((v) => [v.id, v.name] as const)))
  const parts = [
    ...rows.map((r) => {
      if (r.field === nameField) return w.nameContains.replace('{text}', r.text)
      const filter = filters.find((f) => f.id === r.field)
      return `${filter?.name ?? ''} ${w.is} ${r.values.map((v) => names.get(v) ?? '').join(` ${w.orJoin} `)}`
    }),
    ...others.map((r) => (r.kind === 'product' ? w.product : r.kind === 'version' ? w.version : w.priceRange)),
  ]
  return parts.join(` ${c.match === 'any' ? w.or : w.and} `)
}

/** Rules as the builder counts them: a filter with its values is one. */
export const ruleCount = (c: Pick<CollectionSummary, 'rules'>, filters: readonly Filter[]): number => {
  const { rows, others } = rowsOf(c.rules, filters)
  return rows.length + others.length
}

/** The list's order: each top-level collection, then the ones inside it, depth first; one whose parent is gone sits at the top. */
export const nested = (all: readonly CollectionSummary[]): { c: CollectionSummary; depth: number }[] => {
  const ids = new Set(all.map((c) => c.id))
  const under = (parent: CollectionSummary, depth: number, seen: Set<string>): { c: CollectionSummary; depth: number }[] =>
    seen.has(parent.id) ? [] : [{ c: parent, depth }, ...all.filter((k) => k.parentId === parent.id).flatMap((k) => under(k, depth + 1, new Set([...seen, parent.id])))]
  return all.filter((c) => c.parentId === null || !ids.has(c.parentId)).flatMap((top) => under(top, 0, new Set()))
}

/** Whether a draft differs from the one it started as: the editor asks before leaving with unsaved changes. */
export const isCollectionDirty = (d: CollectionDraft, saved: CollectionDraft): boolean => JSON.stringify(collectionInput(d)) !== JSON.stringify(collectionInput(saved))

/** The web address a name becomes, as the API makes it (collections' rules.ts slugFrom): shown as a hint, never sent. */
export const slugOf = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/, '')
