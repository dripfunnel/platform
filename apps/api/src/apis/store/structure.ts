import { GraphQLError } from 'graphql'
import type { StoreCaller } from '#auth/storeCaller'
import { pageOf } from '#core/paging'
import type { ScopedSql } from '#db/scoped/index'
import { collectionsRecomputeKind, createStructureService, maxCollectionProducts, structureAudit, type StructureRefusal, type StructureResult } from '#engine/modules/catalog/index'
import { queueSideEffect } from '#saas/outbox/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'
import { storePage } from './refusals'
import { isUuid } from '#core/ids'

// Collections, filters (`facets`) and the main menu (FIRST-RELEASE §12, §19): the merchant side's, but
// `facets`, which a supplier reads to tag its own products (DATA-MODEL §7.11's read-only branch).

const words: Record<StructureRefusal, string> = {
  NAME_REQUIRED: 'Give it a name.',
  INVALID_INPUT: 'Something here isn’t valid.',
  NOT_FOUND: 'That isn’t here any more.',
  STALE_REVISION: 'Someone else saved this. Reload to see their changes.',
  DUPLICATE_NAME: 'Another filter already has that name.',
  DUPLICATE_VALUE: 'A filter lists the same value twice.',
  TOO_MANY_RULES: 'A collection can have up to 20 rules.',
  INVALID_RULE: 'A rule names something this store doesn’t have.',
  TOO_MANY_PRODUCTS: 'A collection can hold up to 1,000 hand-picked products.',
  INVALID_PARENT: 'Choose another collection of this store as the parent, never itself or one inside it.',
  TOO_MANY_ITEMS: 'A menu can have up to 100 items.',
  INVALID_LINK: 'A menu item links a collection, a page of the shop, or an https address.',
  TOO_DEEP: 'A menu nests one level.',
  TOO_MANY_FILTERS: 'A store can have up to 200 filters. Merge or remove one first.',
  TOO_MANY_COLLECTIONS: 'A store can have up to 500 collections. Remove one first.',
}

const answered = <T>(result: StructureResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
}


/** The store's automatic collections recomputed after this transaction commits; a new key each time, since each change needs one. */
export const recomputeFor =
  (caller: StoreCaller) =>
  (tx: ScopedSql): Promise<unknown> =>
    queueSideEffect(tx, { kind: collectionsRecomputeKind, idempotencyKey: crypto.randomUUID(), payload: { storeId: caller.store.id }, partnerId: caller.person.partnerId, storeId: caller.store.id })

export const registerStructure = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)

  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return createStructureService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now, recompute: recomputeFor(caller) })
  }

  const FacetValue = builder.objectRef<{ id: string; name: string; products: number }>('FacetValue').implement({
    fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name'), products: t.exposeInt('products') }),
  })
  const Facet = builder.objectRef<{ id: string; name: string; position: number; shopper_visible: boolean; values: { id: string; name: string; products: number }[] }>('Facet').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      position: t.exposeInt('position'),
      // An internal tag only the team sees (CATALOG I1).
      shopperVisible: t.exposeBoolean('shopper_visible'),
      values: t.field({ type: [FacetValue], resolve: (f) => f.values }),
    }),
  })

  type FacetView = { id: string; name: string; position: number; shopper_visible: boolean; values: { id: string; name: string; products: number }[] }
  const FacetPage = builder.objectRef<{ nodes: FacetView[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('FacetPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Facet], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })

  type CollectionSummary = { id: string; name: string; slug: string; kind: string; visibility: string; parent_id: string | null; products: number; computed_at: Date | null; created_at: Date }
  const CollectionSummaryType = builder.objectRef<CollectionSummary>('CollectionSummary').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      slug: t.exposeString('slug'),
      kind: t.exposeString('kind'),
      visible: t.boolean({ resolve: (c) => c.visibility === 'visible' }),
      parentId: t.exposeID('parent_id', { nullable: true }),
      products: t.exposeInt('products'),
      // Null until an automatic collection's rules have first landed (fact 11: "Updating…").
      computedAt: t.string({ nullable: true, resolve: (c) => c.computed_at?.toISOString() ?? null }),
    }),
  })
  const CollectionPage = builder.objectRef<{ nodes: CollectionSummary[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('CollectionPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [CollectionSummaryType], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const Rule = builder.objectRef<{ kind: string; args: Record<string, unknown> }>('CollectionRule').implement({
    fields: (t) => ({
      kind: t.exposeString('kind'),
      valueId: t.id({ nullable: true, resolve: (r) => (typeof r.args['valueId'] === 'string' ? r.args['valueId'] : null) }),
      text: t.string({ nullable: true, resolve: (r) => (typeof r.args['text'] === 'string' ? r.args['text'] : null) }),
      productId: t.id({ nullable: true, resolve: (r) => (typeof r.args['productId'] === 'string' ? r.args['productId'] : null) }),
      versionId: t.id({ nullable: true, resolve: (r) => (typeof r.args['versionId'] === 'string' ? r.args['versionId'] : null) }),
      currency: t.string({ nullable: true, resolve: (r) => (typeof r.args['currency'] === 'string' ? r.args['currency'] : null) }),
      min: t.string({ nullable: true, resolve: (r) => (typeof r.args['min'] === 'string' ? r.args['min'] : null) }),
      max: t.string({ nullable: true, resolve: (r) => (typeof r.args['max'] === 'string' ? r.args['max'] : null) }),
    }),
  })
  const MemberType = builder.objectRef<{ id: string; name: string; source: string }>('CollectionMember').implement({
    fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name'), source: t.exposeString('source') }),
  })
  type CollectionView = NonNullable<Awaited<ReturnType<ReturnType<typeof service>['collection']>>>
  const CollectionType = builder.objectRef<CollectionView>('Collection').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      slug: t.exposeString('slug'),
      description: t.exposeString('description'),
      kind: t.exposeString('kind'),
      match: t.exposeString('match'),
      parentId: t.exposeID('parent_id', { nullable: true }),
      inheritParent: t.exposeBoolean('inherit_parent'),
      visible: t.boolean({ resolve: (c) => c.visibility === 'visible' }),
      imageAssetId: t.exposeID('image_asset_id', { nullable: true }),
      sort: t.exposeString('sort'),
      seoTitle: t.exposeString('seo_title', { nullable: true }),
      seoDescription: t.exposeString('seo_description', { nullable: true }),
      computedAt: t.string({ nullable: true, resolve: (c) => c.computed_at?.toISOString() ?? null }),
      // How many products the rules matched; more than it holds means the newest 1,000 are kept.
      ruleMatches: t.exposeInt('rule_matches', { nullable: true }),
      truncated: t.boolean({ resolve: (c) => (c.rule_matches ?? 0) > maxCollectionProducts }),
      revision: t.exposeInt('revision'),
      rules: t.field({ type: [Rule], resolve: (c) => c.rules }),
    }),
  })
  const MemberPage = builder.objectRef<{ nodes: { id: string; name: string; source: string }[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('CollectionMemberPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [MemberType], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const MenuItem = builder.objectRef<{ id: string; parent_id: string | null; label: string; kind: string; collection_id: string | null; url: string | null }>('MenuItem').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      parentId: t.exposeID('parent_id', { nullable: true }),
      label: t.exposeString('label'),
      kind: t.exposeString('kind'),
      collectionId: t.exposeID('collection_id', { nullable: true }),
      url: t.exposeString('url', { nullable: true }),
    }),
  })
  const MenuType = builder.objectRef<{ name: string; revision: number; items: { id: string; parent_id: string | null; label: string; kind: string; collection_id: string | null; url: string | null }[] }>('Menu').implement({
    fields: (t) => ({ name: t.exposeString('name'), revision: t.exposeInt('revision'), items: t.field({ type: [MenuItem], resolve: (m) => m.items }) }),
  })
  const SavedCollection = builder.objectRef<{ id: string; slug: string; revision: number }>('SavedCollection').implement({
    fields: (t) => ({ id: t.exposeID('id'), slug: t.exposeString('slug'), revision: t.exposeInt('revision') }),
  })

  const FacetValueInput = builder.inputType('FacetValueInput', { fields: (t) => ({ id: t.string(), name: t.string({ required: true }) }) })
  const FacetInput = builder.inputType('FacetInput', {
    fields: (t) => ({ id: t.string(), name: t.string({ required: true }), shopperVisible: t.boolean(), position: t.int(), values: t.field({ type: [FacetValueInput], required: true }) }),
  })
  const RuleInput = builder.inputType('CollectionRuleInput', {
    fields: (t) => ({ kind: t.string({ required: true }), valueId: t.string(), text: t.string(), productId: t.string(), versionId: t.string(), currency: t.string(), min: t.string(), max: t.string() }),
  })
  const CollectionInput = builder.inputType('CollectionInput', {
    fields: (t) => ({
      name: t.string({ required: true }),
      slug: t.string(),
      description: t.string(),
      kind: t.string({ required: true }),
      match: t.string(),
      parentId: t.string(),
      inheritParent: t.boolean(),
      visible: t.boolean(),
      imageAssetId: t.string(),
      sort: t.string(),
      seoTitle: t.string(),
      seoDescription: t.string(),
      rules: t.field({ type: [RuleInput] }),
      productIds: t.stringList(),
    }),
  })
  const MenuChildInput = builder.inputType('MenuChildInput', {
    fields: (t) => ({ label: t.string({ required: true }), kind: t.string({ required: true }), collectionId: t.string(), url: t.string() }),
  })
  const MenuItemInput = builder.inputType('MenuItemInput', {
    // One level of nesting, so a child takes no children (FIRST-RELEASE §12).
    fields: (t) => ({ label: t.string({ required: true }), kind: t.string({ required: true }), collectionId: t.string(), url: t.string(), children: t.field({ type: [MenuChildInput] }) }),
  })

  const read = { api: 'store', scope: 'store', permission: 'catalog.read', target: 'none' } as const
  const write = { api: 'store', scope: 'store', permission: 'catalog.write', target: 'none' } as const

  builder.queryFields((t) => ({
    facets: t.field({
      type: FacetPage,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: { ...read, scope: 'store-seller' } },
      resolve: async (_, args, ctx) => {
        const window = storePage(args)
        const rows = await service(ctx).facets(window)
        // The cursor's time is the negated position (catalogStructure.ts selectFacets).
        return pageOf(rows, window, (r) => ({ occurredAt: new Date(-r.position), id: r.id }))
      },
    }),
    collections: t.field({
      type: CollectionPage,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: read },
      resolve: async (_, args, ctx) => {
        const window = storePage(args)
        const rows = await service(ctx).collections(window)
        return pageOf(rows, window, (r) => ({ occurredAt: r.created_at, id: r.id }))
      },
    }),
    collection: t.field({
      type: CollectionType,
      nullable: true,
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: read },
      resolve: (_, args, ctx) => (isUuid(String(args.id)) ? service(ctx).collection(String(args.id)) : null),
    }),
    collectionProducts: t.field({
      type: MemberPage,
      args: { id: t.arg.id({ required: true }), first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: read },
      resolve: async (_, args, ctx) => {
        const window = storePage(args)
        if (!isUuid(String(args.id))) return { nodes: [], pageInfo: { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false } }
        const rows = await service(ctx).members(String(args.id), window)
        // The cursor's time is the negated position (catalogStructure.ts selectCollectionProducts).
        return pageOf(rows, window, (r) => ({ occurredAt: new Date(-r.position), id: r.id }))
      },
    }),
    menu: t.field({ type: MenuType, nullable: true, extensions: { access: read }, resolve: (_, __, ctx) => service(ctx).menu() }),
  }))

  builder.mutationFields((t) => ({
    saveFacet: t.id({
      args: { input: t.arg({ type: FacetInput, required: true }) },
      extensions: { access: { ...write, audit: structureAudit.facetSaved } },
      resolve: async (_, args, ctx) => answered(await service(ctx).saveFacet(args.input)),
    }),
    deleteFacet: t.boolean({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...write, audit: structureAudit.facetDeleted } },
      resolve: async (_, args, ctx) => answered(await service(ctx).removeFacet(String(args.id))),
    }),
    mergeFacetValues: t.int({
      args: { into: t.arg.id({ required: true }), from: t.arg.idList({ required: true }) },
      extensions: { access: { ...write, audit: structureAudit.facetValuesMerged } },
      resolve: async (_, args, ctx) => answered(await service(ctx).mergeValues(String(args.into), args.from.map(String))),
    }),
    addProductsToCollection: t.int({
      args: { collectionId: t.arg.id({ required: true }), productIds: t.arg.idList({ required: true }) },
      extensions: { access: { api: 'store', scope: 'store', permission: 'catalog.write', target: 'none', audit: structureAudit.collectionSaved } },
      // Answers how many products the collection now holds.
      resolve: async (_, args, ctx) => answered(await service(ctx).addToCollection(String(args.collectionId), args.productIds.map(String))),
    }),
    saveCollection: t.field({
      type: SavedCollection,
      args: { id: t.arg.id(), revision: t.arg.int(), input: t.arg({ type: CollectionInput, required: true }) },
      extensions: { access: { ...write, audit: structureAudit.collectionSaved } },
      resolve: async (_, args, ctx) => {
        const id = args.id === null || args.id === undefined ? null : String(args.id)
        if (id !== null && !isUuid(id)) throw new GraphQLError(words.NOT_FOUND, { extensions: { code: 'NOT_FOUND' } })
        return answered(await service(ctx).saveCollection(id, args.revision ?? null, args.input))
      },
    }),
    deleteCollection: t.boolean({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...write, audit: structureAudit.collectionDeleted } },
      resolve: async (_, args, ctx) => answered(await service(ctx).removeCollection(String(args.id))),
    }),
    saveMenu: t.int({
      args: { revision: t.arg.int(), name: t.arg.string(), items: t.arg({ type: [MenuItemInput], required: true }) },
      extensions: { access: { ...write, audit: structureAudit.menuSaved } },
      resolve: async (_, args, ctx) => answered(await service(ctx).saveMenu(args.revision ?? null, args.name ?? null, args.items)),
    }),
  }))
}
