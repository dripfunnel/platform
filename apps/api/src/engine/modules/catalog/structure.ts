import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { isCurrency, parseMinor } from '#core/money'
import type { PageWindow } from '#core/paging'
import type { TenantContext } from '#core/tenancy'
import {
  countFacets,
  deleteFacet,
  insertCollection,
  knownCatalogueIds,
  countCollections,
  maxCollectionProducts,
  maxCollections,
  maxFacets,
  mergeFacetValues,
  selectCollection,
  selectCollectionProducts,
  selectCollections,
  selectFacets,
  selectFacetValueIds,
  selectMenu,
  setCollectionProducts,
  setCollectionRules,
  softDeleteCollection,
  updateCollection,
  writeFacet,
  writeMenu,
  type CollectionFields,
  type MenuItemRow,
  type RuleRow,
} from '#db/scoped/catalogStructure'
import { serialise, uniqueViolation, withScope, type ScopedSql } from '#db/scoped/index'
import { slugFrom } from './rules'
import { isUuid } from '#core/ids'

// Collections, filters and menus (CATALOG-DESIGN H–J; FIRST-RELEASE §12): the merchant side's. An
// automatic collection's products are recomputed after commit (fact 14), through `recompute`.

/** The outbox kind that recomputes a store's automatic collections (CATALOG fact 14); its deliverer is in jobs/. */
export const collectionsRecomputeKind = 'collections.recompute'

export const structureAudit = {
  collectionSaved: 'collection.saved',
  collectionDeleted: 'collection.deleted',
  facetSaved: 'filter.saved',
  facetDeleted: 'filter.deleted',
  facetValuesMerged: 'filter.values_merged',
  menuSaved: 'menu.saved',
} as const

export const maxRules = 20
export const maxMenuItems = 100
export const maxFacetValues = 200
export const maxFacetPosition = 10_000


export type StructureRefusal =
  | 'NAME_REQUIRED'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'STALE_REVISION'
  | 'DUPLICATE_NAME'
  | 'DUPLICATE_VALUE'
  | 'TOO_MANY_RULES'
  | 'INVALID_RULE'
  | 'TOO_MANY_PRODUCTS'
  | 'INVALID_PARENT'
  | 'TOO_MANY_ITEMS'
  | 'INVALID_LINK'
  | 'TOO_DEEP'
  | 'TOO_MANY_FILTERS'
  | 'TOO_MANY_COLLECTIONS'

export type StructureResult<T> = { ok: true; value: T } | { ok: false; reason: StructureRefusal }

class Refused extends Error {
  constructor(readonly reason: StructureRefusal) {
    super(reason)
  }
}

const name = (value: string | null | undefined, max: number): string => {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') throw new Refused('NAME_REQUIRED')
  if (trimmed.length > max) throw new Refused('INVALID_INPUT')
  return trimmed
}

const optional = (value: string | null | undefined, max: number): string | null => {
  const trimmed = value?.trim() ?? ''
  if (trimmed.length > max) throw new Refused('INVALID_INPUT')
  return trimmed === '' ? null : trimmed
}

export interface RuleInput {
  kind: string
  valueId?: string | null | undefined
  text?: string | null | undefined
  productId?: string | null | undefined
  versionId?: string | null | undefined
  currency?: string | null | undefined
  min?: string | null | undefined
  max?: string | null | undefined
}

/** A rule as the recompute reads it (fact 11): filter choice, name contains, a product or version, a price range. */
export const cleanRule = (r: RuleInput): RuleRow => {
  const id = (v: string | null | undefined) => {
    if (!v || !isUuid(v)) throw new Refused('INVALID_RULE')
    return v.toLowerCase()
  }
  switch (r.kind) {
    case 'filter_value':
      return { kind: 'filter_value', args: { valueId: id(r.valueId) } }
    case 'name_contains': {
      const text = r.text?.trim() ?? ''
      if (text.length === 0 || text.length > 60) throw new Refused('INVALID_RULE')
      return { kind: 'name_contains', args: { text } }
    }
    case 'product':
      return { kind: 'product', args: { productId: id(r.productId) } }
    case 'version':
      return { kind: 'version', args: { versionId: id(r.versionId) } }
    case 'price_range': {
      const currency = r.currency ?? ''
      const min = parseMinor(r.min ?? '', currency)
      const max = parseMinor(r.max ?? '', currency)
      if (!isCurrency(currency) || !min || !max || min.amount > max.amount) throw new Refused('INVALID_RULE')
      return { kind: 'price_range', args: { currency, min: r.min, max: r.max } }
    }
    default:
      throw new Refused('INVALID_RULE')
  }
}

export interface CollectionInput {
  name: string
  slug?: string | null | undefined
  description?: string | null | undefined
  kind: string
  match?: string | null | undefined
  parentId?: string | null | undefined
  inheritParent?: boolean | null | undefined
  visible?: boolean | null | undefined
  imageAssetId?: string | null | undefined
  sort?: string | null | undefined
  seoTitle?: string | null | undefined
  seoDescription?: string | null | undefined
  rules?: readonly RuleInput[] | null | undefined
  /** A hand-picked collection's products, in order. */
  productIds?: readonly string[] | null | undefined
}

const sorts = ['manual', 'newest', 'price_asc', 'price_desc', 'best_selling']

export const cleanCollection = (input: CollectionInput): { fields: CollectionFields; slugGiven: boolean; rules: RuleRow[]; productIds: string[] } => {
  const collectionName = name(input.name, 120)
  if (input.kind !== 'manual' && input.kind !== 'automatic') throw new Refused('INVALID_INPUT')
  const match = input.match ?? 'all'
  if (match !== 'all' && match !== 'any') throw new Refused('INVALID_INPUT')
  const sort = input.sort ?? (input.kind === 'manual' ? 'manual' : 'newest')
  if (!sorts.includes(sort)) throw new Refused('INVALID_INPUT')
  const parentId = input.parentId ?? null
  if (parentId !== null && !isUuid(parentId)) throw new Refused('INVALID_PARENT')
  const imageAssetId = input.imageAssetId ?? null
  if (imageAssetId !== null && !isUuid(imageAssetId)) throw new Refused('INVALID_INPUT')
  const rules = input.kind === 'automatic' ? (input.rules ?? []) : []
  if (rules.length > maxRules) throw new Refused('TOO_MANY_RULES')
  const productIds = input.kind === 'manual' ? [...new Set((input.productIds ?? []).map((id) => id.toLowerCase()))] : []
  if (productIds.length > maxCollectionProducts) throw new Refused('TOO_MANY_PRODUCTS')
  if (!productIds.every((id) => isUuid(id))) throw new Refused('INVALID_INPUT')
  return {
    fields: {
      name: collectionName,
      slug: slugFrom(input.slug?.trim() || collectionName) || 'collection',
      description: optional(input.description, 5000) ?? '',
      kind: input.kind,
      match,
      parentId: parentId?.toLowerCase() ?? null,
      inheritParent: parentId !== null && input.inheritParent === true,
      visibility: input.visible === false ? 'hidden' : 'visible',
      imageAssetId: imageAssetId?.toLowerCase() ?? null,
      sort,
      seoTitle: optional(input.seoTitle, 120),
      seoDescription: optional(input.seoDescription, 320),
    },
    slugGiven: Boolean(input.slug?.trim()),
    rules: rules.map(cleanRule),
    productIds,
  }
}

const isHttpsLink = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' && url.length <= 500
  } catch {
    return false
  }
}

export interface MenuItemInput {
  label: string
  kind: string
  collectionId?: string | null | undefined
  url?: string | null | undefined
  children?: readonly MenuItemInput[] | null | undefined
}

/** The menu's items, one level of nesting (FIRST-RELEASE §12), each linking a collection, a shop page or an https address (J4). */
export const cleanMenu = (items: readonly MenuItemInput[]): Omit<MenuItemRow, 'position'>[] => {
  const rows: Omit<MenuItemRow, 'position'>[] = []
  const add = (item: MenuItemInput, parent: string | null) => {
    const label = name(item.label, 60)
    const id = crypto.randomUUID()
    if (item.kind === 'collection') {
      if (!item.collectionId || !isUuid(item.collectionId)) throw new Refused('INVALID_LINK')
      rows.push({ id, parent_id: parent, label, kind: 'collection', collection_id: item.collectionId.toLowerCase(), url: null })
    } else if (item.kind === 'page') {
      const url = item.url?.trim() ?? ''
      if (!/^\/[a-z0-9/_-]*$/.test(url) || url.length > 500) throw new Refused('INVALID_LINK')
      rows.push({ id, parent_id: parent, label, kind: 'page', collection_id: null, url })
    } else if (item.kind === 'url') {
      const url = item.url?.trim() ?? ''
      if (!isHttpsLink(url)) throw new Refused('INVALID_LINK')
      rows.push({ id, parent_id: parent, label, kind: 'url', collection_id: null, url })
    } else {
      throw new Refused('INVALID_LINK')
    }
    const children = item.children ?? []
    if (children.length > 0 && parent !== null) throw new Refused('TOO_DEEP')
    for (const child of children) add(child, id)
  }
  for (const item of items) add(item, null)
  if (rows.length > maxMenuItems) throw new Refused('TOO_MANY_ITEMS')
  return rows
}

export interface FacetInput {
  id?: string | null | undefined
  name: string
  shopperVisible?: boolean | null | undefined
  position?: number | null | undefined
  values: readonly { id?: string | null | undefined; name: string }[]
}

export interface StructureDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
  /** Asks, in the same transaction, for the store's automatic collections to be recomputed after commit. */
  recompute: (tx: ScopedSql) => Promise<unknown>
}

const invalidParent = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' && error.message.includes("collection can't sit inside itself")

export const createStructureService = ({ sql, context, actor, activity, facts, now, recompute }: StructureDeps) => {
  const { storeId } = context
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)

  const entry = (action: string, target: { type: string; id: string; label: string }): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    target,
    reason: null,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const run = async <T>(work: (tx: ScopedSql) => Promise<T>): Promise<StructureResult<T>> => {
    try {
      return { ok: true, value: await inScope(work) }
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason }
      if (uniqueViolation(error, 'filter_name_key')) return { ok: false, reason: 'DUPLICATE_NAME' }
      if (uniqueViolation(error, 'filter_value_name_key')) return { ok: false, reason: 'DUPLICATE_VALUE' }
      if (invalidParent(error)) return { ok: false, reason: 'INVALID_PARENT' }
      throw error
    }
  }

  const facets = (window: PageWindow) => inScope((tx) => selectFacets(tx, storeId, window))

  const saveFacet = (input: FacetInput) =>
    run(async (tx) => {
      const facetName = name(input.name, 60)
      const position = input.position ?? 0
      if (!Number.isInteger(position) || position < 0 || position > maxFacetPosition) throw new Refused('INVALID_INPUT')
      if (input.values.length > maxFacetValues) throw new Refused('INVALID_INPUT')
      const id = input.id ?? null
      if (id !== null && !isUuid(id)) throw new Refused('NOT_FOUND')
      const existing = id ? await selectFacetValueIds(tx, storeId, id) : null
      if (id !== null && existing === null) throw new Refused('NOT_FOUND')
      const seen = new Set<string>()
      const values = input.values.map((v, position) => {
        const valueName = name(v.name, 60)
        if (seen.has(valueName.toLowerCase())) throw new Refused('DUPLICATE_VALUE')
        seen.add(valueName.toLowerCase())
        const kept = v.id ? (existing ?? []).includes(v.id) : false
        if (v.id && !kept) throw new Refused('INVALID_INPUT')
        return { id: kept && v.id ? v.id : crypto.randomUUID(), name: valueName, position, kept }
      })
      // A store's filters stop at maxFacets, so a supplier's tagging list stays one a person can read.
      if (existing === null) {
        await serialise(tx, `filter:${storeId}`)
        if ((await countFacets(tx, storeId)) >= maxFacets) throw new Refused('TOO_MANY_FILTERS')
      }
      const facetId = id ?? crypto.randomUUID()
      await writeFacet(tx, storeId, { id: facetId, name: facetName, position, shopperVisible: input.shopperVisible ?? true, values }, existing !== null, now())
      await activity.record(tx, entry(structureAudit.facetSaved, { type: 'filter', id: facetId, label: facetName }))
      // A value removed is a rule's target gone: the collections that used it shrink.
      await recompute(tx)
      return facetId
    })

  const removeFacet = (id: string) =>
    run(async (tx) => {
      const gone = isUuid(id) ? await deleteFacet(tx, storeId, id) : null
      if (gone === null) throw new Refused('NOT_FOUND')
      await activity.record(tx, entry(structureAudit.facetDeleted, { type: 'filter', id, label: gone }))
      await recompute(tx)
      return true
    })

  const mergeValues = (targetId: string, sourceIds: readonly string[]) =>
    run(async (tx) => {
      const sources = [...new Set(sourceIds)].filter((s) => s !== targetId)
      if (sources.length === 0 || sources.length > maxFacetValues || ![targetId, ...sources].every((v) => isUuid(v))) throw new Refused('INVALID_INPUT')
      const merged = await mergeFacetValues(tx, storeId, targetId, sources)
      if (merged < 0) throw new Refused('NOT_FOUND')
      await activity.record(tx, entry(structureAudit.facetValuesMerged, { type: 'filter_value', id: targetId, label: String(merged) }))
      await recompute(tx)
      return merged
    })

  const collections = (window: PageWindow) => inScope((tx) => selectCollections(tx, storeId, window))

  const collection = (id: string) => inScope((tx) => selectCollection(tx, storeId, id))

  const members = (id: string, window: PageWindow) => inScope((tx) => selectCollectionProducts(tx, storeId, id, window))

  /** Every id a collection names is checked to be this store's, as RLS would only filter it to nothing. */
  const checkIds = async (tx: ScopedSql, id: string | null, clean: ReturnType<typeof cleanCollection>) => {
    const ruled = (key: string) => clean.rules.map((r) => r.args[key]).filter((v): v is string => typeof v === 'string')
    const known = await knownCatalogueIds(tx, storeId, {
      collections: clean.fields.parentId ? [clean.fields.parentId] : [],
      products: [...clean.productIds, ...ruled('productId')],
      versions: ruled('versionId'),
      values: ruled('valueId'),
      images: clean.fields.imageAssetId ? [clean.fields.imageAssetId] : [],
    })
    if (clean.fields.parentId && (clean.fields.parentId === id || !known.collections.has(clean.fields.parentId))) throw new Refused('INVALID_PARENT')
    if (!clean.productIds.every((p) => known.products.has(p))) throw new Refused('INVALID_INPUT')
    // A collection's picture is one of this store's photos (CATALOG H).
    if (clean.fields.imageAssetId && !known.images.has(clean.fields.imageAssetId)) throw new Refused('INVALID_INPUT')
    if (!ruled('productId').every((p) => known.products.has(p)) || !ruled('versionId').every((v) => known.versions.has(v)) || !ruled('valueId').every((v) => known.values.has(v))) {
      throw new Refused('INVALID_RULE')
    }
  }

  const saveCollection = (id: string | null, revision: number | null, input: CollectionInput) =>
    run(async (tx) => {
      const clean = cleanCollection(input)
      await checkIds(tx, id, clean)
      let collectionId: string
      let slug: string
      let nextRevision: number
      if (id === null) {
        await serialise(tx, `collection:${storeId}`)
        if ((await countCollections(tx, storeId)) >= maxCollections) throw new Refused('TOO_MANY_COLLECTIONS')
        collectionId = crypto.randomUUID()
        slug = await insertCollection(tx, storeId, collectionId, clean.fields)
        nextRevision = 1
      } else {
        if (revision === null) throw new Refused('INVALID_INPUT')
        // A live address changes only when asked for: a rename alone would break every link to it.
        const stored = clean.slugGiven ? null : await selectCollection(tx, storeId, id)
        const done = await updateCollection(tx, storeId, id, revision, stored ? { ...clean.fields, slug: stored.slug } : clean.fields, now())
        if (!done) throw new Refused((await selectCollection(tx, storeId, id)) ? 'STALE_REVISION' : 'NOT_FOUND')
        collectionId = id
        slug = done
        nextRevision = revision + 1
      }
      await setCollectionRules(tx, storeId, collectionId, clean.rules)
      if (clean.fields.kind === 'manual') await setCollectionProducts(tx, storeId, collectionId, clean.productIds)
      await activity.record(tx, entry(structureAudit.collectionSaved, { type: 'collection', id: collectionId, label: clean.fields.name }))
      // Any save, hand-picked too: a child limited to this collection reads its products (inherit_parent).
      await recompute(tx)
      return { id: collectionId, slug, revision: nextRevision }
    })

  const removeCollection = (id: string) =>
    run(async (tx) => {
      const gone = isUuid(id) ? await softDeleteCollection(tx, storeId, id, now()) : null
      if (!gone) throw new Refused('NOT_FOUND')
      await activity.record(tx, entry(structureAudit.collectionDeleted, { type: 'collection', id, label: gone.name }))
      // A child limited to this parent is now its own: its rules alone decide again.
      await recompute(tx)
      return true
    })

  const menu = () => inScope((tx) => selectMenu(tx, storeId))

  const saveMenu = (revision: number | null, menuName: string | null, items: readonly MenuItemInput[]) =>
    run(async (tx) => {
      const rows = cleanMenu(items)
      const linked = rows.map((r) => r.collection_id).filter((c): c is string => c !== null)
      const known = await knownCatalogueIds(tx, storeId, { collections: linked, products: [], versions: [], values: [], images: [] })
      if (!linked.every((c) => known.collections.has(c))) throw new Refused('INVALID_LINK')
      const saved = await writeMenu(tx, storeId, revision, optional(menuName, 60) ?? 'Main menu', rows, now())
      if (saved === null) throw new Refused('STALE_REVISION')
      await activity.record(tx, entry(structureAudit.menuSaved, { type: 'menu', id: 'main', label: String(rows.length) }))
      return saved
    })

  return { facets, saveFacet, removeFacet, mergeValues, collections, collection, members, saveCollection, removeCollection, menu, saveMenu }
}
