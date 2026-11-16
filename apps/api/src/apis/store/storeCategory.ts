import { GraphQLError } from 'graphql'
import { createCatalogImportService } from '#engine/modules/catalog/index'
import { queueSideEffect } from '#saas/outbox/index'
import { categoryName, createStoreCategoryService, storeCategoryAudit, type SampleRefusal, type ShopCategoryRow } from '#saas/storeCategories/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'

// What the store sells (DATA-MODEL §7.2; FIRST-RELEASE §5, §12): the merchant side reads it, the Owner picks it on
// Home's checklist or Settings › Catalogue. A supplier never sees it.

const sampleWords: Record<SampleRefusal, string> = {
  NO_CATEGORY: 'Choose what your shop sells first.',
  NO_SAMPLE: 'There’s no sample catalog for this category yet.',
  HAS_ORDERS: 'The sample catalog is only for a shop that has no orders yet.',
  ALREADY_ADDED: 'The sample catalog is already in your shop, or on its way.',
}

export const registerStoreCategory = (builder: StoreBuilder) => {
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return createStoreCategoryService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts })
  }

  const Category = builder.objectRef<ShopCategoryRow>('ShopCategory').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      key: t.exposeString('key'),
      // In the portal's language when staff have translated it, else English.
      name: t.string({ args: { language: t.arg.string() }, resolve: (c, args) => categoryName(c, args.language ?? 'en') }),
      sections: t.exposeStringList('sections'),
      archived: t.boolean({ resolve: (c) => c.archived_at !== null }),
      // Staff gave it a sample catalog the store can add while it has no order (DATA-MODEL §7.2).
      hasSample: t.exposeBoolean('has_sample'),
    }),
  })
  const Choice = builder.objectRef<{ options: ShopCategoryRow[]; current: ShopCategoryRow | null }>('ShopCategoryChoice').implement({
    fields: (t) => ({
      options: t.field({ type: [Category], resolve: (c) => c.options }),
      current: t.field({ type: Category, nullable: true, resolve: (c) => c.current }),
    }),
  })

  builder.queryFields((t) => ({
    shopCategory: t.field({
      type: Choice,
      extensions: { access: { api: 'store', scope: 'store', permission: 'catalog.read', target: 'none' } },
      resolve: (_, __, ctx: StoreContext) => service(ctx).read(),
    }),
  }))

  builder.mutationFields((t) => ({
    chooseShopCategory: t.field({
      type: Category,
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { api: 'store', scope: 'store', permission: 'settings', target: 'none', audit: storeCategoryAudit.chosen } },
      resolve: async (_, args, ctx: StoreContext) => {
        const result = await service(ctx).choose(String(args.id))
        if (result.ok) return result.value
        const words = { INVALID_INPUT: 'Something here isn’t valid.', NOT_FOUND: 'That category isn’t available any more.', KEY_TAKEN: 'Something here isn’t valid.' }
        throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
      },
    }),
    // The sample goes through the ordinary import: the merchant reviews it and presses Import (CATALOG K2).
    addSampleCatalog: t.id({
      extensions: { access: { api: 'store', scope: 'store', permission: 'catalog.import', target: 'none', audit: storeCategoryAudit.sampleAdded } },
      resolve: async (_, __, ctx: StoreContext) => {
        const categories = service(ctx)
        const sample = await categories.sampleToAdd()
        if (!sample.ok) throw new GraphQLError(sampleWords[sample.reason], { extensions: { code: sample.reason } })
        const caller = actingCaller(ctx)
        if (!ctx.sql) throw forbidden()
        const imports = createCatalogImportService({
          sql: ctx.sql,
          context: caller.context,
          actor: { id: caller.person.id, label: caller.person.name || caller.person.email, partnerId: caller.person.partnerId },
          activity: ctx.activity,
          facts: ctx.facts,
          now: ctx.now,
          queue: (tx, kind, key, payload) => queueSideEffect(tx, { kind, idempotencyKey: key, payload, partnerId: caller.person.partnerId, storeId: caller.context.storeId }),
        })
        const { categoryId, file, currency } = sample.value
        const started = await imports.start(file, 'csv', null, currency, categoryId).catch((error: unknown) => {
          // A second click while the first is on its way: the database keeps one (0400 catalog_import_one_sample).
          if (typeof error === 'object' && error !== null && 'constraint_name' in error && error.constraint_name === 'catalog_import_one_sample') return null
          throw error
        })
        if (!started) throw new GraphQLError(sampleWords.ALREADY_ADDED, { extensions: { code: 'ALREADY_ADDED' } })
        if (!started.ok) throw new GraphQLError('That sample can’t be imported right now.', { extensions: { code: started.reason } })
        await categories.recordSampleAdded(started.value, categoryId)
        return started.value
      },
    }),
  }))
}
