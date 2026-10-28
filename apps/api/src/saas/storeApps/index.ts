import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { TenantContext } from '#core/tenancy'
import { serialise, withScope } from '#db/scoped/index'
import { insertAppAssets, selectLatestAppAssets, type StoreAppAssetsFields, type StoreAppAssetsRow } from '#db/scoped/storeAppAssets'
import { checkBrandFile, type BrandFileRefusal } from '#saas/partnerBranding/brandFile'
import type { BrandFileStore } from '#saas/partnerBranding/index'
import { appFileKey, appFileKinds, uploadedAsAppFile, type AppFileKind } from './files'

export { appFileKinds, appFilePrefix, maxAppFileBytes, type AppFileKind } from './files'

// Settings › Mobile apps (mobile-app/README.md §3; SH 15): the Owner (`settings`) gives the store's apps their icon, splash and
// listing text, with the partner's image rules (BUILD-CHECKLIST §2), and a plan with `own_apps` (SAAS §6.1). Each save is a new version.

export const storeAppsAudit = { saved: 'mobile_app.assets_saved', fileUploaded: 'mobile_app.file_uploaded' } as const

export const maxAppName = 30
export const maxShortDescription = 80
export const maxLongDescription = 4000

export type StoreAppsRefusal =
  | { reason: 'PLAN_LIMIT'; key: 'own_apps' }
  | { reason: 'FORBIDDEN' | 'INVALID_INPUT' | 'UNKNOWN_FILE' | 'UNAVAILABLE' | BrandFileRefusal }
export type StoreAppsResult<T> = { ok: true; value: T } | ({ ok: false } & StoreAppsRefusal)

/** What the tab shows: whether the plan has apps, and the newest version. */
export interface StoreAppsView {
  available: boolean
  current: StoreAppAssetsRow | null
}

export interface StoreAppsDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  /** Whether the store's plan switches `own_apps` on (saas/entitlements). */
  ownApps: () => Promise<boolean>
  /** The assets bucket (the Worker's `ASSETS` binding); null where none is bound yet. */
  files: BrandFileStore | null
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional()
    .transform((value) => value ?? null)
const key = z.string().max(300).nullable().optional()

const saveInput = z.strictObject({
  appIcon: key,
  appIconForeground: key,
  splash: key,
  appName: text(maxAppName),
  shortDescription: text(maxShortDescription),
  longDescription: text(maxLongDescription),
})

export type SaveAppAssetsInput = z.input<typeof saveInput>

export const createStoreApps = ({ sql, context, actor, activity, facts, ownApps, files }: StoreAppsDeps) => {
  const { storeId } = context

  const entry = (action: string, target: { type: string; id: string; label: string }): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    target,
    reason: null,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const read = async (): Promise<StoreAppsView> => {
    if (!(await ownApps())) return { available: false, current: null }
    return { available: true, current: await withScope(sql, context, (tx) => selectLatestAppAssets(tx, storeId)) }
  }

  /** Stores a checked image under the store's own prefix and answers its key, which `save` takes. */
  const upload = async (kind: AppFileKind, bytes: Uint8Array): Promise<StoreAppsResult<{ key: string }>> => {
    if (!(await ownApps())) return { ok: false, reason: 'PLAN_LIMIT', key: 'own_apps' }
    if (!files) return { ok: false, reason: 'UNAVAILABLE' }
    const checked = checkBrandFile(bytes, kind)
    if (!checked.ok) return { ok: false, reason: checked.code }
    const stored = appFileKey(storeId, kind)
    // Written inside the entry's transaction: a failed write rolls the entry back, and one failing after it leaves an unlogged object no version names.
    await withScope(sql, context, async (tx) => {
      await activity.record(tx, entry(storeAppsAudit.fileUploaded, { type: 'file', id: stored, label: kind }))
      await files.put(stored, bytes, { httpMetadata: { contentType: 'image/png' } })
    })
    return { ok: true, value: { key: stored } }
  }

  const save = async (raw: SaveAppAssetsInput): Promise<StoreAppsResult<StoreAppAssetsRow>> => {
    const parsed = saveInput.safeParse(raw)
    if (!parsed.success) return { ok: false, reason: 'INVALID_INPUT' }
    if (!(await ownApps())) return { ok: false, reason: 'PLAN_LIMIT', key: 'own_apps' }
    const input = parsed.data
    // A file is one this store uploaded as that kind, which is how it is known to have passed that kind's checks.
    const named = [
      ['appIcon', input.appIcon],
      ['appIconForeground', input.appIconForeground],
      ['splash', input.splash],
    ] as const
    if (named.some(([kind, value]) => value && !uploadedAsAppFile(value, storeId, kind))) return { ok: false, reason: 'UNKNOWN_FILE' }
    const fields: StoreAppAssetsFields = {
      app_icon_key: input.appIcon || null,
      app_icon_foreground_key: input.appIconForeground || null,
      splash_key: input.splash || null,
      app_name: input.appName,
      short_description: input.shortDescription,
      long_description: input.longDescription,
    }
    const row = await withScope(sql, context, async (tx) => {
      await serialise(tx, `store-apps:${storeId}`)
      const latest = await selectLatestAppAssets(tx, storeId)
      // Saving what is already live adds nothing to the history.
      if (latest && same(latest, fields)) return latest
      const added = await insertAppAssets(tx, storeId, actor.id, fields)
      await activity.record(tx, entry(storeAppsAudit.saved, { type: 'mobile_app', id: storeId, label: `version ${added.version}` }))
      return added
    })
    return { ok: true, value: row }
  }

  return { read, upload, save }
}

const same = (row: StoreAppAssetsRow, fields: StoreAppAssetsFields): boolean =>
  row.app_icon_key === fields.app_icon_key &&
  row.app_icon_foreground_key === fields.app_icon_foreground_key &&
  row.splash_key === fields.splash_key &&
  row.app_name === fields.app_name &&
  row.short_description === fields.short_description &&
  row.long_description === fields.long_description

export const isAppFileKind = (value: string | null): value is AppFileKind => (appFileKinds as readonly string[]).includes(value ?? '')
