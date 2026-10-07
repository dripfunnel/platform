import type { ScopedSql } from './index'
import { insertOutbox } from './outbox'

// A shopper's order updates (#312; THIRD-PARTY-ACCESS §2.8): the engine queues the event with ids only, and the
// `order.notify` deliverer reads the order when it runs and queues the email and the text from what it finds.

export const orderUpdateKind = 'order.notify'

export type OrderUpdate = { event: 'confirmed'; orderId: string } | { event: 'shipped'; orderId: string; fulfilmentId: string }

/** Queued once an event: confirmed once an order, shipped once a shipment and once more when tracking first arrives. */
export const queueOrderUpdate = async (tx: ScopedSql, storeId: string, update: OrderUpdate, key: string): Promise<void> => {
  const [store] = await tx<{ partner_id: string }[]>`select partner_id from store where id = ${storeId}`
  if (!store) return
  await insertOutbox(tx, { kind: orderUpdateKind, idempotencyKey: key, payload: { ...update }, partnerId: store.partner_id, storeId })
}

export interface OrderToTellRow {
  id: string
  store_id: string
  partner_id: string
  store_name: string
  number: string
  email: string | null
  phone: string | null
  state: string
  test: boolean
}

/** The order an update is about, as the deliverer finds it when it runs. */
export const selectOrderToTell = async (tx: ScopedSql, orderId: string): Promise<OrderToTellRow | null> =>
  (
    await tx<OrderToTellRow[]>`
      select o.id, o.store_id, s.partner_id, s.name as store_name, o.number, o.email, o.phone, o.state,
        exists (select 1 from payment m where m.order_id = o.id and m.mode = 'test') as test
      from "order" o join store s on s.id = o.store_id where o.id = ${orderId} and o.state <> 'cart'
    `
  )[0] ?? null

export interface ShipmentToTellRow {
  order_id: string
  courier_name: string | null
  tracking_number: string | null
  tracking_url: string | null
}

export const selectShipmentToTell = async (tx: ScopedSql, fulfilmentId: string): Promise<ShipmentToTellRow | null> =>
  (await tx<ShipmentToTellRow[]>`select order_id, courier_name, tracking_number, tracking_url from fulfilment where id = ${fulfilmentId} and kind = 'manual'`)[0] ?? null

export interface OrderEmailRow {
  store_id: string
  partner_id: string
  store_name: string
  contact_email: string | null
  locale: string
  number: string
  email: string | null
  state: string
  payment_method: string | null
  currency: string
  total_amount: string
  ship_to: { name: string; city: string } | null
  lines: { name: string; version_name: string | null; quantity: number; amount: string }[]
}

/** What the order email says: every line; or, for a shipment, the lines and units in it. */
export const selectOrderEmail = async (tx: ScopedSql, orderId: string, fulfilmentId: string | null): Promise<OrderEmailRow | null> =>
  (
    await tx<OrderEmailRow[]>`
      select o.store_id, s.partner_id, s.name as store_name, s.contact_email, s.main_language as locale, o.number, o.email, o.state, o.payment_method, o.currency,
        o.total_amount::text as total_amount,
        case when o.shipping_address is null then null else json_build_object('name', o.shipping_address ->> 'name', 'city', o.shipping_address ->> 'city') end as ship_to,
        coalesce((select json_agg(json_build_object('name', l.name, 'version_name', l.version_name, 'quantity', coalesce(fl.quantity, l.quantity), 'amount', l.line_total_amount::text) order by l.position)
          from order_line l left join fulfilment_line fl on fl.order_line_id = l.id and fl.fulfilment_id = ${fulfilmentId}::uuid
          where l.order_id = o.id and (${fulfilmentId}::uuid is null or fl.fulfilment_id is not null)), '[]'::json) as lines
      from "order" o join store s on s.id = o.store_id
      where o.id = ${orderId} and o.state <> 'cart'
    `
  )[0] ?? null
