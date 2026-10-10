import type { ScopedSql } from './index'
import { insertOutbox, insertOutboxMany } from './outbox'

// The store's engine events for its webhooks (PLATFORM-PROMPT §5.5): queued in the transaction that made them, only
// when an endpoint of the store takes the event, and fanned out to its endpoints by the `webhook.event` deliverer.

export const storeEvents = ['order.placed', 'order.paid', 'order.shipped', 'order.refunded', 'product.updated', 'stock.changed'] as const
export type StoreEvent = (typeof storeEvents)[number]

export const isStoreEvent = (value: string): value is StoreEvent => (storeEvents as readonly string[]).includes(value)

export const storeEventKind = 'webhook.event'

/** What an event says: ids only, so neither the outbox nor the delivery log holds a shopper's details. */
export interface StoreEventData {
  object: 'order' | 'product' | 'product_version'
  id: string
  /** The order's number, which the merchant knows it by. */
  number?: string
}

/** Many events of one kind in one store with one check, as a save of many stock numbers makes them. */
export const queueStoreEvents = async (tx: ScopedSql, storeId: string, event: StoreEvent, items: readonly StoreEventData[], at: Date): Promise<void> => {
  if (items.length === 0) return
  const [row] = await tx<{ partner_id: string | null }[]>`select store_webhook_partner(${storeId}, ${event}) as partner_id`
  const partnerId = row?.partner_id
  if (!partnerId) return
  await insertOutboxMany(tx, items.map((data) => ({ kind: storeEventKind, idempotencyKey: `${event}:${crypto.randomUUID()}`, payload: { eventId: crypto.randomUUID(), event, data, occurredAt: at.toISOString() }, partnerId, storeId })))
}

/** `key` makes it once an event: the same order paid twice through two paths is told once. */
export const queueStoreEvent = async (tx: ScopedSql, storeId: string, event: StoreEvent, data: StoreEventData, key: string, at: Date): Promise<void> => {
  const [row] = await tx<{ partner_id: string | null }[]>`select store_webhook_partner(${storeId}, ${event}) as partner_id`
  if (!row?.partner_id) return
  await insertOutbox(tx, { kind: storeEventKind, idempotencyKey: `${event}:${key}`, payload: { eventId: crypto.randomUUID(), event, data, occurredAt: at.toISOString() }, partnerId: row.partner_id, storeId })
}
