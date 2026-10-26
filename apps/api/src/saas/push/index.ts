import { z } from 'zod'
import type { ScopedSql } from '#db/scoped/index'
import { queueSideEffect } from '#saas/outbox/index'

// What the platform pushes to a store's apps (DELIVERY §6), and the receipts read after. A push never carries an
// address, a phone, an amount or a code: its data is only { kind, deliveryId | orderId }.

export const pushKind = 'push'
export const pushReceiptsKind = 'push.receipts'

/** The messages the platform pushes (DELIVERY §6): the rider's, and from DL 6 the customer's picked up, delivered and not delivered. */
export { pushMessages, pushPayloadSchema, type PushPayload, type PushMessageCode } from '#core/push'
import { pushPayloadSchema, type PushPayload, type PushMessageCode } from '#core/push'

/** Expo's receipts are ready about 15 minutes after a send and kept for a day (THIRD-PARTY-ACCESS §2.13). */
export const receiptsAfterMs = 15 * 60 * 1000
export const receiptsKeptMs = 24 * 60 * 60 * 1000

export const pushReceiptsPayloadSchema = z
  .object({
    tickets: z.array(z.object({ ticketId: z.string().min(1).max(100), deviceId: z.uuid() }).strict()).min(1).max(100),
    sentAt: z.iso.datetime(),
  })
  .strict()
export type PushReceiptsPayload = z.infer<typeof pushReceiptsPayloadSchema>

type Wording = Record<PushMessageCode, (store: string, distance: string | null) => { title: string; body: string }>

// English for the first release (ui/README.md: messages per locale); a second locale adds a sibling object.
const en: Wording = {
  'rider.offer': (store, distance) => ({ title: store, body: distance ? `New delivery, ${distance} away.` : 'New delivery offer. Open the app to accept or decline.' }),
  'rider.assigned': (store) => ({ title: store, body: 'A delivery has been assigned to you.' }),
  'rider.taken': () => ({ title: '', body: '' }),
  'rider.cancelled': (store) => ({ title: store, body: 'The delivery was cancelled. Do not pick it up.' }),
  'rider.recalled': (store) => ({ title: store, body: 'The store has recalled this delivery. Bring the parcel back.' }),
  // Never the handover code (DELIVERY §3); pointing to it waits for SH 5, which shows it on the order.
  'order.picked_up': (store) => ({ title: store, body: 'Your order is on its way.' }),
  'order.delivered': (store) => ({ title: store, body: 'Your order has been delivered.' }),
  'order.not_delivered': (store) => ({ title: store, body: 'We couldn’t deliver your order. The store will be in touch.' }),
  'rider.notifications_on': (store) => ({ title: store, body: `Notifications are on for ${store}.` }),
}

/** The title, body and data for the store's language, English where it has none yet. */
export const composePush = (payload: PushPayload, store: { name: string; locale: string; unit_system?: string }, distanceM: number | null = null) => {
  const words = ({ en } as Record<string, Wording>)[store.locale.split('-')[0] ?? ''] ?? en
  const data: Record<string, string> = { kind: payload.message }
  if (payload.deliveryId) data['deliveryId'] = payload.deliveryId
  if (payload.orderId) data['orderId'] = payload.orderId
  let distance: string | null = null
  if (payload.message === 'rider.offer' && distanceM !== null) {
    const imperial = store.unit_system === 'imperial'
    distance = new Intl.NumberFormat(store.locale, { style: 'unit', unit: imperial ? 'mile' : 'kilometer', maximumFractionDigits: 1 }).format(distanceM / (imperial ? 1609.344 : 1000))
  }
  return { ...words[payload.message](store.name, distance), data, silent: payload.message === 'rider.taken' }
}

/** Queues one push in the transaction that decided it, once per idempotency key. */
export const queuePush = (tx: ScopedSql, effect: { partnerId: string; storeId: string; idempotencyKey: string; payload: PushPayload }): Promise<string | null> => {
  const payload = pushPayloadSchema.parse(effect.payload)
  return queueSideEffect(tx, { kind: pushKind, idempotencyKey: effect.idempotencyKey, payload, partnerId: effect.partnerId, storeId: effect.storeId })
}

/** The receipts of one send, read `receiptsAfterMs` later. */
export const queuePushReceipts = (tx: ScopedSql, effect: { partnerId: string; storeId: string; idempotencyKey: string; payload: PushReceiptsPayload }): Promise<string | null> => {
  const payload = pushReceiptsPayloadSchema.parse(effect.payload)
  return queueSideEffect(tx, { kind: pushReceiptsKind, idempotencyKey: effect.idempotencyKey, payload, partnerId: effect.partnerId, storeId: effect.storeId, notBefore: new Date(new Date(payload.sentAt).getTime() + receiptsAfterMs) })
}
