import { GraphQLError } from 'graphql'
import type { CatalogExportDto } from '#engine/modules/catalog/index'
import { catalogExportKind } from '#engine/modules/catalog/index'
import { createReportExportService, reportExportAudit, reportPanels } from '#engine/modules/reports/index'
import { queueSideEffect } from '#saas/outbox/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'
import { requirePlan } from './refusals'

// Reports' "Export" on every panel and the custom report builder (FIRST-RELEASE §10, PortalReports): a job read back by
// id, for whoever reads Reports (`reports.read`); export needs the plan's `reports_export`, the builder `reports_custom`.

export const registerReportExports = (builder: StoreBuilder) => {
  const exportsOf = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return createReportExportService({
      sql: ctx.sql,
      context: caller.context,
      actor: { id: caller.person.id, label: caller.person.name || caller.person.email, partnerId: caller.person.partnerId },
      activity: ctx.activity,
      facts: ctx.facts,
      now: ctx.now,
      queue: (tx, payload) => queueSideEffect(tx, { kind: catalogExportKind, idempotencyKey: payload.jobId, payload, partnerId: payload.partnerId, storeId: payload.storeId }),
    })
  }

  const Panel = builder.enumType('ReportPanel', { values: reportPanels })
  const Custom = builder.inputType('CustomReportInput', {
    fields: (t) => ({
      // orders, products or customers
      rows: t.string({ required: true }),
      // orders: basic, tax or lines; products: basic or stock; customers: basic or groups
      columns: t.string({ required: true }),
    }),
  })
  const ReportExport = builder.objectRef<CatalogExportDto>('ReportExport').implement({
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

  const read = { api: 'store', scope: 'store', permission: 'reports.read', target: 'none' } as const

  builder.queryFields((t) => ({
    reportExport: t.field({ type: ReportExport, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: { access: read }, resolve: (_, { id }, ctx) => exportsOf(ctx).read(String(id)) }),
    reportExports: t.field({ type: [ReportExport], extensions: { access: read }, resolve: (_, __, ctx) => exportsOf(ctx).recent() }),
  }))

  builder.mutationFields((t) => ({
    // A job over the range and currency the screen shows; an export is a read, so a read-only store allows it.
    exportReport: t.id({
      args: { panel: t.arg({ type: Panel, required: true }), days: t.arg.int({ required: true }), currency: t.arg.string(), custom: t.arg({ type: Custom }) },
      extensions: { access: { ...read, whileReadOnly: true, audit: reportExportAudit } },
      resolve: async (_, args, ctx) => {
        // A read-only support session reads the store's screens, never takes its data away (ACCESS §8).
        const { context } = actingCaller(ctx)
        if (context.caller.kind === 'support' && context.caller.access === 'read') throw forbidden()
        if (!ctx.sql) throw forbidden()
        for (const key of args.panel === 'custom' ? (['reports_custom'] as const) : (['reports_sales', 'reports_export'] as const)) await requirePlan(ctx.sql, context, { key }, ctx.now())
        const result = await exportsOf(ctx).request({ panel: args.panel, days: args.days, currency: args.currency?.toUpperCase() ?? null, custom: args.custom ?? null })
        if (!result.ok) throw new GraphQLError('That report can’t be made.', { extensions: { code: result.reason } })
        return result.jobId
      },
    }),
  }))
}
