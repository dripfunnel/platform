import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { isUuid } from '#core/ids'
import type { TenantContext } from '#core/tenancy'
import { selectOwnPlacedOrder } from '#db/scoped/deliveryTracking'
import { withScope, withSystemScope } from '#db/scoped/index'
import { deleteShopperDevice, upsertShopperDevice } from '#db/scoped/pushDevices'
import { pushPlatforms } from './devices'

// A customer's phones, or a guest order's, for the pushes about an own delivery (DELIVERY §6). A signed-in customer's phone is
// theirs for every order; a guest names the order and must hold its token, which the order's own shop policy checks. Registering
// runs in system scope, since a token another subject of the store holds moves here; only an added or moved phone is logged.

export const shopDeviceAudit = { registered: 'customer.push_device_registered', removed: 'customer.push_device_removed' } as const

const expoToken = z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$/)
const registerInput = z.strictObject({ token: expoToken, platform: z.enum(pushPlatforms), orderId: z.string().optional() })
const unregisterInput = z.strictObject({ token: expoToken, orderId: z.string().optional() })

export type ShopDevicesResult = { ok: true; value: true } | { ok: false; reason: 'SIGNED_OUT' | 'INVALID_INPUT' | 'NOT_FOUND' }

export interface ShopDevicesDeps {
  sql: postgres.Sql
  context: TenantContext
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

export const createShopDevices = ({ sql, context, activity, facts, now }: ShopDevicesDeps) => {
  const { storeId, partnerId } = context
  const customerId = context.caller.kind === 'shopper' ? context.caller.customerId : null

  // Never the token: it reaches the phone (LOGGING §4.1). The platform only, for a register.
  const entry = (action: string, subject: { kind: 'customer' | 'order'; id: string }, platform?: string): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: customerId ? 'customer' : 'anonymous',
    actorId: customerId,
    actorLabel: null,
    partnerId,
    storeId,
    customerId,
    target: { type: subject.kind, id: subject.id, label: subject.kind === 'order' ? 'Guest order' : 'Customer' },
    ...(platform ? { changes: [{ field: 'platform', before: null, after: platform }] } : {}),
    reason: null,
    api: 'shop',
    visibility: 'store',
    ...facts,
  })

  /** Whose phone this is: the signed-in customer, or the guest order they can read. */
  const subjectOf = async (orderId: string | undefined): Promise<{ ok: true; subject: { kind: 'customer' | 'order'; id: string } } | { ok: false; reason: 'SIGNED_OUT' | 'INVALID_INPUT' | 'NOT_FOUND' }> => {
    if (customerId) return { ok: true, subject: { kind: 'customer', id: customerId } }
    if (context.caller.kind !== 'shopper' || !context.caller.orderTokenHash) return { ok: false, reason: 'SIGNED_OUT' }
    if (!orderId || !isUuid(orderId)) return { ok: false, reason: 'INVALID_INPUT' }
    const own = await withScope(sql, context, (tx) => selectOwnPlacedOrder(tx, storeId, orderId))
    return own ? { ok: true, subject: { kind: 'order', id: orderId } } : { ok: false, reason: 'NOT_FOUND' }
  }

  const register = async (raw: { token: string; platform: string; orderId?: string | null | undefined }): Promise<ShopDevicesResult> => {
    const parsed = registerInput.safeParse({ ...raw, orderId: raw.orderId ?? undefined })
    if (!parsed.success) return { ok: false, reason: 'INVALID_INPUT' }
    const who = await subjectOf(parsed.data.orderId)
    if (!who.ok) return who
    const { token, platform } = parsed.data
    return withSystemScope(sql, async (tx): Promise<ShopDevicesResult> => {
      const change = await upsertShopperDevice(tx, { storeId, kind: who.subject.kind, subjectId: who.subject.id, token, platform, now: now() })
      if (change !== 'refreshed') await activity.record(tx, entry(shopDeviceAudit.registered, who.subject, platform))
      return { ok: true, value: true }
    })
  }

  /** True whether or not the phone was theirs, so the answer says nothing of another's token. */
  const unregister = async (raw: { token: string; orderId?: string | null | undefined }): Promise<ShopDevicesResult> => {
    const parsed = unregisterInput.safeParse({ ...raw, orderId: raw.orderId ?? undefined })
    if (!parsed.success) return { ok: false, reason: 'INVALID_INPUT' }
    const who = await subjectOf(parsed.data.orderId)
    if (!who.ok) return who
    return withSystemScope(sql, async (tx): Promise<ShopDevicesResult> => {
      if (await deleteShopperDevice(tx, storeId, who.subject.kind, who.subject.id, parsed.data.token)) await activity.record(tx, entry(shopDeviceAudit.removed, who.subject))
      return { ok: true, value: true }
    })
  }

  return { register, unregister }
}
