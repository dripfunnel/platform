import type { PageWindow } from '#core/paging'
import { pgArray, type ScopedSql } from './index'

// Returns, refunds and the supplier ledger (migration 0072; DATA-MODEL §7.6), written in system scope: the engine names
// the store and the caller's owner from its context and holds every line to them, and the database caps each line's refund.

export interface OrderToRefundRow {
  id: string
  number: string
  state: string
  payment_state: string
  payment_method: string | null
  currency: string
  total_amount: string
  refunded_amount: string
}

export const lockOrderToRefund = async (tx: ScopedSql, storeId: string, orderId: string): Promise<OrderToRefundRow | null> =>
  (
    await tx<OrderToRefundRow[]>`
      select id, number, state, payment_state, payment_method, currency, total_amount::text as total_amount, refunded_amount::text as refunded_amount
      from "order" where id = ${orderId} and store_id = ${storeId} and state <> 'cart' for update
    `
  )[0] ?? null

export interface LineToRefundRow {
  id: string
  seller_id: string | null
  version_id: string
  product_id: string
  quantity: number
  fulfilled_quantity: number
  returned_quantity: number
  refunded_quantity: number
  line_total_amount: string
  /** What has been given back on this line so far, across every refund. */
  refunded_amount: string
  /** Units refunded outside any return: like units in a return, no longer free to go back another way. */
  refunded_outside: number
  track_stock: boolean
  shipping_mode: 'store' | 'to-store' | 'to-shopper'
}

export const lockLinesToRefund = (tx: ScopedSql, orderId: string): Promise<LineToRefundRow[]> =>
  tx<LineToRefundRow[]>`
    select l.id, l.seller_id, l.version_id, l.product_id, l.quantity, l.fulfilled_quantity, l.returned_quantity, l.refunded_quantity,
      l.line_total_amount::text as line_total_amount, coalesce(v.track_stock, false) as track_stock, p.shipping_mode,
      (select coalesce(sum(r.amount), 0) from refund_line r where r.order_line_id = l.id)::text as refunded_amount,
      (select coalesce(sum(r.quantity), 0) from refund_line r join refund f on f.id = r.refund_id where r.order_line_id = l.id and f.return_id is null)::int as refunded_outside
    from order_line l join order_part p on p.order_id = l.order_id and p.seller_id is not distinct from l.seller_id
      join product_version v on v.id = l.version_id
    where l.order_id = ${orderId}
    order by l.position
    for update of l
  `

/** Whether anything has left: shipped to the shopper, or handed to the store by a supplier. */
export const anythingShipped = async (tx: ScopedSql, orderId: string): Promise<boolean> => (await tx`select 1 from fulfilment where order_id = ${orderId} limit 1`).length > 0

export interface CapturedPaymentRow {
  id: string
  provider: string
  provider_ref: string | null
  provider_account_id: string | null
  mode: 'test' | 'live'
}

/** The payment the money came in on: a card's captured one, or a cash or transfer one marked paid. */
export const selectCapturedPayment = async (tx: ScopedSql, orderId: string): Promise<CapturedPaymentRow | null> =>
  (
    await tx<CapturedPaymentRow[]>`
      select id, provider, provider_ref, provider_account_id, mode from payment
      where order_id = ${orderId} and state in ('captured', 'refunded') order by captured_at desc nulls last limit 1
    `
  )[0] ?? null

export const insertRefund = async (
  tx: ScopedSql,
  r: { id: string; storeId: string; sellerId: string | null; orderId: string; returnId: string | null; amount: bigint; currency: string; reason: string; note: string | null; restock: boolean; override: boolean; byUserId: string },
  lines: readonly { lineId: string; quantity: number; amount: bigint }[],
): Promise<void> => {
  await tx`
    insert into refund (id, store_id, seller_id, order_id, return_id, amount, currency, reason, note, restock, override_of_seller_id, by_user_id)
    values (${r.id}, ${r.storeId}, ${r.sellerId}, ${r.orderId}, ${r.returnId}, ${r.amount.toString()}, ${r.currency}, ${r.reason}, ${r.note}, ${r.restock}, ${r.override ? r.sellerId : null}, ${r.byUserId})
  `
  if (lines.length === 0) return
  await tx`
    insert into refund_line (refund_id, order_line_id, store_id, seller_id, quantity, amount, currency)
    select ${r.id}, x.line_id, ${r.storeId}, ${r.sellerId}, x.quantity, x.amount, ${r.currency}
    from unnest(${pgArray(lines.map((l) => l.lineId))}::uuid[], ${pgArray(lines.map((l) => String(l.quantity)))}::int[], ${pgArray(lines.map((l) => l.amount.toString()))}::bigint[]) as x(line_id, quantity, amount)
  `
  await addToLines(tx, 'refunded_quantity', lines.map((l) => ({ lineId: l.lineId, quantity: l.quantity })))
}

/** Moves each line's returned or refunded count by its quantity, in one statement; a negative one takes back, never below 0. */
const addToLines = async (tx: ScopedSql, column: 'returned_quantity' | 'refunded_quantity', lines: readonly { lineId: string; quantity: number }[]): Promise<void> => {
  if (lines.length === 0) return
  await tx`
    update order_line o set ${tx(column)} = greatest(o.${tx(column)} + x.q, 0)
    from unnest(${pgArray(lines.map((l) => l.lineId))}::uuid[], ${pgArray(lines.map((l) => String(l.quantity)))}::int[]) as x(id, q)
    where o.id = x.id
  `
}

/** The order's refunded total moves on, and its payment state with it: refunded once everything has gone back. */
export const addRefunded = async (tx: ScopedSql, orderId: string, amount: bigint, now: Date): Promise<void> => {
  await tx`
    update "order" set refunded_amount = refunded_amount + ${amount.toString()},
      payment_state = case when refunded_amount + ${amount.toString()} >= total_amount then 'refunded' else 'partly_refunded' end,
      updated_at = ${now}, revision = revision + 1
    where id = ${orderId}
  `
}

export const insertPaymentRefund = async (tx: ScopedSql, p: { refundId: string; paymentId: string; storeId: string; providerRef: string | null; state: 'pending' | 'done' | 'failed'; amount: bigint; currency: string }): Promise<void> => {
  await tx`
    insert into payment_refund (refund_id, payment_id, store_id, provider_ref, state, amount, currency)
    values (${p.refundId}, ${p.paymentId}, ${p.storeId}, ${p.providerRef}, ${p.state}, ${p.amount.toString()}, ${p.currency})
  `
}

export const markPaymentRefunded = async (tx: ScopedSql, paymentId: string, now: Date): Promise<void> => {
  await tx`update payment set state = 'refunded', updated_at = ${now} where id = ${paymentId}`
}

export const insertLedgerEntry = async (tx: ScopedSql, e: { storeId: string; sellerId: string; amount: bigint; currency: string; refundId: string; createdBy: string }): Promise<void> => {
  await tx`
    insert into supplier_ledger_entry (store_id, seller_id, amount, currency, kind, refund_id, created_by)
    values (${e.storeId}, ${e.sellerId}, ${e.amount.toString()}, ${e.currency}, 'refund_override', ${e.refundId}, ${e.createdBy})
  `
}

export interface Restocked {
  sellerId: string | null
  productId: string
  versionId: string
  warehouseId: string
  quantity: number
}

/** Puts returned units back on hand where they came back to, as "Returned by a shopper" (DATA-MODEL §7.4), in two statements. */
export const restockReturned = async (tx: ScopedSql, s: { storeId: string; returnId: string | null; orderId: string; actorId: string }, items: readonly Restocked[]): Promise<void> => {
  const totals = new Map<string, Restocked>()
  for (const i of items) {
    const key = `${i.versionId}:${i.warehouseId}`
    totals.set(key, { ...i, quantity: (totals.get(key)?.quantity ?? 0) + i.quantity })
  }
  const rows = [...totals.values()]
  if (rows.length === 0) return
  const versions = pgArray(rows.map((r) => r.versionId))
  const warehouses = pgArray(rows.map((r) => r.warehouseId))
  const quantities = pgArray(rows.map((r) => String(r.quantity)))
  const sellers = pgArray(rows.map((r) => r.sellerId ?? ''))
  await tx`
    insert into stock_level (version_id, warehouse_id, store_id, seller_id, on_hand)
    select x.v, x.w, ${s.storeId}, nullif(x.seller, '')::uuid, x.q from unnest(${versions}::uuid[], ${warehouses}::uuid[], ${sellers}::text[], ${quantities}::int[]) as x(v, w, seller, q)
    on conflict (version_id, warehouse_id) do update set on_hand = stock_level.on_hand + excluded.on_hand, updated_at = now()
  `
  await tx`
    insert into stock_movement (store_id, seller_id, product_id, version_id, warehouse_id, delta, resulting_quantity, reason, source_kind, source_id, actor_kind, actor_id)
    select ${s.storeId}, nullif(x.seller, '')::uuid, x.product, x.v, x.w, x.q, l.on_hand, 'returned', ${s.returnId ? 'return' : 'order'}, ${s.returnId ?? s.orderId}, 'person', ${s.actorId}
    from unnest(${versions}::uuid[], ${warehouses}::uuid[], ${pgArray(rows.map((r) => r.productId))}::uuid[], ${sellers}::text[], ${quantities}::int[]) as x(v, w, product, seller, q)
    join stock_level l on l.version_id = x.v and l.warehouse_id = x.w
  `
}

/** Each owner's default location (null, the merchant's), where its returned items come back to; an owner without one is left out. */
export const defaultWarehousesOf = async (tx: ScopedSql, storeId: string, sellerIds: readonly (string | null)[]): Promise<Map<string | null, string>> => {
  const owners = [...new Set(sellerIds)]
  const rows = await tx<{ id: string; seller_id: string | null }[]>`
    select id, seller_id from warehouse
    where store_id = ${storeId} and is_default and deleted_at is null
      and (seller_id = any(${pgArray(owners.filter((o): o is string => o !== null))}::uuid[]) or (${owners.includes(null)} and seller_id is null))
  `
  return new Map(rows.map((r) => [r.seller_id, r.id]))
}

export const insertReturn = async (
  tx: ScopedSql,
  r: { storeId: string; orderId: string; orderNumber: string; reason: string; note: string | null; createdBy: string },
  lines: readonly { lineId: string; sellerId: string | null; quantity: number; destination: string }[],
): Promise<{ id: string; number: string }> => {
  const [{ n } = { n: 0 }] = await tx<{ n: number }[]>`select count(*)::int as n from "return" where order_id = ${r.orderId}`
  const number = `R${r.orderNumber}-${n + 1}`
  const [row] = await tx<{ id: string }[]>`
    insert into "return" (store_id, order_id, number, reason, note, created_by) values (${r.storeId}, ${r.orderId}, ${number}, ${r.reason}, ${r.note}, ${r.createdBy}) returning id
  `
  const id = row?.id ?? ''
  await tx`
    insert into return_line (return_id, order_line_id, store_id, seller_id, quantity, destination_warehouse_id)
    select ${id}, x.line_id, ${r.storeId}, nullif(x.seller, '')::uuid, x.q, x.w
    from unnest(${pgArray(lines.map((l) => l.lineId))}::uuid[], ${pgArray(lines.map((l) => l.sellerId ?? ''))}::text[], ${pgArray(lines.map((l) => String(l.quantity)))}::int[],
      ${pgArray(lines.map((l) => l.destination))}::uuid[]) as x(line_id, seller, q, w)
  `
  await addToLines(tx, 'returned_quantity', lines)
  return { id, number }
}

export interface ReturnToChangeRow {
  id: string
  order_id: string
  number: string
  order_number: string
  state: string
  /** Each line's units in the return, and how many of them this return's refunds have taken. */
  lines: { order_line_id: string; seller_id: string | null; quantity: number; refunded: number; destination_warehouse_id: string }[]
}

export const lockReturn = async (tx: ScopedSql, storeId: string, returnId: string): Promise<ReturnToChangeRow | null> =>
  (
    await tx<ReturnToChangeRow[]>`
      select r.id, r.order_id, r.number, o.number as order_number, r.state,
        coalesce((select json_agg(json_build_object('order_line_id', l.order_line_id, 'seller_id', l.seller_id, 'quantity', l.quantity, 'destination_warehouse_id', l.destination_warehouse_id,
          'refunded', (select coalesce(sum(rl.quantity), 0) from refund_line rl join refund f on f.id = rl.refund_id where f.return_id = r.id and rl.order_line_id = l.order_line_id)))
          from return_line l where l.return_id = r.id), '[]'::json) as lines
      from "return" r join "order" o on o.id = r.order_id
      where r.id = ${returnId} and r.store_id = ${storeId}
      for update of r
    `
  )[0] ?? null

export const setReturnState = async (tx: ScopedSql, returnId: string, state: 'received' | 'cancelled' | 'refunded', now: Date): Promise<void> => {
  await tx`
    update "return" set state = ${state},
      received_at = case when ${state} = 'received' then ${now}::timestamptz else received_at end,
      cancelled_at = case when ${state} = 'cancelled' then ${now}::timestamptz else cancelled_at end
    where id = ${returnId}
  `
}

/** A cancelled return's units are no longer on their way back. */
export const unreturn = async (tx: ScopedSql, lines: readonly { order_line_id: string; quantity: number }[]): Promise<void> => {
  await addToLines(tx, 'returned_quantity', lines.map((l) => ({ lineId: l.order_line_id, quantity: -l.quantity })))
}

/** Whether every unit a return holds has been refunded, so the return is done. */
export const returnFullyRefunded = async (tx: ScopedSql, returnId: string): Promise<boolean> =>
  (
    await tx<{ done: boolean }[]>`
      select coalesce(bool_and(coalesce((select sum(rl.quantity) from refund_line rl join refund f on f.id = rl.refund_id where f.return_id = ${returnId} and rl.order_line_id = l.order_line_id), 0) >= l.quantity), false) as done
      from return_line l where l.return_id = ${returnId}
    `
  )[0]?.done ?? false

export interface ReturnRow {
  id: string
  number: string
  state: string
  reason: string
  note: string | null
  received_at: Date | null
  cancelled_at: Date | null
  created_at: Date
  lines: { line_id: string; quantity: number; warehouse_id: string }[]
}

/** An order's returns as the caller reads them: the merchant side every one with its note, a supplier those with its lines, without. */
export const selectReturns = (tx: ScopedSql, orderId: string, supplier: boolean): Promise<ReturnRow[]> =>
  supplier
    ? tx<ReturnRow[]>`
        select r.id, r.number, r.state, r.reason, null as note, r.received_at, r.cancelled_at, r.created_at,
          coalesce((select json_agg(json_build_object('line_id', l.order_line_id, 'quantity', l.quantity, 'warehouse_id', l.destination_warehouse_id)) from return_line l where l.return_id = r.id), '[]'::json) as lines
        from return_for_supplier r where r.order_id = ${orderId} order by r.created_at`
    : tx<ReturnRow[]>`
        select r.id, r.number, r.state, r.reason, r.note, r.received_at, r.cancelled_at, r.created_at,
          coalesce((select json_agg(json_build_object('line_id', l.order_line_id, 'quantity', l.quantity, 'warehouse_id', l.destination_warehouse_id)) from return_line l where l.return_id = r.id), '[]'::json) as lines
        from "return" r where r.order_id = ${orderId} order by r.created_at`

export interface RefundRow {
  id: string
  seller_id: string | null
  return_id: string | null
  amount: string
  currency: string
  reason: string
  note: string | null
  restock: boolean
  override: boolean
  created_at: Date
  /** The money's state at the provider: null to a supplier, which never reads payments. */
  payment_state: string | null
  lines: { line_id: string; quantity: number; amount: string }[]
}

export const selectRefunds = (tx: ScopedSql, orderId: string, supplier: boolean): Promise<RefundRow[]> => tx<RefundRow[]>`
  select f.id, f.seller_id, f.return_id, f.amount::text as amount, f.currency, f.reason, ${supplier ? tx`null` : tx`f.note`} as note, f.restock,
    f.override_of_seller_id is not null as override, f.created_at,
    ${supplier ? tx`null` : tx`(select p.state from payment_refund p where p.refund_id = f.id order by p.created_at desc limit 1)`} as payment_state,
    coalesce((select json_agg(json_build_object('line_id', l.order_line_id, 'quantity', l.quantity, 'amount', l.amount::text)) from refund_line l where l.refund_id = f.id), '[]'::json) as lines
  from refund f where f.order_id = ${orderId} order by f.created_at, f.id`

export interface LedgerRow {
  id: string
  seller_id: string
  seller_name: string | null
  amount: string
  currency: string
  kind: string
  refund_id: string | null
  order_number: string | null
  created_at: Date
}

/** A supplier's ledger, newest first: the merchant side reads any supplier's, a supplier its own (policy). */
export const selectLedger = (tx: ScopedSql, storeId: string, sellerId: string, supplier: boolean, window: PageWindow): Promise<LedgerRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<LedgerRow[]>`
    select e.id, e.seller_id, s.name as seller_name, e.amount::text as amount, e.currency, e.kind, e.refund_id,
      (select o.number from refund f join ${supplier ? tx`order_for_supplier` : tx`"order"`} o on o.id = f.order_id where f.id = e.refund_id) as order_number, e.created_at
    from supplier_ledger_entry e left join seller s on s.id = e.seller_id
    where e.store_id = ${storeId} and e.seller_id = ${sellerId}
      and ${window.after ? tx`(e.created_at, e.id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(e.created_at, e.id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by e.created_at ${backwards ? tx`asc` : tx`desc`}, e.id ${backwards ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `
}

/** What the supplier owes the store (positive) or is owed, per currency. */
export const selectLedgerBalance = (tx: ScopedSql, storeId: string, sellerId: string): Promise<{ amount: string; currency: string }[]> =>
  tx<{ amount: string; currency: string }[]>`
    select sum(amount)::text as amount, currency from supplier_ledger_entry where store_id = ${storeId} and seller_id = ${sellerId} group by currency order by currency
  `
