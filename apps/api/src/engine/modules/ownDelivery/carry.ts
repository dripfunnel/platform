import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { SecretBox } from '#auth/secretBox'
import { DispatchRefused } from '#core/dispatch'
import { isUuid } from '#core/ids'
import type { PageWindow } from '#core/paging'
import { pushPayloadSchema } from '#core/push'
import type { TenantContext } from '#core/tenancy'
import * as carry from '#db/scoped/carry'
import { lockDelivery, startRound, type DeliveryRow } from '#db/scoped/dispatch'
import { serialise, withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import { queueOrderUpdate } from '#db/scoped/orderUpdates'
import { insertOutbox } from '#db/scoped/outbox'
import { markPaidIn } from '#engine/modules/checkout/index'
import { createFulfilmentService } from '#engine/modules/orders/index'
import { dispatchAudit, queueRound, record, type Actor, type DispatchFacts } from './dispatch'
import { handoverCodeMatches, maxCodeAttempts } from './handoverCode'

export const carryAudit = {
  pickedUp: 'delivery.picked_up', delivered: 'delivery.delivered', failed: 'delivery.failed',
  codeRefused: 'delivery.code_refused', codeUnconfirmed: 'delivery.code_unconfirmed',
} as const
export const failReasons = ['no_one_home', 'refused', 'wrong_address', 'other'] as const
export const deliveryStates = ['packing', 'searching', 'unassigned', 'assigned', 'picked_up', 'delivered', 'failed', 'cancelled'] as const

// A step whose time is this far behind the server's was kept on a phone without signal (DELIVERY §3).
const lateMs = 2 * 60_000
const skewMs = 30_000

const step = { id: z.uuid(), at: z.iso.datetime(), key: z.string().min(1).max(100) }
const deliveredInput = z.strictObject({ ...step, code: z.string().regex(/^\d{4}$/), cashCollected: z.boolean().nullable() })
const failedInput = z.strictObject({ ...step, reason: z.enum(failReasons), note: z.string().trim().min(1).max(500).nullable() })
  .refine((i) => (i.reason === 'other') === (i.note !== null), 'a note goes with other, and only with other')
const merchantInput = z.strictObject({ id: z.uuid(), reason: z.string().trim().min(1).max(500), cashReceived: z.boolean().nullable() })

const addressSchema = z.object({
  name: z.string().optional(), line1: z.string().optional(), line2: z.string().nullish(), city: z.string().optional(), region: z.string().nullish(),
  postalCode: z.string().nullish(), country: z.string().optional(), phone: z.string().nullish(), latitude: z.number().nullish(), longitude: z.number().nullish(),
}).loose()

export interface CarriedCustomer {
  name: string | null; phone: string | null; note: string | null; latitude: number | null; longitude: number | null
  address: { line1: string | null; line2: string | null; city: string | null; region: string | null; postalCode: string | null; country: string | null }
}
export type RiderDeliveryView = carry.RiderDeliveryRow & { lines: { name: string; version_name: string | null; quantity: number }[]; customer: CarriedCustomer | null }

const customerOf = (row: Awaited<ReturnType<typeof carry.selectCarriedCustomer>>): CarriedCustomer | null => {
  if (!row) return null
  const a = addressSchema.safeParse(row.shipping_address ?? {})
  const at = a.success ? a.data : {}
  return {
    name: at.name ?? null, phone: at.phone ?? row.phone, note: row.shopper_note, latitude: at.latitude ?? null, longitude: at.longitude ?? null,
    address: { line1: at.line1 ?? null, line2: at.line2 ?? null, city: at.city ?? null, region: at.region ?? null, postalCode: at.postalCode ?? null, country: at.country ?? null },
  }
}

/** 1 Monday … 7 Sunday, from the store's language and region; Monday where the runtime can't tell. */
export const firstDayOfWeek = (locale: string): number => {
  try {
    const l = new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } }
    return l.getWeekInfo?.().firstDay ?? l.weekInfo?.firstDay ?? 1
  } catch {
    return 1
  }
}

// The customer hears through the outbox, ids only (DELIVERY §6); a guest's order is its own subject.
const tellCustomer = async (tx: ScopedSql, f: DispatchFacts, d: DeliveryRow, message: 'order.picked_up' | 'order.delivered' | 'order.not_delivered') => {
  const n = await carry.carryNotice(tx, d)
  if (!n || n.test) return n
  await insertOutbox(tx, { kind: 'push', partnerId: f.partnerId, storeId: f.storeId, idempotencyKey: `${message}:${d.id}`,
    payload: pushPayloadSchema.parse({ subject: n.customer_id ? { kind: 'customer', id: n.customer_id } : { kind: 'order', id: n.order_id }, message, orderId: n.order_id }) })
  return n
}

const deliver = async (tx: ScopedSql, f: DispatchFacts, d: DeliveryRow, s: { at: Date; cashAt: Date | null; key: string | null; reason: string | null; paidBy: { kind: 'person' | 'rider'; id: string } | null }) => {
  await carry.setDelivered(tx, d, s)
  await carry.setShipmentsDelivered(tx, d.store_id, d.order_id, s.at)
  const n = await tellCustomer(tx, f, d, 'order.delivered')
  // The order is paid only when the delivery is delivered, by the mark-paid path (DELIVERY §3, §8).
  if (s.paidBy && n?.payment_method === 'cod' && n.payment_state === 'pending') {
    const paid = await markPaidIn(tx, { storeId: f.storeId, actor: { ...s.paidBy, partnerId: f.partnerId }, activity: f.activity, facts: f.facts ?? { requestId: null, ip: null, userAgent: null }, now: () => f.now }, d.order_id)
    // Thrown, so the delivery is not left delivered with its cash unrecorded.
    if (!paid.ok) throw new DispatchRefused(paid.reason === 'NOT_FOUND' ? 'NOT_SHIPPABLE' : 'NOT_PENDING')
  }
  if (n && !n.test && d.fulfilment_id) await queueOrderUpdate(tx, f.storeId, { event: 'delivered', orderId: d.order_id, fulfilmentId: d.fulfilment_id }, `delivered:${d.fulfilment_id}`)
  await record(tx, f, carryAudit.delivered, d.id, s.reason)
}

type Answer = true | { refused: string }

export const createCarry = (deps: { sql: postgres.Sql; context: TenantContext; activity: ActivityLog; facts: RequestFacts; now: () => Date; secrets?: SecretBox | null }) => {
  const { sql, context, activity, facts, now } = deps
  const { storeId, caller } = context
  const riderId = caller.kind === 'rider' ? caller.riderId : null
  const actor: Actor = riderId ? { actorKind: 'rider', actorId: riderId, actorLabel: null } : { actorKind: 'person', actorId: caller.kind === 'person' || caller.kind === 'impersonation' ? caller.userId : null, actorLabel: null }
  const f = (): DispatchFacts => ({ storeId, partnerId: context.partnerId, activity, facts, now: now(), actor })

  // A refusal that changed something (an attempt counted) commits before it is answered.
  const answered = (result: Answer): true => {
    if (result === true) return true
    throw new DispatchRefused(result.refused)
  }
  const asRider = async (id: string, work: (tx: ScopedSql, f: DispatchFacts, d: DeliveryRow, rider: string) => Promise<Answer>) => {
    if (!riderId) throw new DispatchRefused('UNAUTHENTICATED')
    if (!isUuid(id)) throw new DispatchRefused('NOT_FOUND')
    return answered(await withSystemScope(sql, async (tx) => {
      await serialise(tx, `dispatch:${storeId}:${riderId}`)
      const d = await lockDelivery(tx, storeId, id)
      if (d?.rider_id !== riderId) throw new DispatchRefused('NOT_FOUND')
      return work(tx, f(), d, riderId)
    }))
  }
  const asMerchant = async (id: string, work: (tx: ScopedSql, f: DispatchFacts, d: DeliveryRow) => Promise<Answer>) => {
    if (riderId || context.sellerScope.kind === 'seller' || (caller.kind === 'support' && caller.access === 'read')) throw new DispatchRefused('FORBIDDEN')
    if (!isUuid(id)) throw new DispatchRefused('NOT_FOUND')
    // Written in system scope, as the rider's steps are: no request role writes the code (migration 0364).
    return answered(await withSystemScope(sql, async (tx) => {
      const d = await lockDelivery(tx, storeId, id)
      if (!d) throw new DispatchRefused('NOT_FOUND')
      return work(tx, f(), d)
    }))
  }
  const stepTime = (at: string, d: DeliveryRow, nowAt: Date): Date => {
    const time = new Date(at)
    if (!d.picked_up_at || time < d.picked_up_at || time.getTime() > nowAt.getTime() + skewMs) throw new DispatchRefused('INVALID_INPUT')
    return time
  }
  // A resend with the same key answers what the first did, and changes nothing (DELIVERY §4).
  const replay = (d: DeliveryRow, key: string): Answer | null => {
    if (d.step_key !== key) return null
    return d.step_result === 'delivered' || d.step_result === 'failed' ? true : { refused: d.step_result ?? 'INVALID_INPUT' }
  }

  return {
    delivery: (id: string): Promise<RiderDeliveryView | null> => {
      if (!riderId) return Promise.reject(new DispatchRefused('UNAUTHENTICATED'))
      if (!isUuid(id)) return Promise.resolve(null)
      return withScope(sql, context, async (tx) => {
        const d = await carry.selectRiderDelivery(tx, storeId, riderId, id)
        if (!d) return null
        const lines = d.state === 'assigned' || d.state === 'picked_up' ? await carry.selectCarriedLines(tx, storeId, d.order_id) : []
        const customer = d.state === 'picked_up' ? customerOf(await carry.selectCarriedCustomer(tx, storeId, d.order_id)) : null
        return { ...d, lines, customer }
      })
    },
    deliveries: async (states: readonly string[] | null, window: PageWindow) => {
      if (!riderId) throw new DispatchRefused('UNAUTHENTICATED')
      const at = now()
      const clock = await withSystemScope(sql, (tx) => carry.selectStoreClock(tx, storeId))
      return withScope(sql, context, async (tx) => ({
        rows: await carry.selectRiderDeliveries(tx, storeId, riderId, states, window),
        counts: await carry.selectDeliveredCounts(tx, storeId, riderId, { now: at, timeZone: clock?.time_zone ?? 'UTC', firstDay: firstDayOfWeek(clock?.main_language ?? 'en') }),
      }))
    },
    handBack: (id: string) => asRider(id, async (tx, f, d, rider) => {
      if (d.state !== 'assigned') throw new DispatchRefused('NOT_ASSIGNED')
      const next = await startRound(tx, d, f.now, rider)
      await carry.setHandoverCode(tx, d, null)
      await record(tx, f, dispatchAudit.handedBack, d.id, 'rider')
      await queueRound(tx, f, next)
      return true
    }),
    pickUp: (id: string) => asRider(id, async (tx, f, d, rider) => {
      if (d.state !== 'assigned') throw new DispatchRefused('NOT_ASSIGNED')
      // A retry after `failed` carries the parcel the first pickup already took out (DELIVERY §3).
      const earlier = await carry.localFulfilments(tx, storeId, d.order_id)
      let shipment = earlier[0] ?? null
      if (!shipment) {
        const fulfilment = createFulfilmentService({ sql, context, actor: { id: rider, partnerId: f.partnerId, kind: 'rider' }, activity, facts, now: () => f.now })
        const shipped = await fulfilment.shipLocal(tx, d.order_id, d.warehouse_id)
        // Thrown, so whatever the shipment began is rolled back with it.
        if (!shipped.ok) throw new DispatchRefused(shipped.reason)
        shipment = shipped.value[0] ?? null
      }
      await carry.setPickedUp(tx, d, shipment, f.now)
      await tellCustomer(tx, f, d, 'order.picked_up')
      await record(tx, f, carryAudit.pickedUp, d.id)
      return true
    }),
    delivered: async (raw: z.input<typeof deliveredInput>) => {
      const input = deliveredInput.safeParse(raw)
      if (!input.success) throw new DispatchRefused('INVALID_INPUT')
      const { code, cashCollected, key } = input.data
      return asRider(input.data.id, async (tx, f, d, rider) => {
        const again = replay(d, key)
        if (again) return again
        if (d.state !== 'picked_up') throw new DispatchRefused('NOT_PICKED_UP')
        if (d.code_unconfirmed_at) return { refused: 'CODE_UNCONFIRMED' }
        const at = stepTime(input.data.at, d, f.now)
        const cash = d.cash_due_amount !== null
        if (cash && cashCollected !== true) throw new DispatchRefused('CASH_NOT_CONFIRMED')
        const held = await carry.selectHandoverCode(tx, d)
        if (!held?.handover_code_enc || !deps.secrets) throw new DispatchRefused('UNAVAILABLE')
        if (held.code_attempts >= maxCodeAttempts) return { refused: 'CODE_LOCKED' }
        if (await handoverCodeMatches(deps.secrets, d.id, held.handover_code_enc, code)) {
          await deliver(tx, f, d, { at, cashAt: cash ? at : null, key, reason: null, paidBy: cash ? { kind: 'rider', id: rider } : null })
          return true
        }
        const attempts = await carry.countWrongCode(tx, d, key, maxCodeAttempts)
        if (f.now.getTime() - at.getTime() > lateMs) {
          // Checked on arrival as one try: the store confirms it now (DELIVERY §3, Delivered without signal).
          await carry.setUnconfirmed(tx, d, { now: f.now, cashAt: cash ? at : null, key })
          await insertOutbox(tx, { kind: 'email', partnerId: f.partnerId, storeId, idempotencyKey: `delivery-code-unconfirmed:${d.id}`, payload: { template: 'delivery-code-unconfirmed', deliveryId: d.id } })
          await record(tx, f, carryAudit.codeUnconfirmed, d.id)
          return { refused: 'CODE_UNCONFIRMED' }
        }
        await record(tx, f, carryAudit.codeRefused, d.id, String(attempts))
        return { refused: attempts >= maxCodeAttempts ? 'CODE_LOCKED' : 'WRONG_CODE' }
      })
    },
    failed: async (raw: z.input<typeof failedInput>) => {
      const input = failedInput.safeParse(raw)
      if (!input.success) throw new DispatchRefused('INVALID_INPUT')
      const { reason, note, key } = input.data
      return asRider(input.data.id, async (tx, f, d) => {
        const again = replay(d, key)
        if (again) return again
        if (d.state !== 'picked_up') throw new DispatchRefused('NOT_PICKED_UP')
        if (d.code_unconfirmed_at) return { refused: 'CODE_UNCONFIRMED' }
        const at = stepTime(input.data.at, d, f.now)
        await carry.setFailed(tx, d, { at, reason, note, key })
        const n = await tellCustomer(tx, f, d, 'order.not_delivered')
        if (n && !n.test) await insertOutbox(tx, { kind: 'email', partnerId: f.partnerId, storeId, idempotencyKey: `order-not-delivered:${d.id}`, payload: { template: 'order-not-delivered', orderId: d.order_id, deliveryId: d.id } })
        await record(tx, f, carryAudit.failed, d.id, reason)
        return true
      })
    },
    /** A locked or unconfirmed code: the merchant's word, with a reason; `paidBy` is the person when the caller holds `orders.mark_paid` (DELIVERY §8). */
    merchantDelivered: async (raw: z.input<typeof merchantInput>, paidBy: string | null) => {
      const input = merchantInput.safeParse(raw)
      if (!input.success) throw new DispatchRefused('INVALID_INPUT')
      const { reason, cashReceived } = input.data
      return asMerchant(input.data.id, async (tx, f, d) => {
        if (d.state !== 'picked_up') throw new DispatchRefused('NOT_PICKED_UP')
        const held = await carry.selectHandoverCode(tx, d)
        if (!d.code_unconfirmed_at && (held?.code_attempts ?? 0) < maxCodeAttempts) throw new DispatchRefused('CODE_NOT_LOCKED')
        const cash = d.cash_due_amount !== null
        if (cash && cashReceived === null) throw new DispatchRefused('CASH_NOT_CONFIRMED')
        if (cash && cashReceived && !paidBy) throw new DispatchRefused('FORBIDDEN')
        await deliver(tx, f, d, { at: f.now, cashAt: null, key: null, reason, paidBy: cash && cashReceived && paidBy ? { kind: 'person', id: paidBy } : null })
        return true
      })
    },
  }
}
