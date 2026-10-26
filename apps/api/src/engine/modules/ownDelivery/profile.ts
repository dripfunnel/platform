import { releaseRiderDeliveries } from './dispatch'
import { withSystemScope } from '#db/scoped/index'
import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { logEvent } from '#core/log'
import type { TenantContext } from '#core/tenancy'
import { serialise, withScope, type ScopedSql } from '#db/scoped/index'
import { deleteRiderDevices } from '#db/scoped/pushDevices'
import { countOwnUploadsSince, deleteOwnUploads, endRiderSessions, markRiderRemoved, ownPhotoExists, selectOwnRider, updateOwnRider, type OwnRiderRow } from '#db/scoped/riders'
import { createAssetService, type AssetStore, type UploadResult } from '#engine/modules/catalog/index'

// A signed-in rider's own account on the Delivery API (DELIVERY §4, §5): its profile, and deleting it, which is the
// Owner's removal (decided on #839; erasure's "Former rider" comes with #874). Always as app_rider, on its own row.

export const riderProfileAudit = { profileSaved: 'rider.profile_saved', accountDeleted: 'rider.account_deleted' } as const

export const vehicleTypes = ['bike', 'scooter', 'car', 'bicycle', 'foot'] as const

/** Photos a rider may upload in 24 hours: enough to retake one, never a store's bucket filled (#839's review). */
export const photoUploadsPerDay = 10

/** The assets bucket, which also deletes a rider's photos with its account. */
export interface RiderFiles extends AssetStore {
  delete: (keys: string[]) => Promise<unknown>
}

const profileInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  photoAssetId: z.uuid().nullable(),
  vehicleType: z.enum(vehicleTypes).nullable(),
  vehicleNumber: z.string().trim().max(20).transform((v) => v || null).nullable(),
})
export type ProfileInput = z.input<typeof profileInput>

export type ProfileResult<T> = { ok: true; value: T } | { ok: false; reason: 'UNAUTHENTICATED' | 'INVALID_INPUT' | 'PHOTO_NOT_FOUND' }

export interface RiderProfileDeps {
  sql: postgres.Sql
  /** The rider's own context: caller kind `rider`. */
  context: TenantContext & { caller: { kind: 'rider'; riderId: string } }
  activity: ActivityLog
  facts: RequestFacts
  /** Null where the Worker has no ASSETS binding: uploads answer NOT_CONNECTED. */
  files: RiderFiles | null
  now: () => Date
}

export const createRiderProfile = ({ sql, context, activity, facts, files, now }: RiderProfileDeps) => {
  const { storeId, partnerId } = context
  const { riderId } = context.caller

  const entry = (action: string, rider: { id: string; name: string }, changes?: ActivityEntry['changes']): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'rider',
    actorId: rider.id,
    actorLabel: rider.name,
    partnerId,
    storeId,
    target: { type: 'rider', id: rider.id, label: rider.name },
    ...(changes ? { changes } : {}),
    reason: null,
    api: 'delivery',
    visibility: 'store',
    ...facts,
  })

  const me = (): Promise<OwnRiderRow | null> => withScope(sql, context, (tx) => selectOwnRider(tx, storeId, riderId))

  const update = (raw: ProfileInput): Promise<ProfileResult<OwnRiderRow>> =>
    withScope(sql, context, async (tx): Promise<ProfileResult<OwnRiderRow>> => {
      const parsed = profileInput.safeParse(raw)
      if (!parsed.success) return { ok: false, reason: 'INVALID_INPUT' }
      const input = parsed.data
      const before = await selectOwnRider(tx, storeId, riderId)
      if (!before) return { ok: false, reason: 'UNAUTHENTICATED' }
      if (input.photoAssetId && input.photoAssetId !== before.photo_asset_id && !(await ownPhotoExists(tx, storeId, riderId, input.photoAssetId))) return { ok: false, reason: 'PHOTO_NOT_FOUND' }
      const saved = await updateOwnRider(tx, storeId, riderId, input, now())
      if (!saved) return { ok: false, reason: 'UNAUTHENTICATED' }
      // The fields that changed, without their values: a rider's details are personal data (LOGGING §4.1).
      const changed = (['name', 'photo_asset_id', 'vehicle_type', 'vehicle_number'] as const).filter((k) => before[k] !== saved[k])
      await activity.record(tx, entry(riderProfileAudit.profileSaved, saved, changed.map((field) => ({ field, before: null, after: null }))))
      return { ok: true, value: saved }
    })

  /** The raw image `updateProfile` then names, at most `photoUploadsPerDay` in 24 hours (DELIVERY §4). */
  const uploadPhoto = async (bytes: Uint8Array<ArrayBuffer>): Promise<UploadResult | { ok: false; code: 'RATE_LIMITED' | 'NOT_CONNECTED' }> => {
    if (!files) return { ok: false, code: 'NOT_CONNECTED' }
    const since = new Date(now().getTime() - 86_400_000)
    // Held to the commit, so parallel uploads count one another (#839's review).
    const admit = async (tx: ScopedSql) => {
      await serialise(tx, `rider_uploads:${riderId}`)
      return (await countOwnUploadsSince(tx, storeId, riderId, since)) < photoUploadsPerDay
    }
    return createAssetService({ sql, context, actor: { id: riderId, partnerId, kind: 'rider' }, activity, facts, store: files }).uploadImage(bytes, admit)
  }

  /** Signed out everywhere, phone and photos erased, the name kept for past deliveries (DELIVERY §5). */
  const deleteAccount = async (): Promise<ProfileResult<true>> => {
    const done = await withSystemScope(sql, async (tx): Promise<{ ok: false; reason: 'UNAUTHENTICATED' } | { ok: true; keys: string[] }> => {
      const rider = await selectOwnRider(tx, storeId, riderId)
      if (!rider) return { ok: false, reason: 'UNAUTHENTICATED' }
      await releaseRiderDeliveries(tx, { storeId, partnerId, activity, facts, now: now(), actor: { actorKind: 'rider', actorId: riderId, actorLabel: null } }, riderId, 'deleted')
      await endRiderSessions(tx, storeId, riderId, now())
      await deleteRiderDevices(tx, storeId, riderId)
      await markRiderRemoved(tx, storeId, riderId, now())
      const keys = await deleteOwnUploads(tx, storeId, riderId)
      await activity.record(tx, entry(riderProfileAudit.accountDeleted, rider))
      return { ok: true, keys }
    })
    if (!done.ok) return done
    // After the commit, so a rolled-back deletion never loses a file; a failed delete leaves only an object no row names.
    if (files && done.keys.length > 0) {
      await files.delete(done.keys).catch((error: unknown) => logEvent({ event: 'rider_photos_delete_failed', api: 'delivery', storeId, code: error instanceof Error ? error.name : 'unknown' }))
    }
    return { ok: true, value: true }
  }

  return { me, update, uploadPhoto, deleteAccount }
}
