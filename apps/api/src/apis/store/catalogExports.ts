import { GraphQLError } from 'graphql'
import { storeRoleHas } from '#auth/storePermissions'
import { catalogExportAudit, catalogExportKind, createCatalogExportService, type CatalogExportDto } from '#engine/modules/catalog/index'
import { queueSideEffect } from '#saas/outbox/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'

// Products › Import and export's exports (CATALOG K8; FIRST-RELEASE §13): Staff and up on the merchant side
// (`exports`), every supplier tier its own (`exports.products`). An export is a read, so read-only allows it.

const access = { api: 'store', scope: 'store-seller', permission: 'catalog.read', target: 'none' } as const

const service = (ctx: StoreContext) => {
  if (!ctx.sql) throw forbidden()
  const caller = actingCaller(ctx)
  if (!storeRoleHas(caller.role, caller.seller ? 'exports.products' : 'exports')) throw forbidden()
  return createCatalogExportService({
    sql: ctx.sql,
    context: caller.context,
    actor: { id: caller.person.id, label: caller.person.name || caller.person.email, partnerId: caller.person.partnerId },
    activity: ctx.activity,
    facts: ctx.facts,
    now: ctx.now,
    queue: (tx, payload) => queueSideEffect(tx, { kind: catalogExportKind, idempotencyKey: payload.jobId, payload, partnerId: payload.partnerId, storeId: payload.storeId }),
  })
}

export const registerCatalogExports = (builder: StoreBuilder) => {
  const Export = builder.objectRef<CatalogExportDto>('CatalogExport').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      kind: t.exposeString('kind'),
      // queued, done, failed or expired
      state: t.exposeString('state'),
      rows: t.exposeInt('rows', { nullable: true }),
      truncated: t.exposeBoolean('truncated'),
      csv: t.exposeString('csv', { nullable: true }),
      requestedAt: t.string({ resolve: (e) => e.requestedAt.toISOString() }),
      expiresAt: t.string({ nullable: true, resolve: (e) => e.expiresAt?.toISOString() ?? null }),
    }),
  })
  const Filter = builder.inputType('CatalogExportFilterInput', {
    fields: (t) => ({ filter: t.string(), search: t.string(), supplier: t.string() }),
  })
  const Kind = builder.enumType('CatalogExportKind', { values: ['products', 'stock'] as const })

  builder.queryFields((t) => ({
    catalogExport: t.field({ type: Export, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: { access }, resolve: (_, { id }, ctx) => service(ctx).catalogExport(String(id)) }),
    catalogExports: t.field({ type: [Export], extensions: { access }, resolve: (_, __, ctx) => service(ctx).recentExports() }),
  }))

  builder.mutationFields((t) => ({
    requestCatalogExport: t.id({
      args: { kind: t.arg({ type: Kind, required: true }), filter: t.arg({ type: Filter }) },
      extensions: { access: { ...access, whileReadOnly: true, audit: catalogExportAudit } },
      resolve: async (_, { kind, filter }, ctx) => {
        // A read-only support session reads the store's screens, never takes its data away (ACCESS §8).
        const { caller } = actingCaller(ctx).context
        if (caller.kind === 'support' && caller.access === 'read') throw forbidden()
        const result = await service(ctx).requestExport(kind, filter)
        if (!result.ok) throw new GraphQLError('That filter doesn’t work.', { extensions: { code: result.reason } })
        return result.jobId
      },
    }),
  }))
}
