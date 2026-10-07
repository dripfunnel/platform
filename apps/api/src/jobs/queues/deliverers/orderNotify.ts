import type postgres from 'postgres'
import { z } from 'zod'
import { withSystemScope } from '#db/scoped/index'
import { selectOrderToTell, selectShipmentToTell } from '#db/scoped/orderUpdates'
import { queueSideEffect } from '#saas/outbox/index'
import { orderTextMs, queueSms } from '#saas/sms/index'
import { GiveUp, type Deliverer } from '../outbox-relay'

// `order.notify` (#312): a shopper's order update, read when it runs and queued on as the email and the text, each
// once under the update's own key. The email reads the order again when it is sent (saas/email compose.ts).

const update = z.discriminatedUnion('event', [
  z.object({ event: z.literal('confirmed'), orderId: z.uuid() }).strict(),
  z.object({ event: z.literal('shipped'), orderId: z.uuid(), fulfilmentId: z.uuid() }).strict(),
])

/** The sender's name in a text (THIRD-PARTY-ACCESS §2.8 {1}): the store's, cut to what a template takes. */
const senderName = (store: string) => store.trim().slice(0, 30)

export const orderNotifyDeliverer = (sql: postgres.Sql, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect) => {
    const parsed = update.safeParse(effect.payload)
    if (!parsed.success || !effect.partnerId) throw new GiveUp('bad_payload')
    const u = parsed.data
    const partnerId = effect.partnerId
    await withSystemScope(sql, async (tx) => {
      const order = await selectOrderToTell(tx, u.orderId)
      // Gone, another partner's, cancelled since or a test: nobody is told.
      if (!order || order.partner_id !== partnerId || order.store_id !== effect.storeId || order.state === 'cancelled' || order.test) return
      const shipment = u.event === 'shipped' ? await selectShipmentToTell(tx, u.fulfilmentId) : null
      if (u.event === 'shipped' && shipment?.order_id !== order.id) return
      const key = u.event === 'confirmed' ? `confirmed:${order.id}` : `${shipment?.tracking_number ? 'tracked' : 'shipped'}:${u.fulfilmentId}`
      if (order.email) {
        const payload = u.event === 'confirmed' ? { template: 'order-confirmed', orderId: order.id } : { template: 'order-shipped', orderId: order.id, fulfilmentId: u.fulfilmentId }
        await queueSideEffect(tx, { kind: 'email', idempotencyKey: key, payload, partnerId, storeId: order.store_id })
      }
      if (!order.phone) return
      const expiresAt = new Date(now().getTime() + orderTextMs).toISOString()
      const brand = senderName(order.store_name)
      if (u.event === 'confirmed') {
        await queueSms(tx, { partnerId, storeId: order.store_id, idempotencyKey: key, payload: { message: 'order.confirmed', to: order.phone, brand, vars: { order: order.number }, expiresAt } })
        return
      }
      // The registered text names the courier and a link to track it; without both it waits for tracking (addTracking).
      if (shipment?.courier_name && shipment.tracking_url) {
        const vars = { order: order.number, courier: shipment.courier_name.slice(0, 40), link: shipment.tracking_url }
        await queueSms(tx, { partnerId, storeId: order.store_id, idempotencyKey: key, payload: { message: 'order.shipped', to: order.phone, brand, vars, expiresAt } })
      }
    })
  },
})
