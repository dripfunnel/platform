import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { AccessTarget } from '#auth/assignment'
import { partnerScopedRoles, roleHas } from '#auth/permissions'
import type { StaffMember } from '#auth/staff'
import type { StaffContext } from '#core/tenancy'
import { serialise, withScope, type ScopedSql } from '#db/scoped/index'
import { insertDeliveryApp, selectLatestDeliveryApp, type StoreDeliveryAppRow } from '#db/scoped/storeDeliveryApp'
import { selectStore, selectStoreForUpdate } from '#db/scoped/stores'
import { reasonText, staffEntry } from '#saas/staff/index'
import { apkContentType, apkKey, looksLikeApk, maxApkBytes } from './files'

export { apkContentType, apkPrefix, maxApkBytes } from './files'

// A store's delivery app APK (card #852; api/DELIVERY.md §5): staff with `stores.deliveryApp.write` upload it and set the build number
// below which the app says "Update required". Each is a new version; every write records its entry, with the reason, in its transaction.

export const deliveryAppAudit = { uploaded: 'store.delivery_app_uploaded', minimumBuildSet: 'store.delivery_app_minimum_build_set' } as const

export type DeliveryAppRefusal = 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_INPUT' | 'TOO_LARGE' | 'NOT_AN_APK' | 'BUILD_NOT_NEWER' | 'NO_APP' | 'MINIMUM_ABOVE_BUILD' | 'UNAVAILABLE'
export type DeliveryAppResult<T> = { ok: true; value: T } | { ok: false; code: DeliveryAppRefusal }

/** The assets bucket, as far as the APK needs it (the Worker's `ASSETS` binding). */
export interface DeliveryAppStore {
  put(key: string, body: ReadableStream<Uint8Array> | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<{ size: number }>
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>
  delete(key: string): Promise<unknown>
}

export interface DeliveryAppDeps {
  sql: postgres.Sql
  staff: StaffMember
  facts: RequestFacts
  activity: ActivityLog
  isAssigned: (staffId: string, target: AccessTarget) => Promise<boolean>
  /** Null where no assets bucket is bound yet (THIRD-PARTY-ACCESS.md §2.1). */
  files: DeliveryAppStore | null
}

const versionName = z.string().regex(/^[0-9A-Za-z][0-9A-Za-z._+-]{0,39}$/)
const buildNumber = z.number().int().min(1).max(2_147_483_647)
const uploadInput = z.strictObject({ versionName, buildNumber, reason: reasonText })
const minimumInput = z.strictObject({ minimumBuild: buildNumber.nullable(), reason: reasonText })

export interface DeliveryAppView {
  version: number
  versionName: string
  buildNumber: number
  sizeBytes: number
  minimumBuild: number | null
  uploadedAt: string
}

const viewOf = (row: StoreDeliveryAppRow): DeliveryAppView => ({
  version: row.version,
  versionName: row.version_name,
  buildNumber: row.build_number,
  sizeBytes: Number(row.size_bytes),
  minimumBuild: row.minimum_build,
  uploadedAt: row.created_at.toISOString(),
})

interface StoreFacts {
  id: string
  name: string
  partner_id: string
}

class Refused extends Error {
  constructor(readonly code: DeliveryAppRefusal) {
    super(code)
  }
}

export const createDeliveryApp = ({ sql, staff, facts, activity, isAssigned, files }: DeliveryAppDeps) => {
  const context: StaffContext = { caller: { kind: 'staff', staffId: staff.id } }
  // A store outside a Partner manager's assignment is not found (ACCESS.md §5.4).
  const visible = async (storeId: string): Promise<boolean> =>
    z.guid().safeParse(storeId).success && (!partnerScopedRoles.includes(staff.role) || (await isAssigned(staff.id, { storeId })))
  const asStaff = staffEntry(staff, facts)
  const may = () => roleHas(staff.role, 'stores.deliveryApp.write')

  const entry = (store: StoreFacts, action: string, reason: string, label: string): ActivityEntry =>
    asStaff({ action, reason, partnerId: store.partner_id, storeId: store.id, target: { type: 'store', id: store.id, label }, visibility: 'partner' })

  /** Runs `write` under the store's lock; a refusal thrown inside rolls the transaction back, entry and row with it. */
  const inStore = async <T>(storeId: string, write: (tx: ScopedSql, store: StoreFacts, latest: StoreDeliveryAppRow | null) => Promise<T>): Promise<DeliveryAppResult<T>> => {
    if (!(await visible(storeId))) return { ok: false, code: 'NOT_FOUND' }
    try {
      const value = await withScope(sql, context, async (tx) => {
        const store = await selectStoreForUpdate(tx, storeId)
        if (!store) throw new Refused('NOT_FOUND')
        await serialise(tx, `delivery-app:${storeId}`)
        return write(tx, store, await selectLatestDeliveryApp(tx, storeId))
      })
      return { ok: true, value }
    } catch (error) {
      if (error instanceof Refused) return { ok: false, code: error.code }
      throw error
    }
  }

  /** The live version without taking any lock; `row` is null for a store with none. */
  const current = async (storeId: string): Promise<DeliveryAppResult<{ row: StoreDeliveryAppRow | null }>> => {
    if (!(await visible(storeId))) return { ok: false, code: 'NOT_FOUND' }
    const found = await withScope(sql, context, async (tx) => ((await selectStore(tx, storeId)) ? { row: await selectLatestDeliveryApp(tx, storeId) } : null))
    return found ? { ok: true, value: found } : { ok: false, code: 'NOT_FOUND' }
  }

  const read = async (storeId: string): Promise<DeliveryAppResult<DeliveryAppView | null>> => {
    if (!roleHas(staff.role, 'stores.read')) return { ok: false, code: 'FORBIDDEN' }
    const found = await current(storeId)
    return found.ok ? { ok: true, value: found.value.row ? viewOf(found.value.row) : null } : found
  }

  /**
   * Stores the APK under the store's prefix as a new version. The file is streamed and checked first, outside any transaction, so a slow
   * upload holds no lock; then the row and the entry are written. A file the transaction did not keep is removed again.
   */
  const upload = async (storeId: string, raw: unknown, body: ReadableStream<Uint8Array> | null, length: number): Promise<DeliveryAppResult<DeliveryAppView>> => {
    if (!may()) return { ok: false, code: 'FORBIDDEN' }
    const parsed = uploadInput.safeParse(raw)
    if (!parsed.success || !body || !Number.isInteger(length) || length < 1) return { ok: false, code: 'INVALID_INPUT' }
    if (length > maxApkBytes) return { ok: false, code: 'TOO_LARGE' }
    if (!files) return { ok: false, code: 'UNAVAILABLE' }
    const input = parsed.data
    const key = apkKey(storeId)
    const before = await current(storeId)
    if (!before.ok) return before
    if (before.value.row && input.buildNumber <= before.value.row.build_number) return { ok: false, code: 'BUILD_NOT_NEWER' }
    let kept = false
    try {
      const put = await files.put(key, body, { httpMetadata: { contentType: apkContentType } })
      if (put.size !== length) return { ok: false, code: 'INVALID_INPUT' }
      const head = new Uint8Array((await (await files.get(key, { range: { offset: 0, length: 4 } }))?.arrayBuffer()) ?? new ArrayBuffer(0))
      if (!looksLikeApk(head)) return { ok: false, code: 'NOT_AN_APK' }
      const done = await inStore(storeId, async (tx, store, latest) => {
        if (latest && input.buildNumber <= latest.build_number) throw new Refused('BUILD_NOT_NEWER')
        // A new build keeps the minimum staff set, which stays below it.
        const row = await insertDeliveryApp(tx, storeId, staff.id, { apk_key: key, version_name: input.versionName, build_number: input.buildNumber, size_bytes: String(length), minimum_build: latest?.minimum_build ?? null })
        await activity.record(tx, entry(store, deliveryAppAudit.uploaded, input.reason, `${store.name}: ${input.versionName} (${input.buildNumber})`))
        return viewOf(row)
      })
      kept = done.ok
      return done
    } finally {
      if (!kept) await files.delete(key).catch(() => undefined)
    }
  }

  /** A new version with the same file and a new minimum build (null removes it), never above the build uploaded. */
  const setMinimumBuild = async (storeId: string, raw: unknown): Promise<DeliveryAppResult<DeliveryAppView>> => {
    if (!may()) return { ok: false, code: 'FORBIDDEN' }
    const parsed = minimumInput.safeParse(raw)
    if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' }
    const input = parsed.data
    return inStore(storeId, async (tx, store, latest) => {
      if (!latest) throw new Refused('NO_APP')
      if (input.minimumBuild !== null && input.minimumBuild > latest.build_number) throw new Refused('MINIMUM_ABOVE_BUILD')
      if (input.minimumBuild === latest.minimum_build) return viewOf(latest)
      const row = await insertDeliveryApp(tx, storeId, staff.id, { apk_key: latest.apk_key, version_name: latest.version_name, build_number: latest.build_number, size_bytes: latest.size_bytes, minimum_build: input.minimumBuild })
      await activity.record(tx, entry(store, deliveryAppAudit.minimumBuildSet, input.reason, `${store.name}: minimum build ${input.minimumBuild ?? 'none'}`))
      return viewOf(row)
    })
  }

  return { read, upload, setMinimumBuild }
}
