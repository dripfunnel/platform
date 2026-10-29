import { DispatchRefused } from '#core/dispatch'
import { releaseRiderDeliveries } from './dispatch'
import { eraseRiderData } from './riderData'
import { withSystemScope } from '#db/scoped/index'
import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { isUuid } from '#core/ids'
import { logEvent } from '#core/log'
import type { PageWindow } from '#core/paging'
import { isE164 } from '#core/sms'
import type { TenantContext } from '#core/tenancy'
import { insertCatalogExport, selectCatalogExport } from '#db/scoped/catalogExports'
import { serialise, withScope, type ScopedSql } from '#db/scoped/index'
import { exportDtoOf, type CatalogExportDto } from '#engine/modules/catalog/index'
import { jobPayloadOf, type CatalogJobPayload } from '#engine/modules/catalog/jobScope'
import {
  countCountedRiders,
  countRiderTextsSince,
  endRiderSessions,
  insertRider,
  lockRider,
  markRiderRemoved,
  formerRiderName,
  riderPhoneTaken,
  selectRiderForExport,
  selectRiders,
  setRiderStatus,
  type RiderRow,
} from '#db/scoped/riders'
import { deleteRiderDevices } from '#db/scoped/pushDevices'
import { selectStoreSlug } from '#db/scoped/storefrontSettings'

// Settings › Riders (DELIVERY §5, §8; SetRiders): the store's own delivery people, the Owner's (`riders.manage`). The
// plan is own_delivery and riders (DELIVERY §9); the text goes out through the caller's port, as saas/sms is above us.

export const ridersAudit = {
  invited: 'rider.invited',
  invitationResent: 'rider.invitation_resent',
  suspended: 'rider.suspended',
  restored: 'rider.restored',
  removed: 'rider.removed',
  exported: 'rider.data_exported',
  erased: 'rider.erased',
} as const

/** Invitation texts a rider can get in 24 hours, the first one included (#838). */
export const textsPerDay = 3

/** The store's delivery app APK, served by `apis/delivery/apk.ts` (DELIVERY §5). */
export const deliveryAppLink = (slug: string, shopDomain: string): string => `https://${slug}.${shopDomain}/app/delivery.apk`

export type RidersRefusal =
  | { reason: 'FORBIDDEN' | 'RIDER_HAS_PARCEL' | 'NOT_FOUND' | 'INVALID_INPUT' | 'INVALID_PHONE' | 'PHONE_TAKEN' | 'NOT_INVITED' | 'NOT_ACTIVE' | 'NOT_SUSPENDED' | 'RATE_LIMITED' | 'UNAVAILABLE' }
  | { reason: 'PLAN_LIMIT'; key: 'own_delivery' | 'riders'; wanted: number | null }
export type RidersResult<T> = { ok: true; value: T } | ({ ok: false } & RidersRefusal)

class Refused extends Error {
  constructor(readonly refusal: RidersRefusal) {
    super(refusal.reason)
  }
}

export interface RidersPlan {
  /** Whether the store's plan switches own delivery on (saas/entitlements). */
  ownDelivery: () => Promise<boolean>
  /** The riders limit, read before the locked count. */
  allowance: () => Promise<number>
}

/** Queues the invitation text in the transaction that decided it. */
export type SendInvitation = (tx: ScopedSql, invitation: { riderId: string; phone: string; link: string }) => Promise<void>

export interface RidersDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; label: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  plan: RidersPlan
  /** The store's free addresses' domain (SHOP_DOMAIN); without it there is no app to link to. */
  shopDomain: string | null
  send: SendInvitation
  /** Queues the export job's outbox row in the same transaction. */
  queueExport: (tx: ScopedSql, payload: CatalogJobPayload) => Promise<unknown>
  /** The assets bucket, where an erased rider's photos are deleted from once the erasure has committed; null where it isn't bound. */
  deleteFiles: ((keys: string[]) => Promise<unknown>) | null
  now: () => Date
}

const inviteInput = z.strictObject({ name: z.string().trim().min(1).max(120), phone: z.string().trim() })
const eraseReason = z.string().trim().min(1).max(500)

export const createRiders = ({ sql, context, actor, activity, facts, plan, shopDomain, send, queueExport, deleteFiles, now }: RidersDeps) => {
  const { storeId } = context

  const entry = (action: string, rider: { id: string; name: string }): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    target: { type: 'rider', id: rider.id, label: rider.name },
    reason: null,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const answered = async <T>(open: () => Promise<T>): Promise<RidersResult<T>> => {
    try {
      return { ok: true, value: await open() }
    } catch (error) {
      if (error instanceof Refused) return { ok: false, ...error.refusal }
      if (error instanceof DispatchRefused && error.code === 'RIDER_HAS_PARCEL') return { ok: false, reason: 'RIDER_HAS_PARCEL' }
      throw error
    }
  }
  const run = <T>(work: (tx: ScopedSql) => Promise<T>) => answered(() => withScope(sql, context, work))
  /** Suspending and removing hand deliveries back and delete a position, which no request role may (DATA-MODEL §3.6). */
  const runAsSystem = <T>(work: (tx: ScopedSql) => Promise<T>): Promise<RidersResult<T>> =>
    context.sellerScope.kind === 'seller' || (context.caller.kind === 'support' && context.caller.access === 'read')
      ? Promise.resolve({ ok: false, reason: 'FORBIDDEN' })
      : answered(() => withSystemScope(sql, work))

  const locked = async (tx: ScopedSql, id: string): Promise<RiderRow> => {
    await serialise(tx, `dispatch:${storeId}:${id}`)
    const rider = isUuid(id) ? await lockRider(tx, storeId, id) : null
    if (!rider) throw new Refused({ reason: 'NOT_FOUND' })
    return rider
  }

  const appLink = async (tx: ScopedSql): Promise<string> => {
    const slug = await selectStoreSlug(tx, storeId)
    if (!slug || !shopDomain) throw new Refused({ reason: 'UNAVAILABLE' })
    return deliveryAppLink(slug, shopDomain)
  }

  const list = (window: PageWindow): Promise<RiderRow[]> => withScope(sql, context, (tx) => selectRiders(tx, storeId, window))

  /** Counted under the store's lock, so two invites can't both take the last place (AGENTS.md "Reliability"). */
  const invite = async (raw: { name: string; phone: string }): Promise<RidersResult<RiderRow>> => {
    const parsed = inviteInput.safeParse(raw)
    if (!parsed.success) return { ok: false, reason: 'INVALID_INPUT' }
    const { name, phone } = parsed.data
    if (!isE164(phone)) return { ok: false, reason: 'INVALID_PHONE' }
    if (!(await plan.ownDelivery())) return { ok: false, reason: 'PLAN_LIMIT', key: 'own_delivery', wanted: null }
    const allowance = await plan.allowance()
    return run(async (tx) => {
      await serialise(tx, `riders:${storeId}`)
      if (await riderPhoneTaken(tx, storeId, phone)) throw new Refused({ reason: 'PHONE_TAKEN' })
      const wanted = (await countCountedRiders(tx, storeId)) + 1
      if (wanted > allowance) throw new Refused({ reason: 'PLAN_LIMIT', key: 'riders', wanted })
      const link = await appLink(tx)
      const rider = await insertRider(tx, { storeId, name, phone, invitedBy: actor.id })
      await send(tx, { riderId: rider.id, phone, link })
      await activity.record(tx, entry(ridersAudit.invited, rider))
      return rider
    })
  }

  const resend = (id: string): Promise<RidersResult<true>> =>
    run(async (tx) => {
      const rider = await locked(tx, id)
      if (rider.status !== 'invited' || !rider.phone) throw new Refused({ reason: 'NOT_INVITED' })
      if (!(await plan.ownDelivery())) throw new Refused({ reason: 'PLAN_LIMIT', key: 'own_delivery', wanted: null })
      if ((await countRiderTextsSince(tx, storeId, rider.id, new Date(now().getTime() - 86_400_000))) >= textsPerDay) throw new Refused({ reason: 'RATE_LIMITED' })
      await send(tx, { riderId: rider.id, phone: rider.phone, link: await appLink(tx) })
      await activity.record(tx, entry(ridersAudit.invitationResent, rider))
      return true as const
    })

  /** Signs them out everywhere at once (DELIVERY §5). */
  const suspend = (id: string): Promise<RidersResult<RiderRow>> =>
    runAsSystem(async (tx) => {
      const rider = await locked(tx, id)
      if (rider.status !== 'active') throw new Refused({ reason: 'NOT_ACTIVE' })
      await releaseRiderDeliveries(tx, { storeId, partnerId: actor.partnerId, activity, facts, now: now(), actor: { actorKind: 'person', actorId: actor.id, actorLabel: null } }, rider.id, 'unavailable')
      await endRiderSessions(tx, storeId, rider.id, now())
      await deleteRiderDevices(tx, storeId, rider.id)
      const changed = await setRiderStatus(tx, storeId, rider.id, 'suspended', now())
      await activity.record(tx, entry(ridersAudit.suspended, rider))
      return changed
    })

  const restore = (id: string): Promise<RidersResult<RiderRow>> =>
    run(async (tx) => {
      const rider = await locked(tx, id)
      if (rider.status !== 'suspended') throw new Refused({ reason: 'NOT_SUSPENDED' })
      const changed = await setRiderStatus(tx, storeId, rider.id, 'active', now())
      await activity.record(tx, entry(ridersAudit.restored, rider))
      return changed
    })

  /** An invited rider's invitation is cancelled the same way: the number goes, the name stays (DELIVERY §5). */
  const remove = (id: string): Promise<RidersResult<true>> =>
    runAsSystem(async (tx) => {
      const rider = await locked(tx, id)
      await releaseRiderDeliveries(tx, { storeId, partnerId: actor.partnerId, activity, facts, now: now(), actor: { actorKind: 'person', actorId: actor.id, actorLabel: null } }, rider.id, 'removed')
      await endRiderSessions(tx, storeId, rider.id, now())
      await deleteRiderDevices(tx, storeId, rider.id)
      await markRiderRemoved(tx, storeId, rider.id, now())
      await activity.record(tx, entry(ridersAudit.removed, rider))
      return true as const
    })

  /** The Owner's file of one rider's data, built after commit in their own scope; read back by its id (DELIVERY §5). */
  const exportData = (id: string): Promise<RidersResult<string>> =>
    run(async (tx) => {
      const profile = isUuid(id) ? await selectRiderForExport(tx, storeId, id) : null
      if (!profile) throw new Refused({ reason: 'NOT_FOUND' })
      const jobId = await insertCatalogExport(tx, { storeId, sellerId: null, kind: 'rider', filter: { riderId: id }, byId: actor.id, byLabel: actor.label })
      const payload = jobPayloadOf(context, jobId)
      if (!payload) throw new Refused({ reason: 'FORBIDDEN' })
      await queueExport(tx, payload)
      await activity.record(tx, entry(ridersAudit.exported, { id, name: profile.name }))
      return jobId
    })

  /** The export's state and its file until it expires; null for an id the caller didn't ask for. */
  const exportJob = (id: string): Promise<CatalogExportDto | null> =>
    isUuid(id)
      ? withScope(sql, context, async (tx) => {
          const job = await selectCatalogExport(tx, storeId, id)
          return job?.kind === 'rider' && job.requested_by_id === actor.id ? exportDtoOf(job, now()) : null
        })
      : Promise.resolve(null)

  /** Removal, then the rider is gone from everything that names or reaches them (riderData.ts); the reason is kept in the log. */
  const erase = async (id: string, reason: string): Promise<RidersResult<true>> => {
    const done = await runAsSystem(async (tx) => {
      const why = eraseReason.safeParse(reason)
      if (!why.success) throw new Refused({ reason: 'INVALID_INPUT' })
      if (!isUuid(id)) throw new Refused({ reason: 'NOT_FOUND' })
      await serialise(tx, `dispatch:${storeId}:${id}`)
      const erased = await eraseRiderData(tx, { storeId, partnerId: actor.partnerId, activity, facts, now: now(), actor: { actorKind: 'person', actorId: actor.id, actorLabel: null } }, id, 'erased')
      if (!erased) throw new Refused({ reason: 'NOT_FOUND' })
      await activity.record(tx, { ...entry(ridersAudit.erased, { id, name: formerRiderName }), reason: why.data })
      return erased.keys
    })
    if (!done.ok) return done
    // After the commit, so a rolled-back erasure never loses a file; a failed delete leaves only an object no row names.
    if (deleteFiles && done.value.length > 0) {
      await deleteFiles(done.value).catch((error: unknown) => logEvent({ event: 'rider_photos_delete_failed', api: 'store', storeId, code: error instanceof Error ? error.name : 'unknown' }))
    }
    return { ok: true, value: true }
  }

  return { list, invite, resend, suspend, restore, remove, exportData, exportJob, erase }
}
