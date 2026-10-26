import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import { deleteOwnDevice, upsertRiderDevice } from '#db/scoped/pushDevices'
import { selectOwnRider } from '#db/scoped/riders'

// A rider's phones for push (DELIVERY §4, §6). Registering runs in system scope, since a token another subject of the
// store holds moves to this rider; only an added or moved phone is logged and confirmed (decided on #840).

export const pushDeviceAudit = { registered: 'rider.push_device_registered', removed: 'rider.push_device_removed' } as const

export const pushPlatforms = ['ios', 'android'] as const

const expoToken = z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$/)
const registerInput = z.strictObject({ token: expoToken, platform: z.enum(pushPlatforms) })

/** Queues the confirmation push in register's transaction; saas/push is above us, so the caller passes it in. */
export type ConfirmDevice = (tx: ScopedSql, rider: { partnerId: string; storeId: string; riderId: string; key: string }) => Promise<void>

export type DevicesResult = { ok: true; value: true } | { ok: false; reason: 'UNAUTHENTICATED' | 'INVALID_INPUT' }

export interface RiderDevicesDeps {
  sql: postgres.Sql
  context: TenantContext & { caller: { kind: 'rider'; riderId: string } }
  activity: ActivityLog
  facts: RequestFacts
  confirm: ConfirmDevice
  now: () => Date
}

export const createRiderDevices = ({ sql, context, activity, facts, confirm, now }: RiderDevicesDeps) => {
  const { storeId, partnerId } = context
  const { riderId } = context.caller

  // Never the token: it reaches the phone (LOGGING §4.1). The platform only, for a register.
  const entry = (action: string, rider: { id: string; name: string }, platform?: string): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'rider',
    actorId: rider.id,
    actorLabel: rider.name,
    partnerId,
    storeId,
    target: { type: 'rider', id: rider.id, label: rider.name },
    ...(platform ? { changes: [{ field: 'platform', before: null, after: platform }] } : {}),
    reason: null,
    api: 'delivery',
    visibility: 'store',
    ...facts,
  })

  const register = async (raw: { token: string; platform: string }): Promise<DevicesResult> => {
    const parsed = registerInput.safeParse(raw)
    if (!parsed.success) return { ok: false, reason: 'INVALID_INPUT' }
    const { token, platform } = parsed.data
    return withSystemScope(sql, async (tx): Promise<DevicesResult> => {
      const rider = await selectOwnRider(tx, storeId, riderId)
      if (!rider) return { ok: false, reason: 'UNAUTHENTICATED' }
      const change = await upsertRiderDevice(tx, { storeId, riderId, token, platform, now: now() })
      if (change === 'refreshed') return { ok: true, value: true }
      await activity.record(tx, entry(pushDeviceAudit.registered, rider, platform))
      await confirm(tx, { partnerId, storeId, riderId, key: `${riderId}:${crypto.randomUUID()}` })
      return { ok: true, value: true }
    })
  }

  /** True whether or not the phone was this rider's, so the answer says nothing of another's token. */
  const unregister = async (token: string): Promise<DevicesResult> => {
    if (!expoToken.safeParse(token).success) return { ok: false, reason: 'INVALID_INPUT' }
    return withScope(sql, context, async (tx): Promise<DevicesResult> => {
      const rider = await selectOwnRider(tx, storeId, riderId)
      if (!rider) return { ok: false, reason: 'UNAUTHENTICATED' }
      if (await deleteOwnDevice(tx, storeId, riderId, token)) await activity.record(tx, entry(pushDeviceAudit.removed, rider))
      return { ok: true, value: true }
    })
  }

  return { register, unregister }
}
