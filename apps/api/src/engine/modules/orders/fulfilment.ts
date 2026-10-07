import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { isUuid } from '#core/ids'
import type { TenantContext } from '#core/tenancy'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import {
  insertFulfilment,
  lockFulfilmentForTracking,
  lockLinesToShip,
  lockOrderToShip,
  ownsWarehouse,
  setTracking,
  settleShippingStates,
  shipOut,
  storeDefaultWarehouse,
  type LineToShipRow,
} from '#db/scoped/fulfilment'

// Shipping (PLATFORM-PROMPT §5.4; ACCESS §7.3; PortalOrders "Ship items"): each side ships what its part's mode gives it,
// every line and location the caller's own (ACCESS §7.3, the highest-risk write).

export type { FulfilmentRow } from '#db/scoped/fulfilment'

export const fulfilmentAudit = { shipped: 'order.shipped', sentToStore: 'order.sent_to_store', trackingAdded: 'order.tracking_added' } as const

export type FulfilmentRefusal = 'INVALID_INPUT' | 'NOT_FOUND' | 'NOT_SHIPPABLE' | 'NOT_YOURS' | 'TOO_MANY' | 'NOT_ENOUGH_STOCK' | 'NO_STORE_LOCATION' | 'READ_ONLY'
export type FulfilmentResult<T> = { ok: true; value: T } | { ok: false; reason: FulfilmentRefusal }

export interface ShipInput {
  orderId: string
  warehouseId: string
  lines: readonly { lineId: string; quantity: number }[]
  courierName: string | null
  trackingNumber: string | null
  trackingUrl: string | null
}

export interface FulfilmentDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

class Refused extends Error {
  constructor(readonly reason: FulfilmentRefusal) {
    super(reason)
  }
}

const maxLines = 100
const text = (value: string | null, max: number) => {
  const trimmed = value?.trim() ?? ''
  return trimmed.length === 0 ? null : trimmed.length > max ? undefined : trimmed
}
const trackingUrlOf = (value: string | null): string | null | undefined => {
  const url = text(value, 500)
  if (url === null || url === undefined) return url
  try {
    return new URL(url).protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

export const createFulfilmentService = ({ sql, context, actor, activity, facts, now }: FulfilmentDeps) => {
  const { storeId } = context
  const sellerId = context.sellerScope.kind === 'seller' ? context.sellerScope.sellerId : null
  // Written in system scope, which passes no row policy, so read-only support is refused here (ACCESS §8).
  const readOnly = context.caller.kind === 'support' && context.caller.access === 'read'

  // The store's full entry, and for a supplier's part the thin one it may read: no free text, no shopper (LOGGING §3).
  const record = async (tx: ScopedSql, action: string, order: { id: string; number: string }, partOwner: string | null, reason: string | null) => {
    const base: ActivityEntry = {
      category: 'write',
      action,
      result: 'success',
      actorKind: 'person',
      actorId: actor.id,
      actorLabel: null,
      partnerId: actor.partnerId,
      storeId,
      target: { type: 'order', id: order.id, label: order.number },
      reason,
      api: 'store',
      visibility: 'store',
      ...facts,
    }
    await activity.recordAll(tx, partOwner ? [base, { ...base, sellerId: partOwner, reason: null }] : [base])
  }

  const ship = async (input: ShipInput): Promise<FulfilmentResult<string[]>> => {
    if (readOnly) return { ok: false, reason: 'READ_ONLY' }
    const courierName = text(input.courierName, 80)
    const trackingNumber = text(input.trackingNumber, 80)
    const trackingUrl = trackingUrlOf(input.trackingUrl)
    const ids = input.lines.map((l) => l.lineId.toLowerCase())
    if (
      !isUuid(input.orderId) || !isUuid(input.warehouseId) || input.lines.length === 0 || input.lines.length > maxLines || !ids.every(isUuid) || new Set(ids).size !== ids.length
      || input.lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 999)
      || courierName === undefined || trackingNumber === undefined || trackingUrl === undefined || (trackingUrl !== null && trackingNumber === null)
    ) {
      return { ok: false, reason: 'INVALID_INPUT' }
    }
    try {
      return await withSystemScope(sql, async (tx): Promise<FulfilmentResult<string[]>> => {
        const order = await lockOrderToShip(tx, storeId, input.orderId)
        const all = order ? await lockLinesToShip(tx, storeId, order.id) : []
        // A supplier hears of an order only through its own part (ACCESS §7.3): another's is "not found", never "not yours".
        if (!order || (sellerId && !all.some((l) => l.seller_id === sellerId))) return { ok: false, reason: 'NOT_FOUND' }
        const goneThrough = order.payment_state !== 'pending' || order.payment_method === 'cod' || order.payment_method === 'bank_transfer'
        if (order.state !== 'placed' || order.test || !goneThrough) return { ok: false, reason: 'NOT_SHIPPABLE' }
        if (!(await ownsWarehouse(tx, storeId, sellerId, input.warehouseId))) return { ok: false, reason: 'NOT_YOURS' }

        // A supplier looks lines up among its own only, so another owner's line is as unknown as one that doesn't exist.
        const byId = new Map(all.filter((l) => !sellerId || l.seller_id === sellerId).map((l) => [l.id, l]))
        const picked: { line: LineToShipRow; quantity: number }[] = []
        for (const [i, id] of ids.entries()) {
          const line = byId.get(id)
          if (!line) return { ok: false, reason: 'NOT_FOUND' }
          picked.push({ line, quantity: input.lines[i]?.quantity ?? 0 })
        }
        const handOff = sellerId !== null && picked.every((p) => p.line.shipping_mode === 'to-store')
        for (const { line, quantity } of picked) {
          // The merchant side ships its own lines and to-store lines handed over; a supplier its own, by its part's mode.
          const mine = sellerId ? line.seller_id === sellerId && (line.shipping_mode === 'to-store') === handOff : line.shipping_mode !== 'to-shopper'
          if (!mine) return { ok: false, reason: 'NOT_YOURS' }
          const left = handOff ? line.quantity - line.sent_quantity : line.shipping_mode === 'to-store' ? line.sent_quantity - line.fulfilled_quantity : line.quantity - line.fulfilled_quantity
          if (quantity > left) return { ok: false, reason: 'TOO_MANY' }
        }
        if (handOff && !(await storeDefaultWarehouse(tx, storeId))) return { ok: false, reason: 'NO_STORE_LOCATION' }

        const shippedAt = now()
        // A to-store line the store ships on left its supplier's stock at the hand-off.
        const shipped = await shipOut(tx, {
          storeId,
          warehouseId: input.warehouseId,
          orderId: order.id,
          actorId: actor.id,
          lines: picked.map(({ line, quantity }) => {
            const onward = !sellerId && line.shipping_mode === 'to-store'
            return { lineId: line.id, versionId: line.version_id, productId: line.product_id, sellerId: line.seller_id, quantity, heldAt: onward ? null : line.reserved_warehouse_id, takeStock: !onward && line.track_stock, fulfils: !handOff }
          }),
        })
        if (!shipped) throw new Refused('NOT_ENOUGH_STOCK')
        const made: string[] = []
        for (const partId of new Set(picked.map((p) => p.line.part_id))) {
          const lines = picked.filter((p) => p.line.part_id === partId)
          const kind = handOff ? 'sent_to_store' : order.shipping_option === 'pickup' && !sellerId ? 'pickup' : 'manual'
          made.push(
            await insertFulfilment(
              tx,
              { storeId, orderId: order.id, partId, sellerId, kind, warehouseId: input.warehouseId, courierName, trackingNumber, trackingUrl: trackingUrl ?? null, shippedAt, createdBy: actor.id },
              lines.map((p) => ({ lineId: p.line.id, quantity: p.quantity })),
            ),
          )
          await record(tx, handOff ? fulfilmentAudit.sentToStore : fulfilmentAudit.shipped, order, lines[0]?.line.seller_id ?? null, kind)
        }
        await settleShippingStates(tx, order.id, shippedAt, sellerId === null)
        return { ok: true, value: made }
      })
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason }
      throw error
    }
  }

  // A shipment's tracking, added or corrected by whoever sent it; a pickup has none.
  const addTracking = async (fulfilmentId: string, input: { courierName: string | null; trackingNumber: string; trackingUrl: string | null }): Promise<FulfilmentResult<true>> => {
    if (readOnly) return { ok: false, reason: 'READ_ONLY' }
    const courierName = text(input.courierName, 80)
    const trackingNumber = text(input.trackingNumber, 80)
    const trackingUrl = trackingUrlOf(input.trackingUrl)
    if (!isUuid(fulfilmentId) || courierName === undefined || !trackingNumber || trackingUrl === undefined) return { ok: false, reason: 'INVALID_INPUT' }
    return withSystemScope(sql, async (tx): Promise<FulfilmentResult<true>> => {
      const found = await lockFulfilmentForTracking(tx, storeId, sellerId, fulfilmentId)
      if (!found) return { ok: false, reason: 'NOT_FOUND' }
      if (found.kind === 'pickup') return { ok: false, reason: 'NOT_SHIPPABLE' }
      await setTracking(tx, found.id, { courierName, trackingNumber, trackingUrl: trackingUrl ?? null })
      await record(tx, fulfilmentAudit.trackingAdded, { id: found.order_id, number: found.number }, sellerId, null)
      return { ok: true, value: true }
    })
  }

  return { ship, addTracking }
}
