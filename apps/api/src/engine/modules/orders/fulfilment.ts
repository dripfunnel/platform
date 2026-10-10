import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { accountKindOf, bookingDeadlineMs, courierProviders, couriersFor, type BookedLabel, type CourierProvider, type PartnerCouriers } from '#core/couriers'
import { isUuid } from '#core/ids'
import { logEvent } from '#core/log'
import type { TenantContext } from '#core/tenancy'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { insertLabel, lockShipmentToCollect, selectBookingLines, selectBookingOrder, selectBookingPlace, setPickup } from '#db/scoped/labels'
import { queueOrderUpdate } from '#db/scoped/orderUpdates'
import type { AssetStore } from '#engine/modules/catalog/index'
import { checksumOf, courierFailureOf, fromAddressOf, parcelOf, toAddressOf } from './labels'
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
  type OrderToShipRow,
} from '#db/scoped/fulfilment'

// Shipping (PLATFORM-PROMPT §5.4; ACCESS §7.3; PortalOrders "Ship items"): each side ships what its part's mode gives it,
// every line and location the caller's own (ACCESS §7.3, the highest-risk write).

export type { FulfilmentRow } from '#db/scoped/fulfilment'

export const fulfilmentAudit = { shipped: 'order.shipped', sentToStore: 'order.sent_to_store', trackingAdded: 'order.tracking_added', pickupRequested: 'order.pickup_requested' } as const

export type FulfilmentRefusal =
  | 'INVALID_INPUT' | 'NOT_FOUND' | 'NOT_SHIPPABLE' | 'NOT_YOURS' | 'TOO_MANY' | 'NOT_ENOUGH_STOCK' | 'NO_STORE_LOCATION' | 'READ_ONLY'
  // Booking a label and its pickup (SAPI 12).
  | 'NOT_CONNECTED' | 'OWN_LABELS' | 'ONE_PART' | 'NO_ADDRESS' | 'UNSERVED' | 'COURIER_REJECTED' | 'COURIER_UNAVAILABLE' | 'NOT_BOOKED' | 'PICKUP_ASKED'
export type FulfilmentResult<T> = { ok: true; value: T } | { ok: false; reason: FulfilmentRefusal }

export interface ShipInput {
  orderId: string
  warehouseId: string
  lines: readonly { lineId: string; quantity: number }[]
  courierName: string | null
  trackingNumber: string | null
  trackingUrl: string | null
}

export interface BookInput {
  orderId: string
  warehouseId: string
  lines: readonly { lineId: string; quantity: number }[]
  courier: string
}

export interface FulfilmentDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
  /** The partner's couriers, for booking labels and pickups; null where none can be reached (#275). */
  couriers?: PartnerCouriers | null
  /** Where a label's file is kept (the Worker's `ASSETS` R2 binding). */
  files?: AssetStore | null
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

const isProvider = (value: string): value is CourierProvider => (courierProviders as readonly string[]).includes(value)
const linesValid = (lines: readonly { lineId: string; quantity: number }[], ids: readonly string[]) =>
  lines.length > 0 && lines.length <= maxLines && ids.every(isUuid) && new Set(ids).size === ids.length && lines.every((l) => Number.isInteger(l.quantity) && l.quantity >= 1 && l.quantity <= 999)

interface Plan {
  order: OrderToShipRow
  picked: { line: LineToShipRow; quantity: number }[]
  handOff: boolean
}

export const createFulfilmentService = ({ sql, context, actor, activity, facts, now, couriers = null, files = null }: FulfilmentDeps) => {
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

  /** The order, its lines and the location held to the caller's owner, and what it may send of them (ACCESS §7.3). */
  const plan = async (tx: ScopedSql, input: { orderId: string; warehouseId: string; lines: readonly { lineId: string; quantity: number }[] }, withCourier: boolean): Promise<FulfilmentResult<Plan>> => {
    const order = await lockOrderToShip(tx, storeId, input.orderId)
    const all = order ? await lockLinesToShip(tx, storeId, order.id) : []
    // A supplier hears of an order only through its own part (ACCESS §7.3): another's is "not found", never "not yours".
    if (!order || (sellerId && !all.some((l) => l.seller_id === sellerId))) return { ok: false, reason: 'NOT_FOUND' }
    const goneThrough = order.payment_state !== 'pending' || order.payment_method === 'cod' || order.payment_method === 'bank_transfer'
    // Refunded in full, there's nothing left to send for.
    if (order.state !== 'placed' || order.test || !goneThrough || order.payment_state === 'refunded') return { ok: false, reason: 'NOT_SHIPPABLE' }
    // A pickup is handed over at the store: it has no courier or tracking to give the shopper.
    if (order.shipping_option === 'pickup' && !sellerId && withCourier) return { ok: false, reason: 'INVALID_INPUT' }
    if (!(await ownsWarehouse(tx, storeId, sellerId, input.warehouseId))) return { ok: false, reason: 'NOT_YOURS' }

    // A supplier looks lines up among its own only, so another owner's line is as unknown as one that doesn't exist.
    const byId = new Map(all.filter((l) => !sellerId || l.seller_id === sellerId).map((l) => [l.id, l]))
    const picked: Plan['picked'] = []
    for (const l of input.lines) {
      const line = byId.get(l.lineId.toLowerCase())
      if (!line) return { ok: false, reason: 'NOT_FOUND' }
      picked.push({ line, quantity: l.quantity })
    }
    const handOff = sellerId !== null && picked.every((p) => p.line.shipping_mode === 'to-store')
    for (const { line, quantity } of picked) {
      // The merchant side ships its own lines and to-store lines handed over; a supplier its own, by its part's mode.
      const mine = sellerId ? line.seller_id === sellerId && (line.shipping_mode === 'to-store') === handOff : line.shipping_mode !== 'to-shopper'
      if (!mine) return { ok: false, reason: 'NOT_YOURS' }
      const left = handOff ? line.quantity - line.sent_quantity : line.shipping_mode === 'to-store' ? line.sent_quantity - line.fulfilled_quantity : line.quantity - line.fulfilled_quantity
      if (quantity > left) return { ok: false, reason: 'TOO_MANY' }
    }
    return { ok: true, value: { order, picked, handOff } }
  }

  /** The picked units leave the location; a to-store line the store ships on left its supplier's stock at the hand-off. */
  const takeStock = async (tx: ScopedSql, p: Plan, warehouseId: string) => {
    const shipped = await shipOut(tx, {
      storeId,
      warehouseId,
      orderId: p.order.id,
      actorId: actor.id,
      lines: p.picked.map(({ line, quantity }) => {
        const onward = !sellerId && line.shipping_mode === 'to-store'
        return { lineId: line.id, versionId: line.version_id, productId: line.product_id, sellerId: line.seller_id, quantity, heldAt: onward ? null : line.reserved_warehouse_id, takeStock: !onward && line.track_stock, fulfils: !p.handOff }
      }),
    })
    if (!shipped) throw new Refused('NOT_ENOUGH_STOCK')
  }

  const ship = async (input: ShipInput): Promise<FulfilmentResult<string[]>> => {
    if (readOnly) return { ok: false, reason: 'READ_ONLY' }
    const courierName = text(input.courierName, 80)
    const trackingNumber = text(input.trackingNumber, 80)
    const trackingUrl = trackingUrlOf(input.trackingUrl)
    const ids = input.lines.map((l) => l.lineId.toLowerCase())
    if (
      !isUuid(input.orderId) || !isUuid(input.warehouseId) || !linesValid(input.lines, ids)
      || courierName === undefined || trackingNumber === undefined || trackingUrl === undefined || (trackingUrl !== null && trackingNumber === null)
    ) {
      return { ok: false, reason: 'INVALID_INPUT' }
    }
    try {
      return await withSystemScope(sql, async (tx): Promise<FulfilmentResult<string[]>> => {
        const planned = await plan(tx, input, courierName !== null || trackingNumber !== null)
        if (!planned.ok) return planned
        const { order, picked, handOff } = planned.value
        if (handOff && !(await storeDefaultWarehouse(tx, storeId))) return { ok: false, reason: 'NO_STORE_LOCATION' }

        const shippedAt = now()
        await takeStock(tx, planned.value, input.warehouseId)
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
          // The shopper hears of what is on its way to them, never of a hand-off to the store or a pickup they collected.
          const id = made.at(-1)
          if (kind === 'manual' && id && !order.test) await queueOrderUpdate(tx, storeId, { event: 'shipped', orderId: order.id, fulfilmentId: id }, `shipped:${id}`)
        }
        await settleShippingStates(tx, order.id, shippedAt, sellerId === null)
        return { ok: true, value: made }
      })
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason }
      throw error
    }
  }

  /**
   * A label bought through the store's courier on its partner's account for one part's lines, to the shopper (FIRST-RELEASE
   * §6). The courier is asked inside the shipment's transaction, as refunds ask their provider: a refusal or no answer
   * writes nothing, and a second booking of the same units waits on the order's lock and finds them gone.
   */
  const bookLabel = async (input: BookInput): Promise<FulfilmentResult<string>> => {
    if (readOnly) return { ok: false, reason: 'READ_ONLY' }
    const ids = input.lines.map((l) => l.lineId.toLowerCase())
    if (!isUuid(input.orderId) || !isUuid(input.warehouseId) || !linesValid(input.lines, ids) || !isProvider(input.courier)) return { ok: false, reason: 'INVALID_INPUT' }
    const provider = input.courier
    let booked: BookedLabel | null = null
    try {
      return await withSystemScope(sql, async (tx): Promise<FulfilmentResult<string>> => {
        const planned = await plan(tx, input, true)
        if (!planned.ok) return planned
        const { order, picked, handOff } = planned.value
        // A hand-off to the store is entered by hand (FIRST-RELEASE §19, part 1).
        if (handOff) return { ok: false, reason: 'INVALID_INPUT' }
        const partId = picked[0]?.line.part_id
        if (!partId || picked.some((p) => p.line.part_id !== partId)) return { ok: false, reason: 'ONE_PART' }
        const place = await selectBookingPlace(tx, storeId, input.warehouseId, provider, sellerId)
        if (!place?.courier || !couriers || !files || !couriers.accounts.has(accountKindOf(provider)) || !couriersFor(place.store_country).includes(provider)) return { ok: false, reason: 'NOT_CONNECTED' }
        // A to-shopper supplier on its own courier account books outside DripFunnel, which holds only the partner's.
        if (sellerId && place.label_account !== 'store') return { ok: false, reason: 'OWN_LABELS' }
        const from = fromAddressOf(place, input.warehouseId)
        const orderRow = await selectBookingOrder(tx, order.id)
        const to = orderRow ? toAddressOf(orderRow) : null
        if (!from || !to || !orderRow) return { ok: false, reason: 'NO_ADDRESS' }

        await takeStock(tx, planned.value, input.warehouseId)
        const id = crypto.randomUUID()
        const { amount, ...parcel } = parcelOf(await selectBookingLines(tx, order.id), picked.map((p) => ({ lineId: p.line.id, quantity: p.quantity })))
        try {
          booked = await couriers.gateway.book(provider, { reference: id, from, to, ...parcel, value: { amount, currency: orderRow.currency }, labelSize: place.courier.label_size, pickup: place.courier.pickup_mode }, AbortSignal.timeout(bookingDeadlineMs))
        } catch (error) {
          const failure = courierFailureOf(error)
          if (failure) throw new Refused(failure)
          throw error
        }
        // Thrown, never returned: the stock taken above must go back.
        if (!booked) throw new Refused('UNSERVED')

        const shippedAt = now()
        await insertFulfilment(
          tx,
          { storeId, orderId: order.id, partId, sellerId, kind: 'booked', warehouseId: input.warehouseId, courierName: booked.courierName, trackingNumber: booked.trackingNumber, trackingUrl: booked.trackingUrl, shippedAt, createdBy: actor.id, booking: { id, provider, providerRef: booked.providerRef, pickup: booked.pickup } },
          picked.map((p) => ({ lineId: p.line.id, quantity: p.quantity })),
        )
        const key = `stores/${storeId}/assets/${crypto.randomUUID()}.${booked.label.mime === 'application/pdf' ? 'pdf' : 'png'}`
        await insertLabel(tx, { storeId, orderId: order.id, sellerId, fulfilmentId: id, key, mime: booked.label.mime, bytes: booked.label.bytes.byteLength, checksum: await checksumOf(booked.label.bytes), createdBy: actor.id })
        await record(tx, fulfilmentAudit.shipped, order, picked[0]?.line.seller_id ?? null, 'booked')
        await queueOrderUpdate(tx, storeId, { event: 'shipped', orderId: order.id, fulfilmentId: id }, `shipped:${id}`)
        await settleShippingStates(tx, order.id, shippedAt, sellerId === null)
        // Last, as asset uploads are: a failed write rolls the shipment back.
        await files.put(key, booked.label.bytes, { httpMetadata: { contentType: booked.label.mime } })
        return { ok: true, value: id }
      })
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason }
      // Bought at the courier but not kept here: its id, so support can cancel it there (LOGGING §9: an id, no person).
      const lost = booked as BookedLabel | null
      if (lost) logEvent({ event: 'label_not_kept', api: 'store', storeId, code: `${provider}:${lost.providerRef}` })
      throw error
    }
  }

  /** Asks the courier to collect a booked parcel, once, from where it left (PLATFORM-PROMPT §5.4 pickups on request). */
  const requestPickup = async (fulfilmentId: string): Promise<FulfilmentResult<true>> => {
    if (readOnly) return { ok: false, reason: 'READ_ONLY' }
    if (!isUuid(fulfilmentId)) return { ok: false, reason: 'INVALID_INPUT' }
    return withSystemScope(sql, async (tx): Promise<FulfilmentResult<true>> => {
      const found = await lockShipmentToCollect(tx, storeId, sellerId, fulfilmentId)
      if (!found) return { ok: false, reason: 'NOT_FOUND' }
      const provider = found.courier_provider
      if (found.kind !== 'booked' || !provider || !found.provider_ref) return { ok: false, reason: 'NOT_BOOKED' }
      if (found.pickup_requested_at) return { ok: false, reason: 'PICKUP_ASKED' }
      const place = await selectBookingPlace(tx, storeId, found.warehouse_id, provider, sellerId)
      // As for booking: a courier the store has switched off is asked for nothing, a pickup costing money at some.
      if (!place?.courier || !couriers || !couriers.accounts.has(accountKindOf(provider))) return { ok: false, reason: 'NOT_CONNECTED' }
      const from = fromAddressOf(place, found.warehouse_id)
      if (!from) return { ok: false, reason: 'NO_ADDRESS' }
      let pickup: { ref: string | null; date: string | null }
      try {
        pickup = await couriers.gateway.pickup(provider, { providerRef: found.provider_ref, from }, AbortSignal.timeout(bookingDeadlineMs))
      } catch (error) {
        const failure = courierFailureOf(error)
        if (failure) return { ok: false, reason: failure }
        throw error
      }
      await setPickup(tx, found.id, pickup, now())
      await record(tx, fulfilmentAudit.pickupRequested, { id: found.order_id, number: found.number }, sellerId, null)
      return { ok: true, value: true }
    })
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
      // A pickup has no tracking, and a booked label's is the courier's.
      if (found.kind === 'pickup' || found.kind === 'booked') return { ok: false, reason: 'NOT_SHIPPABLE' }
      await setTracking(tx, found.id, { courierName, trackingNumber, trackingUrl: trackingUrl ?? null })
      // Shipped without tracking, the shopper hears again once it comes; a correction says nothing more.
      if (found.tracking_number === null && found.kind === 'manual') await queueOrderUpdate(tx, storeId, { event: 'shipped', orderId: found.order_id, fulfilmentId: found.id }, `tracked:${found.id}`)
      await record(tx, fulfilmentAudit.trackingAdded, { id: found.order_id, number: found.number }, sellerId, null)
      return { ok: true, value: true }
    })
  }

  return { ship, bookLabel, requestPickup, addTracking }
}
