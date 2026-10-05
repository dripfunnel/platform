import { GraphQLError } from 'graphql'
import { createTranslationService, translationAudit, type SharedNameRow, type TranslationResult, type TranslationRow } from '#engine/modules/catalog/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'

// Translations (CATALOG facts 18–22, N): the catalogue's write permission; a supplier its own products only, the
// shared option and choice names, collections and filters being the merchant side's.

const words: Record<Exclude<TranslationResult<unknown>, { ok: true }>['reason'], string> = {
  NOT_FOUND: 'That is no longer here.',
  NOT_A_TRANSLATION_LANGUAGE: 'Choose one of your store’s other languages.',
  INVALID_INPUT: 'Something here isn’t valid.',
  INVALID_SLUG: 'Use lowercase letters, numbers and hyphens for the web address.',
  DUPLICATE_SLUG: 'Another item already uses that web address in this language.',
  SUPPLIER_FIELD: 'Option and choice names are translated by the store, once for the whole catalogue.',
}

const answered = <T>(result: TranslationResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
}

const maxShared = 100

/** The translation service for the acting caller; products.ts checks its list's language with it. */
export const translationService = (ctx: StoreContext) => {
  if (!ctx.sql) throw forbidden()
  const caller = actingCaller(ctx)
  return createTranslationService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
}

export const registerTranslations = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)
  const service = translationService

  const Translation = builder.objectRef<TranslationRow>('Translation').implement({
    fields: (t) => ({
      // product | version | collection | filter | filter_value | option_name | choice_name
      entity: t.exposeString('entity'),
      // The entity's id; for option and choice names, the shared main-language name lowercased.
      entityId: t.exposeString('entity_id'),
      field: t.exposeString('field'),
      main: t.exposeString('main'),
      text: t.exposeString('text', { nullable: true }),
      // translated | changed (the main text moved since, N5) | missing (shoppers see the main text, fact 19)
      status: t.exposeString('status'),
    }),
  })
  const SharedName = builder.objectRef<SharedNameRow>('SharedName').implement({
    fields: (t) => ({
      kind: t.exposeString('kind'),
      source: t.exposeString('source'),
      main: t.exposeString('main'),
      uses: t.exposeInt('uses'),
      text: t.exposeString('text', { nullable: true }),
    }),
  })
  const SharedNamePage = builder.objectRef<{ nodes: SharedNameRow[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('SharedNamePage').implement({
    fields: (t) => ({ nodes: t.field({ type: [SharedName], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const Progress = builder.objectRef<{ products: number; untranslated: number }>('TranslationProgress').implement({
    fields: (t) => ({ products: t.exposeInt('products'), untranslated: t.exposeInt('untranslated') }),
  })
  const TextInput = builder.inputType('TranslationTextInput', {
    fields: (t) => ({ name: t.string(), slug: t.string(), description: t.string() }),
  })
  const VersionName = builder.inputType('VersionNameTranslationInput', { fields: (t) => ({ id: t.id({ required: true }), name: t.string() }) })
  const SharedNameInput = builder.inputType('SharedNameTranslationInput', {
    fields: (t) => ({ kind: t.string({ required: true }), source: t.string({ required: true }), text: t.string() }),
  })
  const ProductTranslationInput = builder.inputType('ProductTranslationInput', {
    fields: (t) => ({
      name: t.string(),
      slug: t.string(),
      description: t.string(),
      versions: t.field({ type: [VersionName] }),
      names: t.field({ type: [SharedNameInput] }),
    }),
  })

  const kindOf = (value: string): 'option_name' | 'choice_name' => {
    if (value === 'option_name' || value === 'choice_name') return value
    throw new GraphQLError(words.INVALID_INPUT, { extensions: { code: 'INVALID_INPUT' } })
  }
  const entityOf = (value: string): 'collection' | 'filter' | 'filter_value' => {
    if (value === 'collection' || value === 'filter' || value === 'filter_value') return value
    throw new GraphQLError(words.INVALID_INPUT, { extensions: { code: 'INVALID_INPUT' } })
  }

  const read = { api: 'store', scope: 'store-seller', permission: 'catalog.read', target: 'none' } as const
  const write = { api: 'store', scope: 'store-seller', permission: 'catalog.write', target: 'none' } as const
  const merchantRead = { ...read, scope: 'store' } as const
  const merchantWrite = { ...write, scope: 'store' } as const

  builder.queryFields((t) => ({
    productTranslation: t.field({
      type: [Translation],
      args: { productId: t.arg.id({ required: true }), language: t.arg.string({ required: true }) },
      extensions: { access: read },
      resolve: async (_, args, ctx) => answered(await service(ctx).productTranslation(String(args.productId), args.language)),
    }),
    catalogueTranslation: t.field({
      type: [Translation],
      args: { entity: t.arg.string({ required: true }), id: t.arg.id({ required: true }), language: t.arg.string({ required: true }) },
      extensions: { access: merchantRead },
      resolve: async (_, args, ctx) => answered(await service(ctx).entityTranslation(entityOf(args.entity), String(args.id), args.language)),
    }),
    sharedNames: t.field({
      type: SharedNamePage,
      args: { kind: t.arg.string({ required: true }), language: t.arg.string({ required: true }), first: t.arg.int(), after: t.arg.string() },
      extensions: { access: merchantRead },
      resolve: async (_, args, ctx) => {
        const limit = Math.min(Math.max(args.first ?? 50, 1), maxShared)
        const rows = answered(await service(ctx).sharedNames(kindOf(args.kind), args.language, { limit, after: args.after ?? null }))
        const nodes = rows.slice(0, limit)
        return { nodes, pageInfo: { startCursor: nodes[0]?.source ?? null, endCursor: nodes.at(-1)?.source ?? null, hasPreviousPage: args.after != null, hasNextPage: rows.length > limit } }
      },
    }),
    translationProgress: t.field({
      type: Progress,
      args: { language: t.arg.string({ required: true }) },
      extensions: { access: read },
      resolve: async (_, args, ctx) => answered(await service(ctx).counts(args.language)),
    }),
  }))

  builder.mutationFields((t) => ({
    saveProductTranslation: t.field({
      type: [Translation],
      args: { productId: t.arg.id({ required: true }), language: t.arg.string({ required: true }), input: t.arg({ type: ProductTranslationInput, required: true }) },
      extensions: { access: { ...write, audit: translationAudit.product } },
      resolve: async (_, args, ctx) =>
        answered(
          await service(ctx).saveProductTranslation(String(args.productId), args.language, {
            name: args.input.name,
            slug: args.input.slug,
            description: args.input.description,
            versions: args.input.versions?.map((v) => ({ id: String(v.id), name: v.name ?? null })),
            names: args.input.names?.map((n) => ({ kind: kindOf(n.kind), source: n.source, text: n.text ?? null })),
          }),
        ),
    }),
    saveCatalogueTranslation: t.field({
      type: [Translation],
      args: { entity: t.arg.string({ required: true }), id: t.arg.id({ required: true }), language: t.arg.string({ required: true }), input: t.arg({ type: TextInput, required: true }) },
      extensions: { access: { ...merchantWrite, audit: translationAudit.entity } },
      resolve: async (_, args, ctx) => answered(await service(ctx).saveEntityTranslation(entityOf(args.entity), String(args.id), args.language, args.input)),
    }),
    saveSharedNames: t.boolean({
      args: { language: t.arg.string({ required: true }), names: t.arg({ type: [SharedNameInput], required: true }) },
      extensions: { access: { ...merchantWrite, audit: translationAudit.shared } },
      resolve: async (_, args, ctx) => answered(await service(ctx).saveSharedNames(args.language, args.names.map((n) => ({ kind: kindOf(n.kind), source: n.source, text: n.text ?? null })))),
    }),
  }))
}
