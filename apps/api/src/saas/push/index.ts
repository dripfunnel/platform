import { z } from 'zod'
import type { ScopedSql } from '#db/scoped/index'
import { queueSideEffect } from '#saas/outbox/index'

// What the platform pushes to a store's apps (DELIVERY §6), and the receipts read after. A push never carries an
// address, a phone, an amount or a code: its data is only { kind, deliveryId | orderId }.

export const pushKind = 'push'
export const pushReceiptsKind = 'push.receipts'

/** The one event #840 builds: a phone newly registered to a rider. DL 5, DL 6 and SH 5 add theirs. */
export const pushMessages = ['rider.notifications_on'] as const
export type PushMessageCode = (typeof pushMessages)[number]

/** The outbox payload: no free text, and ids only. */
export const pushPayloadSchema = z
  .object({
    subject: z.object({ kind: z.enum(['rider', 'customer', 'order']), id: z.uuid() }).strict(),
    message: z.enum(pushMessages),
    deliveryId: z.uuid().optional(),
    orderId: z.uuid().optional(),
  })
  .strict()
  .refine((p) => p.deliveryId === undefined || p.orderId === undefined, 'deliveryId or orderId, not both')
export type PushPayload = z.infer<typeof pushPayloadSchema>

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

type Wording = Record<PushMessageCode, (store: string) => { title: string; body: string }>

// English for the first release (ui/README.md: messages per locale); a second locale adds a sibling object.
const en: Wording = {
  'rider.notifications_on': (store) => ({ title: store, body: `Notifications are on for ${store}.` }),
}

/** The title, body and data for the store's language, English where it has none yet. */
export const composePush = (payload: PushPayload, store: { name: string; locale: string }) => {
  const words = ({ en } as Record<string, Wording>)[store.locale.split('-')[0] ?? ''] ?? en
  const data: Record<string, string> = { kind: payload.message }
  if (payload.deliveryId) data['deliveryId'] = payload.deliveryId
  if (payload.orderId) data['orderId'] = payload.orderId
  return { ...words[payload.message](store.name), data }
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
