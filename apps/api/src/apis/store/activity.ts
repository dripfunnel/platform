import { GraphQLError } from 'graphql'
import { catalogExportKind, type CatalogExportDto } from '#engine/modules/catalog/index'
import { queueSideEffect } from '#saas/outbox/index'
import { createStoreActivityService, storeActivityAudit, type StoreActivityEntry } from '#saas/storeActivity/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'

// The store's Activity log (FIRST-RELEASE §15, StoreActivity): read by the Owner and, as Store activity,
// the Manager (`activity.read`, never the Settings permission); the CSV is the Owner's (`activity.export`).

const invalid = () => new GraphQLError('That filter, person or page link doesn’t work.', { extensions: { code: 'INVALID_INPUT' } })

export const registerActivity = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)

  const serviceOf = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    return createStoreActivityService({
      sql: ctx.sql,
      caller: actingCaller(ctx),
      activity: ctx.activity,
      facts: ctx.facts,
      now: ctx.now,
      queue: (tx, payload) => queueSideEffect(tx, { kind: catalogExportKind, idempotencyKey: payload.jobId, payload, partnerId: payload.partnerId, storeId: payload.storeId }),
    })
  }

  type Change = StoreActivityEntry['changes'][number]
  const ChangeType = builder.objectRef<Change>('StoreActivityChange').implement({
    fields: (t) => ({
      field: t.exposeString('field'),
      before: t.string({ nullable: true, resolve: (c) => (c.before === null || c.before === undefined ? null : String(c.before)) }),
      after: t.string({ nullable: true, resolve: (c) => (c.after === null || c.after === undefined ? null : String(c.after)) }),
    }),
  })
  const Actor = builder.objectRef<StoreActivityEntry['actor']>('StoreActivityActor').implement({
    fields: (t) => ({ kind: t.exposeString('kind'), id: t.exposeString('id', { nullable: true }), label: t.exposeString('label', { nullable: true }) }),
  })
  const Agent = builder.objectRef<NonNullable<StoreActivityEntry['onBehalfOf']>>('StoreActivityAgent').implement({
    fields: (t) => ({ kind: t.exposeString('kind'), id: t.exposeString('id'), label: t.exposeString('label', { nullable: true }) }),
  })
  const Through = builder.objectRef<NonNullable<StoreActivityEntry['through']>>('StoreActivityThrough').implement({
    // support_session or impersonation
    fields: (t) => ({ kind: t.exposeString('kind'), id: t.exposeString('id') }),
  })
  const Target = builder.objectRef<NonNullable<StoreActivityEntry['target']>>('StoreActivityTarget').implement({
    fields: (t) => ({ type: t.exposeString('type'), id: t.exposeString('id', { nullable: true }), label: t.exposeString('label', { nullable: true }) }),
  })
  const Entry = builder.objectRef<StoreActivityEntry>('StoreActivityEntry').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      at: t.string({ resolve: (e) => e.at.toISOString() }),
      category: t.exposeString('category'),
      action: t.exposeString('action'),
      result: t.exposeString('result'),
      actor: t.field({ type: Actor, resolve: (e) => e.actor }),
      onBehalfOf: t.field({ type: Agent, nullable: true, resolve: (e) => e.onBehalfOf }),
      through: t.field({ type: Through, nullable: true, resolve: (e) => e.through }),
      sellerId: t.exposeString('sellerId', { nullable: true }),
      customerId: t.exposeString('customerId', { nullable: true }),
      target: t.field({ type: Target, nullable: true, resolve: (e) => e.target }),
      changes: t.field({ type: [ChangeType], resolve: (e) => e.changes }),
      reason: t.exposeString('reason', { nullable: true }),
    }),
  })
  const Page = builder.objectRef<{ items: StoreActivityEntry[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('StoreActivityPage').implement({
    fields: (t) => ({ items: t.field({ type: [Entry], resolve: (p) => p.items }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const Export = builder.objectRef<CatalogExportDto>('StoreActivityExport').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      // queued, done, failed or expired
      state: t.exposeString('state'),
      rows: t.exposeInt('rows', { nullable: true }),
      truncated: t.exposeBoolean('truncated'),
      csv: t.exposeString('csv', { nullable: true }),
      requestedAt: t.string({ resolve: (e) => e.requestedAt.toISOString() }),
      expiresAt: t.string({ nullable: true, resolve: (e) => e.expiresAt?.toISOString() ?? null }),
    }),
  })
  const Filter = builder.inputType('StoreActivityFilter', {
    fields: (t) => ({
      // person, customer, partner_user, api_key, app_grant, support_session, job or provider, with its id
      personKind: t.string(),
      personId: t.string(),
      // catalogue, orders, team, settings, support, shoppers or signins
      what: t.string(),
      // success, denied or failed
      result: t.string(),
      search: t.string(),
      // UTC days, YYYY-MM-DD, inclusive
      from: t.string(),
      to: t.string(),
    }),
  })

  // GraphQL's absent fields arrive as null; the filter's schema reads only what was given.
  const filterOf = (raw: Record<string, unknown> | null | undefined) => Object.fromEntries(Object.entries(raw ?? {}).filter(([, v]) => v !== null && v !== undefined))

  const read = { api: 'store', scope: 'store', permission: 'activity.read', target: 'none' } as const
  const exporting = { api: 'store', scope: 'store', permission: 'activity.export', target: 'none' } as const

  builder.queryFields((t) => ({
    activityLog: t.field({
      type: Page,
      args: { filter: t.arg({ type: Filter }), first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: read },
      resolve: async (_, { filter, ...page }, ctx) => (await serviceOf(ctx).activityLog(filterOf(filter), page)) ?? Promise.reject(invalid()),
    }),
    activityExport: t.field({ type: Export, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: { access: exporting }, resolve: (_, { id }, ctx) => serviceOf(ctx).exportJob(String(id)) }),
  }))

  builder.mutationFields((t) => ({
    // An export is a read, so a read-only store allows it.
    exportActivity: t.id({
      args: { filter: t.arg({ type: Filter }) },
      extensions: { access: { ...exporting, whileReadOnly: true, audit: storeActivityAudit.exportActivity } },
      resolve: async (_, { filter }, ctx) => {
        const result = await serviceOf(ctx).exportActivity(filterOf(filter))
        if (!result.ok) throw invalid()
        return result.jobId
      },
    }),
  }))
}
