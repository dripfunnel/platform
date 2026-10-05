import { GraphQLError } from 'graphql'
import type { StoreCaller } from '#auth/storeCaller'
import { pageOf } from '#core/paging'
import { isUuid } from '#core/ids'
import { createSettingsService, settingsAudit, type SettingsRefusal, type SettingsResult } from '#engine/modules/catalog/index'
import { planLimitFor } from '#saas/entitlements/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'
import { requirePlan, storePage } from './refusals'

// Settings › Catalogue (CATALOG P1, S5) and size charts (R; FIRST-RELEASE §12, §19). The plan decides on the
// server; a supplier never sees plans or prices (P11), only whether a section is there for it.

const words: Record<SettingsRefusal, string> = {
  INVALID_INPUT: 'Something here isn’t valid.',
  NOT_FOUND: 'That isn’t here any more.',
  STALE_REVISION: 'Someone else saved this. Reload to see their changes.',
  DUPLICATE_LABEL: 'Another badge already has that label.',
  TOO_MANY_BADGES: 'A store can have up to 20 badges.',
  TOO_MANY_SIZE_CHARTS: 'You can have up to 200 size charts. Remove one first.',
}

const answered = <T>(result: SettingsResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
}

/** The plan switch behind a section, where one gates it (SAAS §6.1). */
type GatedKey = 'size_charts' | 'aplus'
export const featurePlanKey: Partial<Record<string, GatedKey>> = { sizeCharts: 'size_charts', aplus: 'aplus' }

/**
 * Refuses when the store's plan doesn't include `key`. The merchant side hears which plan unlocks it; a
 * supplier only that the section isn't available (CATALOG P11).
 */
export const requireFeature = async (ctx: StoreContext, caller: StoreCaller, key: GatedKey): Promise<void> => {
  if (!ctx.sql) throw forbidden()
  if (caller.seller === null) return requirePlan(ctx.sql, caller.context, { key }, ctx.now())
  if (await planLimitFor(ctx.sql, caller.context, { key }, ctx.now())) throw new GraphQLError('This isn’t available in this store.', { extensions: { code: 'FEATURE_UNAVAILABLE' } })
}

export const registerListing = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return createSettingsService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
  }

  const Feature = builder.objectRef<{ key: string; enabled: boolean; inPlan: boolean | null }>('CatalogueFeature').implement({
    fields: (t) => ({
      key: t.exposeString('key'),
      // For a supplier, on only when the store has it on and its plan includes it; it never hears which.
      enabled: t.exposeBoolean('enabled'),
      inPlan: t.exposeBoolean('inPlan', { nullable: true }),
    }),
  })
  const Badge = builder.objectRef<{ id: string; label: string; tone: string; rule: string; position: number }>('Badge').implement({
    fields: (t) => ({ id: t.exposeID('id'), label: t.exposeString('label'), tone: t.exposeString('tone'), rule: t.exposeString('rule'), position: t.exposeInt('position') }),
  })
  const Settings = builder.objectRef<{ features: { key: string; enabled: boolean; inPlan: boolean | null }[]; badges: { id: string; label: string; tone: string; rule: string; position: number }[]; pricingCurrency: string | null }>('CatalogueSettings').implement({
    fields: (t) => ({
      features: t.field({ type: [Feature], resolve: (s) => s.features }),
      badges: t.field({ type: [Badge], resolve: (s) => s.badges }),
      pricingCurrency: t.exposeString('pricingCurrency', { nullable: true }),
    }),
  })
  type Chart = NonNullable<Awaited<ReturnType<ReturnType<typeof service>['sizeChart']>>>
  type ChartSummary = Awaited<ReturnType<ReturnType<typeof service>['sizeCharts']>>[number]
  const SizeChartSummary = builder.objectRef<ChartSummary>('SizeChartSummary').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      unit: t.exposeString('unit'),
      supplierId: t.exposeID('seller_id', { nullable: true }),
      products: t.exposeInt('products'),
      updatedAt: t.string({ resolve: (c) => c.updated_at.toISOString() }),
    }),
  })
  const SizeChartPage = builder.objectRef<{ nodes: ChartSummary[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('SizeChartPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [SizeChartSummary], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const MeasureNote = builder.objectRef<{ measurement: string; text: string }>('SizeChartMeasureNote').implement({
    fields: (t) => ({ measurement: t.exposeString('measurement'), text: t.exposeString('text') }),
  })
  const ChartRow = builder.objectRef<{ size: string; values: string[] }>('SizeChartRow').implement({
    fields: (t) => ({ size: t.exposeString('size'), values: t.exposeStringList('values') }),
  })
  const SizeChart = builder.objectRef<Chart>('SizeChart').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      unit: t.exposeString('unit'),
      systems: t.exposeStringList('systems'),
      measurements: t.exposeStringList('measurements'),
      rows: t.field({ type: [ChartRow], resolve: (c) => c.rows }),
      howToMeasure: t.field({ type: [MeasureNote], resolve: (c) => c.how_to_measure }),
      fitNotes: t.exposeString('fit_notes', { nullable: true }),
      modelInfo: t.exposeString('model_info', { nullable: true }),
      // A supplier's own chart (R13); null is the merchant's.
      supplierId: t.exposeID('seller_id', { nullable: true }),
      products: t.exposeInt('products'),
      revision: t.exposeInt('revision'),
      updatedAt: t.string({ resolve: (c) => c.updated_at.toISOString() }),
    }),
  })
  const SavedChart = builder.objectRef<{ id: string; revision: number }>('SavedSizeChart').implement({ fields: (t) => ({ id: t.exposeID('id'), revision: t.exposeInt('revision') }) })

  const FeatureInput = builder.inputType('CatalogueFeatureInput', { fields: (t) => ({ key: t.string({ required: true }), enabled: t.boolean({ required: true }) }) })
  const BadgeInput = builder.inputType('BadgeInput', { fields: (t) => ({ label: t.string({ required: true }), tone: t.string({ required: true }), rule: t.string({ required: true }), position: t.int() }) })
  const RowInput = builder.inputType('SizeChartRowInput', { fields: (t) => ({ size: t.string({ required: true }), values: t.stringList({ required: true }) }) })
  const NoteInput = builder.inputType('SizeChartMeasureNoteInput', { fields: (t) => ({ measurement: t.string({ required: true }), text: t.string({ required: true }) }) })
  const ChartInput = builder.inputType('SizeChartInput', {
    fields: (t) => ({
      name: t.string({ required: true }),
      unit: t.string({ required: true }),
      systems: t.stringList(),
      measurements: t.stringList({ required: true }),
      rows: t.field({ type: [RowInput], required: true }),
      howToMeasure: t.field({ type: [NoteInput] }),
      fitNotes: t.string(),
      modelInfo: t.string(),
    }),
  })

  const read = { api: 'store', scope: 'store-seller', permission: 'catalog.read', target: 'none' } as const
  const charts = { api: 'store', scope: 'store-seller', permission: 'catalog.write', target: 'none' } as const
  const settingsWrite = { api: 'store', scope: 'store', permission: 'settings', target: 'none' } as const

  builder.queryFields((t) => ({
    catalogueSettings: t.field({
      type: Settings,
      extensions: { access: read },
      resolve: async (_, __, ctx) => {
        const caller = actingCaller(ctx)
        const { features, badges, pricingCurrency } = await service(ctx).settings()
        const rows = await Promise.all(
          Object.entries(features).map(async ([key, enabled]) => {
            const planKey = featurePlanKey[key]
            const inPlan = !planKey || !ctx.sql ? true : (await planLimitFor(ctx.sql, caller.context, { key: planKey }, ctx.now())) === null
            return caller.seller !== null ? { key, enabled: enabled && inPlan, inPlan: null } : { key, enabled, inPlan }
          }),
        )
        return { features: rows, badges, pricingCurrency }
      },
    }),
    sizeCharts: t.field({
      type: SizeChartPage,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: read },
      resolve: async (_, args, ctx) => {
        const window = storePage(args)
        return pageOf(await service(ctx).sizeCharts(window), window, (c) => ({ occurredAt: c.updated_at, id: c.id }))
      },
    }),
    sizeChart: t.field({
      type: SizeChart,
      nullable: true,
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: read },
      resolve: (_, args, ctx) => (isUuid(String(args.id)) ? service(ctx).sizeChart(String(args.id)) : null),
    }),
  }))

  builder.mutationFields((t) => ({
    saveCatalogueSettings: t.field({
      type: [Feature],
      args: { features: t.arg({ type: [FeatureInput], required: true }) },
      extensions: { access: { ...settingsWrite, audit: settingsAudit.featuresSaved } },
      resolve: async (_, args, ctx) => {
        const caller = actingCaller(ctx)
        // A section the plan doesn't include can't be switched on (P5); switching it off is always allowed.
        for (const f of args.features) {
          const planKey = featurePlanKey[f.key]
          if (f.enabled && planKey) await requireFeature(ctx, caller, planKey)
        }
        const saved = answered(await service(ctx).saveFeatures(args.features))
        return Object.entries(saved).map(([key, enabled]) => ({ key, enabled, inPlan: null }))
      },
    }),
    saveBadge: t.id({
      args: { id: t.arg.id(), input: t.arg({ type: BadgeInput, required: true }) },
      extensions: { access: { ...settingsWrite, audit: settingsAudit.badgeSaved } },
      resolve: async (_, args, ctx) => answered(await service(ctx).saveBadge(args.id === null || args.id === undefined ? null : String(args.id), args.input)),
    }),
    deleteBadge: t.boolean({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...settingsWrite, audit: settingsAudit.badgeDeleted } },
      resolve: async (_, args, ctx) => answered(await service(ctx).removeBadge(String(args.id))),
    }),
    saveSizeChart: t.field({
      type: SavedChart,
      args: { id: t.arg.id(), revision: t.arg.int(), input: t.arg({ type: ChartInput, required: true }) },
      extensions: { access: { ...charts, audit: settingsAudit.sizeChartSaved } },
      resolve: async (_, args, ctx) => {
        await requireFeature(ctx, actingCaller(ctx), 'size_charts')
        return answered(await service(ctx).saveSizeChart(args.id === null || args.id === undefined ? null : String(args.id), args.revision ?? null, args.input))
      },
    }),
    // A chart in use is deleted only after the editor said how many products lose it (R10); the answer is that count.
    deleteSizeChart: t.int({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...charts, audit: settingsAudit.sizeChartDeleted } },
      resolve: async (_, args, ctx) => answered(await service(ctx).removeSizeChart(String(args.id))),
    }),
  }))
}
