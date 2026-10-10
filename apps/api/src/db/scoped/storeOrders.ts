import type { PageWindow } from '#core/paging'
import type { CartAddress } from './cart'
import type { ScopedSql } from './index'

// The Orders screen (FIRST-RELEASE §6; DATA-MODEL §7.6, §7.11): the merchant side reads every order of the store, and a
// supplier only its own part of one, through order_for_supplier and order_line_for_supplier (migration 0070).

export const orderFilters = ['all', 'to_ship', 'partly_shipped', 'shipped', 'cancelled_refunded', 'payment_pending'] as const
export type OrderFilter = (typeof orderFilters)[number]

export interface OrderListRow {
  id: string
  number: string
  placed_at: Date
  state: 'placed' | 'cancelled'
  /** The merchant side's; null for a supplier, which reads its part's state instead. */
  payment_state: string | null
  fulfilment_state: string | null
  payment_method: string | null
  total_amount: string | null
  currency: string
  test: boolean | null
  customer_name: string | null
  city: string | null
  items: number
  /** A supplier's own part; null on the merchant side. */
  part_state: string | null
  shipping_mode: string | null
}

// An order that went through (paid, or paid later by cash or transfer) on the live storefront, as a supplier's view has it.
export const goneThrough = (tx: ScopedSql) =>
  tx`(o.payment_state <> 'pending' or o.payment_method in ('cod', 'bank_transfer')) and not exists (select 1 from payment m where m.order_id = o.id and m.mode = 'test')`

export const merchantFilter = (tx: ScopedSql, filter: OrderFilter) => {
  switch (filter) {
    case 'all':
      return tx`true`
    case 'to_ship':
      return tx`o.state = 'placed' and o.fulfilment_state in ('unfulfilled', 'partly_fulfilled') and ${goneThrough(tx)}`
    case 'partly_shipped':
      return tx`o.state = 'placed' and o.fulfilment_state = 'partly_fulfilled'`
    case 'shipped':
      return tx`o.state = 'placed' and o.fulfilment_state = 'fulfilled'`
    case 'cancelled_refunded':
      return tx`(o.state = 'cancelled' or o.payment_state = 'refunded')`
    case 'payment_pending':
      return tx`o.state = 'placed' and o.payment_state = 'pending'`
  }
}

// A supplier's chips are its part's (PortalOrders); money and payment aren't its to filter by.
const supplierFilter = (tx: ScopedSql, filter: OrderFilter) => {
  switch (filter) {
    case 'all':
      return tx`true`
    case 'to_ship':
      return tx`v.state = 'placed' and v.part_state in ('to_ship', 'partly_shipped')`
    case 'partly_shipped':
      return tx`v.state = 'placed' and v.part_state = 'partly_shipped'`
    case 'shipped':
      return tx`v.part_state in ('sent_to_store', 'shipped', 'delivered')`
    case 'cancelled_refunded':
    case 'payment_pending':
      return tx`false`
  }
}

const pageTail = (tx: ScopedSql, alias: 'o' | 'v', window: PageWindow) => {
  const backwards = window.before !== null && window.after === null
  const at = tx(`${alias}.placed_at`)
  const id = tx(`${alias}.id`)
  return tx`
    and ${window.after ? tx`(${at}, ${id}) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
    and ${window.before ? tx`(${at}, ${id}) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by ${at} ${backwards ? tx`asc` : tx`desc`}, ${id} ${backwards ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `
}

const like = (search: string) => `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

export const selectMerchantOrders = (tx: ScopedSql, storeId: string, filter: OrderFilter, search: string | null, window: PageWindow): Promise<OrderListRow[]> =>
  tx<OrderListRow[]>`
    select o.id, o.number, o.placed_at, o.state, o.payment_state, o.fulfilment_state, o.payment_method, o.total_amount::text as total_amount, o.currency,
      exists (select 1 from payment m where m.order_id = o.id and m.mode = 'test') as test,
      o.shipping_address ->> 'name' as customer_name, o.shipping_address ->> 'city' as city,
      (select coalesce(sum(l.quantity), 0)::int from order_line l where l.order_id = o.id) as items, null as part_state, null as shipping_mode
    from "order" o
    where o.store_id = ${storeId} and o.state <> 'cart' and ${merchantFilter(tx, filter)}
      and ${search ? tx`(o.number ilike ${like(search)} or o.shipping_address ->> 'name' ilike ${like(search)})` : tx`true`}
    ${pageTail(tx, 'o', window)}
  `

export const selectSupplierOrders = (tx: ScopedSql, filter: OrderFilter, search: string | null, window: PageWindow): Promise<OrderListRow[]> =>
  tx<OrderListRow[]>`
    select v.id, v.number, v.placed_at, v.state, null as payment_state, null as fulfilment_state, null as payment_method, null as total_amount, v.currency,
      null as test, v.customer_name, v.shipping_address ->> 'city' as city,
      (select coalesce(sum(l.quantity), 0)::int from order_line l where l.order_id = v.id) as items, v.part_state, v.shipping_mode
    from order_for_supplier v
    where ${supplierFilter(tx, filter)} and ${search ? tx`v.number ilike ${like(search)}` : tx`true`}
    ${pageTail(tx, 'v', window)}
  `

export type OrderCounts = Record<OrderFilter, number>

export const countMerchantOrders = async (tx: ScopedSql, storeId: string): Promise<OrderCounts> => {
  const [row] = await tx<OrderCounts[]>`
    select count(*)::int as all,
      count(*) filter (where ${merchantFilter(tx, 'to_ship')})::int as to_ship,
      count(*) filter (where ${merchantFilter(tx, 'partly_shipped')})::int as partly_shipped,
      count(*) filter (where ${merchantFilter(tx, 'shipped')})::int as shipped,
      count(*) filter (where ${merchantFilter(tx, 'cancelled_refunded')})::int as cancelled_refunded,
      count(*) filter (where ${merchantFilter(tx, 'payment_pending')})::int as payment_pending
    from "order" o where o.store_id = ${storeId} and o.state <> 'cart'
  `
  return row ?? { all: 0, to_ship: 0, partly_shipped: 0, shipped: 0, cancelled_refunded: 0, payment_pending: 0 }
}

export const countSupplierOrders = async (tx: ScopedSql): Promise<OrderCounts> => {
  const [row] = await tx<OrderCounts[]>`
    select count(*)::int as all,
      count(*) filter (where ${supplierFilter(tx, 'to_ship')})::int as to_ship,
      count(*) filter (where ${supplierFilter(tx, 'partly_shipped')})::int as partly_shipped,
      count(*) filter (where ${supplierFilter(tx, 'shipped')})::int as shipped,
      0 as cancelled_refunded, 0 as payment_pending
    from order_for_supplier v
  `
  return row ?? { all: 0, to_ship: 0, partly_shipped: 0, shipped: 0, cancelled_refunded: 0, payment_pending: 0 }
}

export interface OrderLineRow {
  id: string
  seller_id: string | null
  version_id: string
  product_id: string
  name: string
  version_name: string | null
  sku: string | null
  quantity: number
  /** The price sold at: the merchant side reads the line's discount, tax and total too; a supplier only its price × quantity. */
  unit_amount: string
  line_amount: string
  discount_amount: string | null
  tax_amount: string | null
  line_total_amount: string | null
  fulfilled_quantity: number
  returned_quantity: number
  refunded_quantity: number
  /** Handed to the store by a to-store supplier, for the store to ship on. */
  sent_quantity: number
}

export interface OrderPartRow {
  id: string
  seller_id: string | null
  seller_name: string | null
  shipping_mode: 'store' | 'to-store' | 'to-shopper'
  state: string
  lines: OrderLineRow[]
}

export interface OrderHistoryRow {
  id: string
  action: string
  occurred_at: Date
  actor_kind: string
  actor_label: string | null
  reason: string | null
}

export interface OrderDetailRow {
  id: string
  number: string
  state: 'placed' | 'cancelled'
  placed_at: Date
  currency: string
  customer_name: string | null
  shipping_address: CartAddress | null
  parts: OrderPartRow[]
  /** The merchant side's alone: null for a supplier (ACCESS §7.3). */
  merchant: {
    payment_state: string
    fulfilment_state: string
    payment_method: string | null
    test: boolean
    customer_id: string | null
    email: string | null
    phone: string | null
    billing_address: CartAddress | null
    market_id: string | null
    market_name: string | null
    tax_inclusive: boolean | null
    subtotal_amount: string
    discount_amount: string
    shipping_amount: string
    tax_amount: string
    duties_amount: string
    total_amount: string
    refunded_amount: string
    shipping_option: string | null
    shipping_method_label: string | null
    shopper_note: string | null
    paid_at: Date | null
    payment_due_by: Date | null
    cancelled_at: Date | null
    cancel_reason: string | null
    adjustments: { kind: string; label: string | null; amount: string }[]
    payments: { id: string; provider: string; kind: string; state: string; amount: string; mode: string; captured_at: Date | null }[]
  } | null
}

const merchantLines = (tx: ScopedSql) => tx`
  coalesce((select json_agg(json_build_object('id', l.id, 'seller_id', l.seller_id, 'version_id', l.version_id, 'product_id', l.product_id,
    'name', l.name, 'version_name', l.version_name, 'sku', l.sku, 'quantity', l.quantity, 'unit_amount', l.unit_amount::text,
    'line_amount', (l.unit_amount * l.quantity)::text, 'discount_amount', l.discount_amount::text, 'tax_amount', l.tax_amount::text,
    'line_total_amount', l.line_total_amount::text, 'fulfilled_quantity', l.fulfilled_quantity, 'returned_quantity', l.returned_quantity,
    'refunded_quantity', l.refunded_quantity, 'sent_quantity', (select coalesce(sum(fl.quantity), 0)::int from fulfilment_line fl join fulfilment f on f.id = fl.fulfilment_id where fl.order_line_id = l.id and f.kind = 'sent_to_store')) order by l.position)
  from order_line l where l.order_id = p.order_id and l.seller_id is not distinct from p.seller_id), '[]'::json)`

export const selectMerchantOrder = async (tx: ScopedSql, storeId: string, orderId: string): Promise<OrderDetailRow | null> =>
  (
    await tx<OrderDetailRow[]>`
      select o.id, o.number, o.state, o.placed_at, o.currency, o.shipping_address ->> 'name' as customer_name, o.shipping_address,
        coalesce((select json_agg(json_build_object('id', p.id, 'seller_id', p.seller_id, 'seller_name', s.name, 'shipping_mode', p.shipping_mode,
          'state', p.state, 'lines', ${merchantLines(tx)}) order by p.seller_id is not null, s.name, p.id)
          from order_part p left join seller s on s.id = p.seller_id where p.order_id = o.id), '[]'::json) as parts,
        json_build_object('payment_state', o.payment_state, 'fulfilment_state', o.fulfilment_state, 'payment_method', o.payment_method,
          'test', exists (select 1 from payment m where m.order_id = o.id and m.mode = 'test'), 'customer_id', o.customer_id, 'email', o.email,
          'phone', o.phone, 'billing_address', o.billing_address, 'market_id', o.market_id, 'market_name', mk.name, 'tax_inclusive', o.tax_inclusive,
          'subtotal_amount', o.subtotal_amount::text, 'discount_amount', o.discount_amount::text, 'shipping_amount', o.shipping_amount::text,
          'tax_amount', o.tax_amount::text, 'duties_amount', o.duties_amount::text, 'total_amount', o.total_amount::text,
          'refunded_amount', o.refunded_amount::text, 'shipping_option', o.shipping_option, 'shipping_method_label', o.shipping_method_label,
          'shopper_note', o.shopper_note, 'paid_at', o.paid_at, 'payment_due_by', o.payment_due_by, 'cancelled_at', o.cancelled_at,
          'cancel_reason', o.cancel_reason,
          'adjustments', coalesce((select json_agg(json_build_object('kind', a.kind, 'label', a.label, 'amount', a.amount::text) order by a.kind, a.id)
            from order_adjustment a where a.order_id = o.id), '[]'::json),
          'payments', coalesce((select json_agg(json_build_object('id', m.id, 'provider', m.provider, 'kind', m.kind, 'state', m.state,
            'amount', m.amount::text, 'mode', m.mode, 'captured_at', m.captured_at) order by m.created_at)
            from payment m where m.order_id = o.id), '[]'::json)) as merchant
      from "order" o left join market mk on mk.id = o.market_id
      where o.id = ${orderId} and o.store_id = ${storeId} and o.state <> 'cart'
    `
  )[0] ?? null

export const selectSupplierOrder = async (tx: ScopedSql, orderId: string): Promise<OrderDetailRow | null> =>
  (
    await tx<OrderDetailRow[]>`
      select v.id, v.number, v.state, v.placed_at, v.currency, v.customer_name, v.shipping_address,
        json_build_array(json_build_object('id', v.part_id, 'seller_id', v.seller_id, 'seller_name', null, 'shipping_mode', v.shipping_mode,
          'state', v.part_state, 'lines', coalesce((select json_agg(json_build_object('id', l.id, 'seller_id', l.seller_id, 'version_id', l.version_id,
            'product_id', l.product_id, 'name', l.name, 'version_name', l.version_name, 'sku', l.sku, 'quantity', l.quantity,
            'unit_amount', m.unit_amount::text, 'line_amount', m.line_amount::text, 'discount_amount', null, 'tax_amount', null, 'line_total_amount', null,
            'fulfilled_quantity', l.fulfilled_quantity, 'returned_quantity', l.returned_quantity, 'refunded_quantity', l.refunded_quantity,
            'sent_quantity', (select coalesce(sum(fl.quantity), 0)::int from fulfilment_line fl join fulfilment f on f.id = fl.fulfilment_id where fl.order_line_id = l.id and f.kind = 'sent_to_store')) order by l.position)
            from order_line l join order_line_for_supplier m on m.id = l.id where l.order_id = v.id), '[]'::json))) as parts,
        null as merchant
      from order_for_supplier v where v.id = ${orderId}
    `
  )[0] ?? null

/** The order's history, newest first: the store's own entries on the merchant side, a supplier's thin ones on its own (LOGGING §3). */
export const selectOrderHistory = (tx: ScopedSql, storeId: string, orderId: string, sellerId: string | null, limit: number): Promise<OrderHistoryRow[]> =>
  tx<OrderHistoryRow[]>`
    select a.id, a.action, a.occurred_at, a.actor_kind,
      ${sellerId ? tx`null` : tx`case when a.actor_kind = 'person' then u.name else a.actor_label end`} as actor_label,
      ${sellerId ? tx`null` : tx`a.reason`} as reason
    from activity_log a left join "user" u on ${sellerId ? tx`false` : tx`a.actor_kind = 'person' and u.id::text = a.actor_id`}
    where a.target_type = 'order' and a.target_id = ${orderId} and a.store_id = ${storeId}
      and ${sellerId ? tx`a.seller_id = ${sellerId}` : tx`a.seller_id is null`}
    order by a.occurred_at desc, a.id desc limit ${limit}
  `

/** Whether the merchant side holds this order: a note is only ever added to one. */
export const selectOrderLabel = async (tx: ScopedSql, storeId: string, orderId: string): Promise<string | null> =>
  (await tx<{ number: string }[]>`select number from "order" where id = ${orderId} and store_id = ${storeId} and state <> 'cart'`)[0]?.number ?? null

export interface SaleRow {
  id: string
  number: string
  placed_at: Date
  state: string
  name: string
  version_name: string | null
  sku: string | null
  quantity: number
  refunded_quantity: number
  line_amount: string
  currency: string
}

/** "Your sales" (FIRST-RELEASE §17): a supplier's own sold lines at the price sold, newest first, no totals. */
export const selectMySales = (tx: ScopedSql, window: PageWindow): Promise<SaleRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<SaleRow[]>`
    select l.id, v.number, v.placed_at, v.state, l.name, l.version_name, l.sku, l.quantity, l.refunded_quantity, m.line_amount::text as line_amount, m.currency
    from order_line l join order_line_for_supplier m on m.id = l.id join order_for_supplier v on v.id = l.order_id
    where ${window.after ? tx`(v.placed_at, l.id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(v.placed_at, l.id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by v.placed_at ${backwards ? tx`asc` : tx`desc`}, l.id ${backwards ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `
}

export interface ExportLineRow {
  number: string
  placed_at: Date
  state: string
  payment_state: string | null
  fulfilment_state: string | null
  payment_method: string | null
  part_state: string | null
  shipping_mode: string | null
  customer_name: string | null
  email: string | null
  phone: string | null
  address: CartAddress | null
  supplier_name: string | null
  name: string
  version_name: string | null
  sku: string | null
  quantity: number
  unit_amount: string
  line_amount: string
  line_total_amount: string | null
  total_amount: string | null
  currency: string
}

/** The merchant side's file: one row a line of the orders a chip and search choose, newest first, up to `limit`. */
export const selectMerchantExportLines = (tx: ScopedSql, storeId: string, filter: OrderFilter, search: string | null, limit: number): Promise<ExportLineRow[]> =>
  tx<ExportLineRow[]>`
    select o.number, o.placed_at, o.state, o.payment_state, o.fulfilment_state, o.payment_method, null as part_state, p.shipping_mode,
      o.shipping_address ->> 'name' as customer_name, o.email, o.phone, o.shipping_address as address, s.name as supplier_name,
      l.name, l.version_name, l.sku, l.quantity, l.unit_amount::text as unit_amount, (l.unit_amount * l.quantity)::text as line_amount,
      l.line_total_amount::text as line_total_amount, o.total_amount::text as total_amount, o.currency
    from "order" o join order_line l on l.order_id = o.id
      join order_part p on p.order_id = o.id and p.seller_id is not distinct from l.seller_id left join seller s on s.id = l.seller_id
    where o.store_id = ${storeId} and o.state <> 'cart' and ${merchantFilter(tx, filter)}
      and ${search ? tx`(o.number ilike ${like(search)} or o.shipping_address ->> 'name' ilike ${like(search)})` : tx`true`}
    order by o.placed_at desc, o.id, l.position
    limit ${limit}
  `

/** A supplier's file: its own lines only, at the price sold, the shopper only where its part ships to the shopper (ACCESS §7.3). */
export const selectSupplierExportLines = (tx: ScopedSql, filter: OrderFilter, search: string | null, limit: number): Promise<ExportLineRow[]> =>
  tx<ExportLineRow[]>`
    select v.number, v.placed_at, v.state, null as payment_state, null as fulfilment_state, null as payment_method, v.part_state, v.shipping_mode,
      v.customer_name, null as email, null as phone, v.shipping_address as address, null as supplier_name,
      l.name, l.version_name, l.sku, l.quantity, m.unit_amount::text as unit_amount, m.line_amount::text as line_amount,
      null as line_total_amount, null as total_amount, v.currency
    from order_for_supplier v join order_line l on l.order_id = v.id join order_line_for_supplier m on m.id = l.id
    where ${supplierFilter(tx, filter)} and ${search ? tx`v.number ilike ${like(search)}` : tx`true`}
    order by v.placed_at desc, v.id, l.position
    limit ${limit}
  `
