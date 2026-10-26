import { pushPayloadSchema } from '#core/push'
import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { DispatchRefused } from '#core/dispatch'
import { isUuid } from '#core/ids'
import type { PageWindow } from '#core/paging'
import type { TenantContext } from '#core/tenancy'
import { selectStoreEntitlement } from '#db/scoped/entitlements'
import { serialise, withSystemScope, type ScopedSql } from '#db/scoped/index'
import { insertOutbox, insertOutboxMany } from '#db/scoped/outbox'
import * as queries from '#db/scoped/dispatch'

export const dispatchAudit = {
  created: 'delivery.created', ready: 'delivery.ready', offered: 'delivery.offered', accepted: 'delivery.accepted',
  assigned: 'delivery.assigned', cancelled: 'delivery.cancelled', declined: 'delivery.declined',
  unassigned: 'delivery.unassigned', handedBack: 'delivery.handed_back', online: 'rider.went_online', offline: 'rider.went_offline',
} as const
export const offerKind = 'delivery.offer'
type Actor = Pick<ActivityEntry, 'actorKind' | 'actorId' | 'actorLabel'>
export interface DispatchFacts { storeId: string; partnerId: string; activity: ActivityLog; now: Date; actor?: Actor; facts?: RequestFacts; api?: ActivityEntry['api']; offeredRecorded?: boolean }
const record = (tx: ScopedSql, f: DispatchFacts, action: string, id: string, reason: string | null = null) => f.activity.record(tx, {
  category: f.actor ? 'write' : 'system', action, result: 'success',
  ...(f.actor ?? { actorKind: 'job', actorId: null, actorLabel: null }), storeId: f.storeId, partnerId: f.partnerId,
  target: { type: action.startsWith('rider.') ? 'rider' : 'delivery', id, label: id }, reason,
  api: f.api ?? (f.actor?.actorKind === 'rider' ? 'delivery' : f.actor ? 'store' : 'system'), visibility: 'store',
  ...(f.facts ?? { requestId: null, ip: null, userAgent: null }),
})

const push = (tx: ScopedSql, f: DispatchFacts, riderId: string, message: string, deliveryId: string, key: string) =>
  insertOutbox(tx, { kind: 'push', partnerId: f.partnerId, storeId: f.storeId, idempotencyKey: key,
    payload: pushPayloadSchema.parse({ subject: { kind: 'rider', id: riderId }, message, deliveryId }) })

const pushMany = (tx: ScopedSql, f: DispatchFacts, rows: { riderId: string; message: string; deliveryId: string; key: string }[]) => insertOutboxMany(tx, rows.map((r) => ({
  kind: 'push', partnerId: f.partnerId, storeId: f.storeId, idempotencyKey: r.key,
  payload: pushPayloadSchema.parse({ subject: { kind: 'rider', id: r.riderId }, message: r.message, deliveryId: r.deliveryId }),
})))

const close = async (tx: ScopedSql, f: DispatchFacts, d: queries.DeliveryRow, answer: 'taken' | 'expired') => {
  const offers = await queries.closeOffers(tx, d, answer, f.now)
  await pushMany(tx, f, offers.map((o) => ({ riderId: o.rider_id, message: 'rider.taken', deliveryId: d.id, key: `taken:${o.id}` })))
}
const queueRound = (tx: ScopedSql, f: DispatchFacts, d: queries.DeliveryRow) =>
  insertOutbox(tx, { kind: offerKind, partnerId: f.partnerId, storeId: f.storeId, idempotencyKey: `${d.id}:${d.offer_round}`, payload: { deliveryId: d.id, round: d.offer_round, ...(f.offeredRecorded ? { offeredRecorded: true } : {}) } })

export const createOwnDelivery = async (tx: ScopedSql, activity: ActivityLog, storeId: string, orderId: string, now: Date, origin?: Pick<ActivityEntry, 'actorKind' | 'actorId' | 'actorLabel' | 'api'>): Promise<void> => {
  const o = await queries.deliveryOrder(tx, storeId, orderId)
  if (!o || (o.payment_method !== 'cod' && o.payment_state !== 'paid')) return
  const d = await queries.insertDelivery(tx, { storeId, orderId, warehouseId: o.delivery_warehouse_id, currency: o.currency,
    cash: o.payment_method === 'cod' ? o.cash : null, searching: o.dispatch_when === 'placed', now })
  if (!d) return
  const f = { storeId, partnerId: o.partner_id, activity, now, ...(origin ? { actor: origin, api: origin.api } : {}) }
  await record(tx, f, dispatchAudit.created, d.id)
  if (d.state === 'searching') await queueRound(tx, { storeId, partnerId: o.partner_id, activity, now }, d)
}

const unassign = async (tx: ScopedSql, f: DispatchFacts, d: queries.DeliveryRow, reason: string) => {
  await queries.setDeliveryState(tx, d, 'unassigned', f.now)
  await close(tx, f, d, 'expired')
  await record(tx, f, dispatchAudit.unassigned, d.id, reason)
  await insertOutbox(tx, { kind: 'email', partnerId: f.partnerId, storeId: f.storeId,
    idempotencyKey: `delivery-unassigned:${d.id}:${d.offer_round}`, payload: { template: 'delivery-unassigned', deliveryId: d.id } })
}

export const broadcastDelivery = (sql: postgres.Sql, f: DispatchFacts, deliveryId: string, round: number) => withSystemScope(sql, async (tx) => {
  const d = await queries.lockDelivery(tx, f.storeId, deliveryId)
  if (!d || d.state !== 'searching' || d.offer_round !== round) return
  const notice = await queries.dispatchNotice(tx, f.storeId, d.id)
  if (notice?.partner_id !== f.partnerId) return
  if (await queries.deliveryExpired(tx, d, f.now)) return unassign(tx, f, d, 'timeout')
  if (await queries.roundHasOffers(tx, d)) return
  const riders = await queries.candidates(tx, d, f.now)
  if (riders.length === 0) return unassign(tx, f, d, 'no_riders')
  await queries.insertOffers(tx, d, riders, f.now)
  await pushMany(tx, f, riders.map((r) => ({ riderId: r.rider_id, message: 'rider.offer', deliveryId: d.id, key: `offer:${d.id}:${round}:${r.rider_id}` })))
  if (!f.offeredRecorded) await record(tx, f, dispatchAudit.offered, d.id)
})

export const sweepDispatch = (sql: postgres.Sql, activity: ActivityLog, now: Date) => withSystemScope(sql, async (tx) => {
  for (const rider of await queries.expirePositions(tx, now)) {
    await record(tx, { storeId: rider.store_id, partnerId: rider.partner_id, activity, now }, dispatchAudit.offline, rider.id, 'stale')
  }
  for (const row of await queries.dueDeliveries(tx, now)) {
    const d = await queries.lockDelivery(tx, row.store_id, row.id)
    if (d?.state === 'searching') await unassign(tx, { storeId: row.store_id, partnerId: row.partner_id, activity, now }, d, 'timeout')
  }
})

export const releaseRiderDeliveries = async (tx: ScopedSql, f: DispatchFacts, riderId: string, reason: string): Promise<void> => {
  await serialise(tx, `dispatch:${f.storeId}:${riderId}`)
  const rider = await queries.activeRider(tx, f.storeId, riderId)
  const deliveries = await queries.riderDeliveries(tx, f.storeId, riderId)
  if (deliveries.some((d) => d.state === 'picked_up')) throw new DispatchRefused('RIDER_HAS_PARCEL')
  for (const d of deliveries) {
    await close(tx, f, d, 'expired')
    const next = await queries.startRound(tx, d, f.now, riderId)
    await record(tx, f, dispatchAudit.handedBack, d.id, reason)
    await queueRound(tx, f, next)
  }
  const offers = await queries.closeRiderOffers(tx, f.storeId, riderId, f.now)
  await pushMany(tx, f, offers.map((o) => ({ riderId, message: 'rider.taken', deliveryId: o.delivery_id, key: `taken:${o.id}` })))
  await queries.setOnline(tx, f.storeId, riderId, false, f.now)
  if (rider?.online_at) await record(tx, f, dispatchAudit.offline, riderId, reason)
}

export const cancelOrderDelivery = async (tx: ScopedSql, f: DispatchFacts, orderId: string): Promise<void> => {
  for (const row of await queries.selectOrderDeliveries(tx, f.storeId, orderId)) {
    const d = await queries.lockDelivery(tx, f.storeId, row.id)
    if (d && ['packing', 'searching', 'unassigned', 'assigned'].includes(d.state)) await cancel(tx, f, d)
  }
}
const cancel = async (tx: ScopedSql, f: DispatchFacts, d: queries.DeliveryRow) => {
  await queries.setDeliveryState(tx, d, 'cancelled', f.now)
  await close(tx, f, d, 'expired')
  if (d.rider_id) await push(tx, f, d.rider_id, 'rider.cancelled', d.id, `cancelled:${d.id}`)
  await record(tx, f, dispatchAudit.cancelled, d.id)
}

const position = z.strictObject({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().finite().nonnegative(), at: z.iso.datetime() })
export const createDispatch = (deps: { sql: postgres.Sql; context: TenantContext; activity: ActivityLog; facts: RequestFacts; now: () => Date }) => {
  const { context, sql, activity, facts, now } = deps
  const riderId = context.caller.kind === 'rider' ? context.caller.riderId : null
  const actor: Actor = { actorKind: riderId ? 'rider' : 'person', actorId: riderId ?? (context.caller.kind === 'person' || context.caller.kind === 'impersonation' ? context.caller.userId : null), actorLabel: null }
  const f = (): DispatchFacts => ({ storeId: context.storeId, partnerId: context.partnerId, activity, facts, now: now(), actor })
  const run = <T>(work: (tx: ScopedSql, facts: DispatchFacts) => Promise<T>) => {
    if (context.sellerScope.kind === 'seller' || (context.caller.kind === 'support' && context.caller.access === 'read')) throw new DispatchRefused('FORBIDDEN')
    return withSystemScope(sql, (tx) => work(tx, f()))
  }
  const required = async (tx: ScopedSql, id: string) => {
    const d = isUuid(id) ? await queries.lockDelivery(tx, context.storeId, id) : null
    if (!d) throw new DispatchRefused('NOT_FOUND')
    return d
  }
  const merchant = () => { if (riderId) throw new DispatchRefused('FORBIDDEN') }
  return {
    online: (online: boolean) => run(async (tx, f) => {
      if (!riderId) throw new DispatchRefused('UNAUTHENTICATED')
      await serialise(tx, `dispatch:${context.storeId}:${riderId}`)
      const r = await queries.activeRider(tx, context.storeId, riderId)
      if (!r) throw new DispatchRefused('UNAUTHENTICATED')
      if (online && (!(await queries.ownDeliveryEnabled(tx, context.storeId)) || !(await selectStoreEntitlement(tx, context.storeId, 'own_delivery', f.now)).enabled)) throw new DispatchRefused('UNAVAILABLE')
      if (!online) await releaseRiderDeliveries(tx, f, riderId, 'offline')
      else await queries.setOnline(tx, context.storeId, riderId, true, f.now)
      if (online && !r.online_at) await record(tx, f, dispatchAudit.online, riderId)
      return true
    }),
    report: (raw: z.input<typeof position>) => run(async (tx, f) => {
      const p = position.safeParse(raw)
      if (!riderId || !p.success || new Date(p.data.at).getTime() > f.now.getTime() + 30_000) throw new DispatchRefused('INVALID_INPUT')
      await serialise(tx, `dispatch:${context.storeId}:${riderId}`)
      const r = await queries.activeRider(tx, context.storeId, riderId)
      if (!r?.online_at) throw new DispatchRefused('OFFLINE')
      const result = await queries.writePosition(tx, { ...p.data, at: new Date(p.data.at), now: f.now, storeId: context.storeId, riderId })
      if (result === 'limited') throw new DispatchRefused('RATE_LIMITED')
      return true
    }),
    offers: (window: PageWindow) => run((tx, f) => riderId ? queries.listOffers(tx, context.storeId, riderId, window, f.now) : Promise.reject(new DispatchRefused('UNAUTHENTICATED'))),
    answer: (id: string, accept: boolean) => run(async (tx, f) => {
      if (!riderId || !isUuid(id)) throw new DispatchRefused('TAKEN')
      await serialise(tx, `dispatch:${context.storeId}:${riderId}`)
      const offer = await queries.selectOffer(tx, context.storeId, riderId, id)
      if (!offer) throw new DispatchRefused('TAKEN')
      const d = await required(tx, offer.delivery_id)
      if (offer.answer || d.state !== 'searching' || offer.offer_round !== d.offer_round || await queries.deliveryExpired(tx, d, f.now)) throw new DispatchRefused('TAKEN')
      const r = await queries.activeRider(tx, context.storeId, riderId)
      if (!r?.online_at || !(await queries.freshPosition(tx, context.storeId, riderId, f.now))) throw new DispatchRefused('TAKEN')
      if (accept) {
        if ((await queries.riderDeliveries(tx, context.storeId, riderId)).length) throw new DispatchRefused('ON_DELIVERY')
        if (!(await queries.assignRider(tx, d, riderId, f.now, false))) throw new DispatchRefused('TAKEN')
      }
      await queries.answerOffer(tx, offer.id, accept ? 'accepted' : 'declined', f.now)
      if (accept) await close(tx, f, d, 'taken')
      await record(tx, f, accept ? dispatchAudit.accepted : dispatchAudit.declined, d.id)
      return true
    }),
    ready: (orderId: string) => run(async (tx, f) => {
      merchant()
      if (!isUuid(orderId)) throw new DispatchRefused('NOT_FOUND')
      const rows = await queries.selectOrderDeliveries(tx, context.storeId, orderId)
      const d = await required(tx, rows[0]?.id ?? '')
      if (d.state !== 'packing') throw new DispatchRefused('NOT_PACKING')
      const next = await queries.startRound(tx, d, f.now)
      await record(tx, f, dispatchAudit.ready, d.id)
      await queueRound(tx, f, next)
      return true
    }),
    assign: (id: string, to: string) => run(async (tx, f) => {
      merchant()
      if (!isUuid(to)) throw new DispatchRefused('NOT_FOUND')
      await serialise(tx, `dispatch:${context.storeId}:${to}`)
      const d = await required(tx, id)
      if (!await queries.activeRider(tx, context.storeId, to)) throw new DispatchRefused('NOT_FOUND')
      if (!await queries.assignRider(tx, d, to, f.now, true)) throw new DispatchRefused('NOT_UNASSIGNED')
      await close(tx, f, d, 'taken')
      await push(tx, f, to, 'rider.assigned', d.id, `assigned:${d.id}:${d.offer_round}`)
      await record(tx, f, dispatchAudit.assigned, d.id)
      return true
    }),
    again: (id: string) => run(async (tx, f) => {
      merchant()
      const d = await required(tx, id)
      if (!['unassigned', 'cancelled'].includes(d.state)) throw new DispatchRefused('NOT_UNASSIGNED')
      let next: queries.DeliveryRow
      if (d.state === 'cancelled') {
        const order = await queries.deliveryOrder(tx, context.storeId, d.order_id)
        if (!order) throw new DispatchRefused('NOT_FOUND')
        const created = await queries.insertDelivery(tx, { storeId: context.storeId, orderId: d.order_id, warehouseId: d.warehouse_id, currency: d.currency, cash: d.cash_due_amount, searching: true, now: f.now })
        if (!created) throw new DispatchRefused('NOT_UNASSIGNED')
        next = created
        await record(tx, f, dispatchAudit.created, next.id)
      } else {
        await close(tx, f, d, 'expired')
        next = await queries.startRound(tx, d, f.now)
      }
      await record(tx, f, dispatchAudit.offered, next.id)
      await queueRound(tx, { ...f, offeredRecorded: true }, next)
      return true
    }),
    cancel: (id: string) => run(async (tx, f) => {
      merchant()
      const d = await required(tx, id)
      if (!['packing', 'searching', 'unassigned', 'assigned'].includes(d.state)) throw new DispatchRefused('NOT_CANCELLABLE')
      await cancel(tx, f, d)
      return true
    }),
  }
}
