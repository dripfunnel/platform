import { GraphQLError } from 'graphql'
import { catalogImportAudit, createCatalogImportService, type CatalogImportDto, type CatalogImportRefusal } from '#engine/modules/catalog/index'
import { queueSideEffect } from '#saas/outbox/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { requireFeature } from './listing'
import type { StoreBuilder } from './builder'

// Products › Import (CatImport; CATALOG K; FIRST-RELEASE §13): Owner and Manager, and a supplier at a catalogue
// tier for its own products (`catalog.import`). Upload, check, confirm; the run and its photos are jobs.

const words: Record<CatalogImportRefusal, string> = {
  INVALID_INPUT: 'Choose a CSV file to import.',
  FILE_TOO_LARGE: 'A file can be up to 5 MB. Split it and import each part.',
  NOT_FOUND: 'That import isn’t here any more.',
  NOT_READY: 'That import has already started, or its check isn’t finished.',
  NOTHING_TO_IMPORT: 'No product in this file is ready to import. Fix the problems and upload it again.',
  WAREHOUSE_NOT_FOUND: 'Choose one of your locations.',
}

const refused = (reason: CatalogImportRefusal) => new GraphQLError(words[reason], { extensions: { code: reason } })

const access = { api: 'store', scope: 'store-seller', permission: 'catalog.import', target: 'none' } as const

/** An import runs as a person in the store, whose seat each chunk checks again; a support session never starts one (ACCESS §8). */
const writer = (ctx: StoreContext) => {
  if (actingCaller(ctx).context.caller.kind === 'support') throw new GraphQLError('A support session can’t import. Someone in the store imports from their own account.', { extensions: { code: 'FORBIDDEN' } })
  return service(ctx)
}

const service = (ctx: StoreContext) => {
  if (!ctx.sql) throw forbidden()
  const caller = actingCaller(ctx)
  return createCatalogImportService({
    sql: ctx.sql,
    context: caller.context,
    actor: { id: caller.person.id, label: caller.person.name || caller.person.email, partnerId: caller.person.partnerId },
    activity: ctx.activity,
    facts: ctx.facts,
    now: ctx.now,
    queue: (tx, kind, key, payload) => queueSideEffect(tx, { kind, idempotencyKey: key, payload, partnerId: caller.person.partnerId, storeId: caller.store.id }),
  })
}

export const registerCatalogImports = (builder: StoreBuilder) => {
  const Problem = builder.objectRef<CatalogImportDto['problems'][number]>('CatalogImportProblem').implement({
    fields: (t) => ({
      // The file's line, the header being 1; 0 is the file as a whole.
      line: t.exposeInt('line'),
      column: t.exposeString('column', { nullable: true }),
      code: t.exposeString('code'),
      message: t.exposeString('message'),
    }),
  })
  const Import = builder.objectRef<CatalogImportDto>('CatalogImport').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      source: t.exposeString('source'),
      // checking, ready, running, done, failed or unreadable
      state: t.exposeString('state'),
      products: t.exposeInt('products'),
      ready: t.exposeInt('ready'),
      matched: t.exposeInt('matched'),
      done: t.exposeInt('done'),
      created: t.exposeInt('created'),
      updated: t.exposeInt('updated'),
      skipped: t.exposeInt('skipped'),
      failed: t.exposeInt('failed'),
      photosPending: t.exposeInt('photosPending'),
      problemCount: t.exposeInt('problemCount'),
      problems: t.field({ type: [Problem], resolve: (i) => i.problems }),
      problemsCsv: t.exposeString('problemsCsv', { nullable: true }),
      requestedAt: t.string({ resolve: (i) => i.requestedAt.toISOString() }),
      finishedAt: t.string({ nullable: true, resolve: (i) => i.finishedAt?.toISOString() ?? null }),
    }),
  })
  const Matching = builder.enumType('CatalogImportMatching', { values: ['update', 'skip'] as const })

  builder.queryFields((t) => ({
    catalogImport: t.field({ type: Import, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: { access }, resolve: (_, { id }, ctx) => service(ctx).catalogImport(String(id)) }),
    catalogImports: t.field({ type: [Import], extensions: { access }, resolve: (_, __, ctx) => service(ctx).recent() }),
    catalogImportTemplate: t.string({ extensions: { access }, resolve: (_, __, ctx) => service(ctx).template() }),
  }))

  builder.mutationFields((t) => ({
    startCatalogImport: t.id({
      args: { file: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: catalogImportAudit.started } },
      resolve: async (_, { file }, ctx) => {
        await requireFeature(ctx, actingCaller(ctx), 'import_spreadsheet')
        const result = await writer(ctx).start(file)
        if (!result.ok) throw refused(result.reason)
        return result.value
      },
    }),
    confirmCatalogImport: t.boolean({
      args: { id: t.arg.id({ required: true }), matching: t.arg({ type: Matching, required: true }), warehouseId: t.arg.id() },
      extensions: { access: { ...access, audit: catalogImportAudit.confirmed } },
      resolve: async (_, { id, matching, warehouseId }, ctx) => {
        const result = await writer(ctx).confirm(String(id), matching, warehouseId === null || warehouseId === undefined ? null : String(warehouseId))
        if (!result.ok) throw refused(result.reason)
        return true
      },
    }),
  }))
}
