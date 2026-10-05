import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { TenantContext } from '#core/tenancy'
import {
  countBadges,
  countSizeCharts,
  deleteBadge,
  featureKeys,
  insertSizeChart,
  maxBadges,
  maxSizeCharts,
  selectBadges,
  selectFeatures,
  selectSizeChart,
  selectSizeCharts,
  setFeatures,
  softDeleteSizeChart,
  updateSizeChart,
  upsertBadge,
  type FeatureKey,
} from '#db/scoped/catalogListing'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { cleanBadge, cleanSizeChart, ListingInvalid, type SizeChartInput } from './listing'

// Settings › Catalogue (CATALOG P1, S5) and size charts (R): the switches and badges are the merchant
// side's; a supplier makes, edits and reads its own charts only (R13), through its scope.

export const settingsAudit = {
  featuresSaved: 'catalogue.settings_saved',
  badgeSaved: 'badge.saved',
  badgeDeleted: 'badge.deleted',
  sizeChartSaved: 'size_chart.saved',
  sizeChartDeleted: 'size_chart.deleted',
} as const

export type SettingsRefusal = 'INVALID_INPUT' | 'NOT_FOUND' | 'STALE_REVISION' | 'DUPLICATE_LABEL' | 'TOO_MANY_BADGES' | 'TOO_MANY_SIZE_CHARTS'
export type SettingsResult<T> = { ok: true; value: T } | { ok: false; reason: SettingsRefusal }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

class Refused extends Error {
  constructor(readonly reason: SettingsRefusal) {
    super(reason)
  }
}

export interface SettingsDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

export const createSettingsService = ({ sql, context, actor, activity, facts, now }: SettingsDeps) => {
  const { storeId } = context
  const sellerId = context.sellerScope.kind === 'seller' ? context.sellerScope.sellerId : null
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
    sellerId,
    target,
    reason: null,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const run = async <T>(work: (tx: ScopedSql) => Promise<T>): Promise<SettingsResult<T>> => {
    try {
      return { ok: true, value: await inScope(work) }
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason }
      if (error instanceof ListingInvalid) return { ok: false, reason: 'INVALID_INPUT' }
      if (typeof error === 'object' && error !== null && 'constraint_name' in error && error.constraint_name === 'badge_label_key') return { ok: false, reason: 'DUPLICATE_LABEL' }
      throw error
    }
  }

  const settings = () => inScope(async (tx) => ({ features: await selectFeatures(tx, storeId), badges: await selectBadges(tx, storeId) }))

  const saveFeatures = (features: readonly { key: string; enabled: boolean }[]) =>
    run(async (tx) => {
      const known = features.filter((f): f is { key: FeatureKey; enabled: boolean } => (featureKeys as readonly string[]).includes(f.key))
      if (known.length !== features.length || new Set(known.map((f) => f.key)).size !== known.length) throw new Refused('INVALID_INPUT')
      await setFeatures(tx, storeId, known, now())
      await activity.record(tx, entry(settingsAudit.featuresSaved, { type: 'store', id: storeId, label: known.map((f) => `${f.key}:${f.enabled ? 'on' : 'off'}`).join(',') }))
      return selectFeatures(tx, storeId)
    })

  const saveBadge = (id: string | null, input: { label: string; tone: string; rule: string; position?: number | null | undefined }) =>
    run(async (tx) => {
      const clean = cleanBadge(input)
      if (id !== null && !uuid.test(id)) throw new Refused('NOT_FOUND')
      if (id === null && (await countBadges(tx, storeId)) >= maxBadges) throw new Refused('TOO_MANY_BADGES')
      const badgeId = id ?? crypto.randomUUID()
      if (!(await upsertBadge(tx, storeId, { id: badgeId, ...clean }, id !== null))) throw new Refused('NOT_FOUND')
      await activity.record(tx, entry(settingsAudit.badgeSaved, { type: 'badge', id: badgeId, label: clean.label }))
      return badgeId
    })

  const removeBadge = (id: string) =>
    run(async (tx) => {
      const gone = uuid.test(id) ? await deleteBadge(tx, storeId, id) : null
      if (gone === null) throw new Refused('NOT_FOUND')
      await activity.record(tx, entry(settingsAudit.badgeDeleted, { type: 'badge', id, label: gone }))
      return true
    })

  const sizeCharts = () => inScope((tx) => selectSizeCharts(tx, storeId))

  const sizeChart = (id: string) => inScope((tx) => selectSizeChart(tx, storeId, id))

  const saveSizeChart = (id: string | null, revision: number | null, input: SizeChartInput) =>
    run(async (tx) => {
      const clean = cleanSizeChart(input)
      let chartId: string
      let next: number
      if (id === null) {
        if ((await countSizeCharts(tx, storeId)) >= maxSizeCharts) throw new Refused('TOO_MANY_SIZE_CHARTS')
        chartId = crypto.randomUUID()
        await insertSizeChart(tx, storeId, sellerId, chartId, clean)
        next = 1
      } else {
        if (!uuid.test(id) || revision === null) throw new Refused('NOT_FOUND')
        if (!(await updateSizeChart(tx, storeId, id, revision, clean, now()))) throw new Refused((await selectSizeChart(tx, storeId, id)) ? 'STALE_REVISION' : 'NOT_FOUND')
        chartId = id
        next = revision + 1
      }
      await activity.record(tx, entry(settingsAudit.sizeChartSaved, { type: 'size_chart', id: chartId, label: clean.name }))
      return { id: chartId, revision: next }
    })

  const removeSizeChart = (id: string) =>
    run(async (tx) => {
      const gone = uuid.test(id) ? await softDeleteSizeChart(tx, storeId, id, now()) : null
      if (!gone) throw new Refused('NOT_FOUND')
      await activity.record(tx, entry(settingsAudit.sizeChartDeleted, { type: 'size_chart', id, label: gone.name }))
      return gone.products
    })

  return { settings, saveFeatures, saveBadge, removeBadge, sizeCharts, sizeChart, saveSizeChart, removeSizeChart }
}
