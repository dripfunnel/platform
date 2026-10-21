import type { CourierProvider, TrackingStatus } from '#core/couriers'
import { pgArray, type ScopedSql } from './index'

// Shipping an order's lines (migration 0071; DATA-MODEL §7.6, §7.4), in system scope: the engine has named the store and
// the caller's owner from its context, and these queries hold every line, location and part to that owner.

export interface OrderToShipRow {
  id: string
  number: string
  state: string
  payment_state: string
  payment_method: string | null
  shipping_option: string | null
  test: boolean
}

/** The order, locked; null when it isn't the store's or is still a cart. */
export const lockOrderToShip = async (tx: ScopedSql, storeId: string, orderId: string): Promise<OrderToShipRow | null> =>
  (
    await tx<OrderToShipRow[]>`
      select o.id, o.number, o.state, o.payment_state, o.payment_method, o.shipping_option,
        exists (select 1 from payment m where m.order_id = o.id and m.mode = 'test') as test
      from "order" o where o.id = ${orderId} and o.store_id = ${storeId} and o.state <> 'cart' for update of o
    `
  )[0] ?? null

export interface LineToShipRow {
  id: string
  seller_id: string | null
  version_id: string
  product_id: string
  quantity: number
  fulfilled_quantity: number
  reserved_warehouse_id: string | null
  track_stock: boolean
  part_id: string
  shipping_mode: 'store' | 'to-store' | 'to-shopper'
  /** What a to-store supplier has handed to the store so far, which the store may ship on. */
  sent_quantity: number
}

export const lockLinesToShip = (tx: ScopedSql, storeId: string, orderId: string): Promise<LineToShipRow[]> =>
  tx<LineToShipRow[]>`
    select l.id, l.seller_id, l.version_id, l.product_id, l.quantity, l.fulfilled_quantity, l.reserved_warehouse_id, coalesce(v.track_stock, false) as track_stock,
      p.id as part_id, p.shipping_mode,
      coalesce((select sum(fl.quantity) from fulfilment_line fl join fulfilment f on f.id = fl.fulfilment_id
        where fl.order_line_id = l.id and f.kind = 'sent_to_store'), 0)::int as sent_quantity
    from order_line l join order_part p on p.order_id = l.order_id and p.seller_id is not distinct from l.seller_id
      join product_version v on v.id = l.version_id
    where l.order_id = ${orderId} and l.store_id = ${storeId}
    order by l.position
    for update of l
  `

/** A location of this owner (null, the merchant's), not removed. */
export const ownsWarehouse = async (tx: ScopedSql, storeId: string, sellerId: string | null, warehouseId: string): Promise<boolean> =>
  (await tx`select 1 from warehouse where id = ${warehouseId} and store_id = ${storeId} and seller_id is not distinct from ${sellerId} and deleted_at is null`).length > 0

/** The store's own default location, where a to-store supplier sends its lines (ACCESS §7.3). */
export const storeDefaultWarehouse = async (tx: ScopedSql, storeId: string): Promise<string | null> =>
  (await tx<{ id: string }[]>`select id from warehouse where store_id = ${storeId} and seller_id is null and is_default and deleted_at is null`)[0]?.id ?? null

export interface ShippedLine {
  lineId: string
  versionId: string
  productId: string
  sellerId: string | null
  quantity: number
  /** Where the order held it, given back as it leaves; null when nothing was held. */
  heldAt: string | null
  /** Taken off hand at the location shipped from: false for an untracked version, or a to-store line shipped on. */
  takeStock: boolean
  /** Counted as gone to the shopper: false for a supplier's hand-off to the store. */
  fulfils: boolean
}

/**
 * One shipment's stock and lines in a fixed few statements, whatever its size: units off hand where they left with an
 * `order` movement, the order's holds given back, the lines' fulfilled counts; false when the location hasn't enough.
 */
export const shipOut = async (tx: ScopedSql, s: { storeId: string; warehouseId: string; orderId: string; actorId: string; lines: readonly ShippedLine[] }): Promise<boolean> => {
  const sum = <K extends string>(items: readonly ShippedLine[], key: (l: ShippedLine) => K) => {
    const totals = new Map<K, { line: ShippedLine; quantity: number }>()
    for (const l of items) totals.set(key(l), { line: l, quantity: (totals.get(key(l))?.quantity ?? 0) + l.quantity })
    return [...totals.values()]
  }
  const taken = sum(s.lines.filter((l) => l.takeStock), (l) => l.versionId)
  if (taken.length > 0) {
    const versions = pgArray(taken.map((t) => t.line.versionId))
    const quantities = pgArray(taken.map((t) => String(t.quantity)))
    const left = await tx<{ version_id: string }[]>`
      update stock_level l set on_hand = l.on_hand - x.q, updated_at = now()
      from unnest(${versions}::uuid[], ${quantities}::int[]) as x(v, q)
      where l.version_id = x.v and l.warehouse_id = ${s.warehouseId} and l.on_hand >= x.q
      returning l.version_id
    `
    if (left.length < taken.length) return false
    await tx`
      insert into stock_movement (store_id, seller_id, product_id, version_id, warehouse_id, delta, resulting_quantity, reason, source_kind, source_id, actor_kind, actor_id)
      select ${s.storeId}, nullif(x.seller, '')::uuid, x.product, x.v, ${s.warehouseId}, -x.q, l.on_hand, 'order', 'order', ${s.orderId}, 'person', ${s.actorId}
      from unnest(${versions}::uuid[], ${pgArray(taken.map((t) => t.line.productId))}::uuid[], ${pgArray(taken.map((t) => t.line.sellerId ?? ''))}::text[], ${quantities}::int[]) as x(v, product, seller, q)
      join stock_level l on l.version_id = x.v and l.warehouse_id = ${s.warehouseId}
    `
  }
  const held = sum(s.lines.filter((l) => l.heldAt !== null), (l) => `${l.versionId}:${l.heldAt ?? ''}`)
  if (held.length > 0) {
    await tx`
      update stock_level l set reserved = greatest(l.reserved - x.q, 0), updated_at = now()
      from unnest(${pgArray(held.map((h) => h.line.versionId))}::uuid[], ${pgArray(held.map((h) => h.line.heldAt ?? ''))}::uuid[], ${pgArray(held.map((h) => String(h.quantity)))}::int[]) as x(v, w, q)
      where l.version_id = x.v and l.warehouse_id = x.w
    `
  }
  const fulfilled = s.lines.filter((l) => l.fulfils)
  if (fulfilled.length > 0) {
    await tx`
      update order_line o set fulfilled_quantity = o.fulfilled_quantity + x.q
      from unnest(${pgArray(fulfilled.map((l) => l.lineId))}::uuid[], ${pgArray(fulfilled.map((l) => String(l.quantity)))}::int[]) as x(id, q)
      where o.id = x.id
    `
  }
  return true
}

/** What a label booked through the store's courier adds to its shipment (migration 0130). */
export interface Booking {
  id: string
  provider: CourierProvider
  providerRef: string
  pickup: { ref: string | null; date: string | null } | null
}

export const insertFulfilment = async (
  tx: ScopedSql,
  f: { storeId: string; orderId: string; partId: string; sellerId: string | null; kind: 'booked' | 'manual' | 'sent_to_store' | 'pickup'; warehouseId: string; courierName: string | null; trackingNumber: string | null; trackingUrl: string | null; shippedAt: Date; createdBy: string; booking?: Booking },
  lines: readonly { lineId: string; quantity: number }[],
): Promise<string> => {
  const b = f.booking
  const [row] = await tx<{ id: string }[]>`
    insert into fulfilment (id, order_part_id, order_id, store_id, seller_id, kind, warehouse_id, courier_name, tracking_number, tracking_url, shipped_at, created_by,
      courier_provider, provider_ref, booked_at, pickup_requested_at, pickup_ref, pickup_date)
    values (${b?.id ?? crypto.randomUUID()}, ${f.partId}, ${f.orderId}, ${f.storeId}, ${f.sellerId}, ${f.kind}, ${f.warehouseId}, ${f.courierName}, ${f.trackingNumber}, ${f.trackingUrl}, ${f.shippedAt}, ${f.createdBy},
      ${b?.provider ?? null}, ${b?.providerRef ?? null}, ${b ? f.shippedAt : null}, ${b?.pickup ? f.shippedAt : null}, ${b?.pickup?.ref ?? null}, ${b?.pickup?.date ?? null})
    returning id
  `
  const id = row?.id ?? ''
  await tx`
    insert into fulfilment_line (fulfilment_id, order_line_id, store_id, seller_id, quantity)
    select ${id}, x.line_id, ${f.storeId}, ${f.sellerId}, x.quantity
    from unnest(${pgArray(lines.map((l) => l.lineId))}::uuid[], ${pgArray(lines.map((l) => String(l.quantity)))}::int[]) as x(line_id, quantity)
  `
  return id
}

/** Each part's and the order's state from its lines (DATA-MODEL §7.6); the store shipping lets a transfer's due date go. */
export const settleShippingStates = async (tx: ScopedSql, orderId: string, now: Date, byStore: boolean): Promise<void> => {
  await tx`
    update order_part p set state = case
        when x.left = 0 then 'shipped'
        when x.fulfilled > 0 then 'partly_shipped'
        when p.shipping_mode = 'to-store' and x.sent >= x.total then 'sent_to_store'
        else 'to_ship' end
    from (
      select l.seller_id, sum(l.quantity) as total, sum(l.quantity - l.fulfilled_quantity) as left, sum(l.fulfilled_quantity) as fulfilled,
        coalesce(sum((select sum(fl.quantity) from fulfilment_line fl join fulfilment f on f.id = fl.fulfilment_id where fl.order_line_id = l.id and f.kind = 'sent_to_store')), 0) as sent
      from order_line l where l.order_id = ${orderId} group by l.seller_id
    ) x
    where p.order_id = ${orderId} and p.seller_id is not distinct from x.seller_id and p.state <> 'cancelled'
  `
  await tx`
    update "order" o set fulfilment_state = case
        when x.left = 0 then 'fulfilled' when x.fulfilled > 0 then 'partly_fulfilled' else 'unfulfilled' end,
      payment_due_by = ${byStore ? null : tx`payment_due_by`}, updated_at = ${now}, revision = revision + 1
    from (select sum(quantity - fulfilled_quantity) as left, sum(fulfilled_quantity) as fulfilled from order_line where order_id = ${orderId}) x
    where o.id = ${orderId}
  `
}

export interface FulfilmentRow {
  id: string
  seller_id: string | null
  kind: string
  warehouse_id: string
  warehouse_name: string
  courier_name: string | null
  tracking_number: string | null
  tracking_url: string | null
  shipped_at: Date
  courier_provider: CourierProvider | null
  booked_at: Date | null
  pickup_requested_at: Date | null
  pickup_ref: string | null
  pickup_date: string | null
  tracking_status: TrackingStatus | null
  delivered_at: Date | null
  /** The printed label's document, which the caller's scope reads only when it is its own (migration 0130). */
  label_document_id: string | null
  lines: { line_id: string; quantity: number }[]
}

/** An order's shipments as the caller's scope lets it read them: every one for the merchant side, a supplier's own. */
export const selectFulfilments = (tx: ScopedSql, orderId: string): Promise<FulfilmentRow[]> =>
  tx<FulfilmentRow[]>`
    select f.id, f.seller_id, f.kind, f.warehouse_id, w.name as warehouse_name, f.courier_name, f.tracking_number, f.tracking_url, f.shipped_at,
      f.courier_provider, f.booked_at, f.pickup_requested_at, f.pickup_ref, to_char(f.pickup_date, 'YYYY-MM-DD') as pickup_date, f.tracking_status, f.delivered_at,
      (select d.id from order_document d where d.fulfilment_id = f.id and d.kind = 'label') as label_document_id,
      coalesce((select json_agg(json_build_object('line_id', fl.order_line_id, 'quantity', fl.quantity)) from fulfilment_line fl where fl.fulfilment_id = f.id), '[]'::json) as lines
    from fulfilment f join warehouse w on w.id = f.warehouse_id
    where f.order_id = ${orderId}
    order by f.shipped_at, f.id
  `

/** A shipment of this owner, locked, with its order's number. */
export const lockFulfilmentForTracking = async (tx: ScopedSql, storeId: string, sellerId: string | null, fulfilmentId: string): Promise<{ id: string; order_id: string; number: string; tracking_number: string | null; kind: string } | null> =>
  (
    await tx<{ id: string; order_id: string; number: string; tracking_number: string | null; kind: string }[]>`
      select f.id, f.order_id, o.number, f.tracking_number, f.kind from fulfilment f join "order" o on o.id = f.order_id
      where f.id = ${fulfilmentId} and f.store_id = ${storeId} and f.seller_id is not distinct from ${sellerId}
      for update of f
    `
  )[0] ?? null

export const setTracking = async (tx: ScopedSql, fulfilmentId: string, t: { courierName: string | null; trackingNumber: string; trackingUrl: string | null }): Promise<void> => {
  // A correction keeps what it doesn't restate: the courier's name and the tracking address.
  await tx`update fulfilment set courier_name = coalesce(${t.courierName}, courier_name), tracking_number = ${t.trackingNumber}, tracking_url = coalesce(${t.trackingUrl}, tracking_url) where id = ${fulfilmentId}`
}
