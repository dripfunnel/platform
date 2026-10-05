import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { TenantContext } from '#core/tenancy'
import { withScope } from '#db/scoped/index'
import { logoRefused, saveHomeTaxId, saveLegalName, saveStoreInfo, selectStoreInfo } from '#db/scoped/storeInfo'
import { cleanStoreInfo, type StoreInfoInput, type StoreInfoRefusal } from './rules'

export type { StoreInfoRow } from '#db/scoped/storeInfo'
export type { StoreInfoInput } from './rules'

// Settings › Store info (SetStore): the Owner's. Languages and currencies are their own sections (markets).

export const storeInfoAudit = { saved: 'store.info_saved' } as const

export type StoreInfoResult<T> = { ok: true; value: T } | { ok: false; reason: StoreInfoRefusal | 'NOT_FOUND' | 'INVALID_LOGO' }

export interface StoreInfoDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

export const createStoreInfoService = ({ sql, context, actor, activity, facts, now }: StoreInfoDeps) => {
  const { storeId } = context

  const entry = (reason: string | null): ActivityEntry => ({
    category: 'write',
    action: storeInfoAudit.saved,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    target: { type: 'store', id: storeId, label: 'Store info' },
    reason,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const info = () => withScope(sql, context, (tx) => selectStoreInfo(tx, storeId))

  /** SetStore's "Save": the whole section at once; issued invoices keep the details they were printed with. */
  const save = async (input: StoreInfoInput): Promise<StoreInfoResult<true>> => {
    try {
      return await withScope(sql, context, async (tx): Promise<StoreInfoResult<true>> => {
        const before = await selectStoreInfo(tx, storeId)
        if (!before) return { ok: false, reason: 'NOT_FOUND' }
        const cleaned = cleanStoreInfo(input, before.country)
        if (typeof cleaned === 'string') return { ok: false, reason: cleaned }
        await saveStoreInfo(tx, cleaned)
        await saveLegalName(tx, storeId, cleaned.legalName, now())
        if (before.country) await saveHomeTaxId(tx, storeId, before.country, cleaned.taxId)
        const changed = (['name', 'description', 'time_zone', 'unit_system', 'order_prefix'] as const).filter((k) => {
          const after = { name: cleaned.name, description: cleaned.description, time_zone: cleaned.timeZone, unit_system: cleaned.unitSystem, order_prefix: cleaned.orderPrefix }[k]
          return after !== before[k]
        })
        await activity.record(tx, entry(changed.length > 0 ? changed.join(', ') : null))
        return { ok: true, value: true }
      })
    } catch (error) {
      if (logoRefused(error)) return { ok: false, reason: 'INVALID_LOGO' }
      throw error
    }
  }

  return { info, save }
}
