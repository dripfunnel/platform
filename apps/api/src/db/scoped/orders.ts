import type { CartGift } from './cart'
import { handedOut } from './deliveries'
import { restoreGiftCard } from './giftCards'
import { pgArray, type ScopedSql } from './index'
import { releaseUses } from './promotions'

// Placing an order and paying for it (migration 0068; DATA-MODEL §7.6), in system scope: the engine has priced the cart as
// its shopper, and these queries write the snapshot, the number, the stock held and the payment for the store named.

export interface CartToPlaceRow {
  id: string
  customer_id: string | null
  email: string | null
  phone: string | null
  currency: string
}

/** The cart, locked; null once it has been placed (a second press of "Pay" finds nothing). */
export const lockCart = async (tx: ScopedSql, storeId: string, orderId: string): Promise<(CartToPlaceRow & { revision: number }) | null> =>
  (await tx<(CartToPlaceRow & { revision: number })[]>`select id, customer_id, email, phone, currency, revision from "order" where id = ${orderId} and store_id = ${storeId} and state = 'cart' for update`)[0] ?? null

export interface SnapshotVersionRow {
  id: string
  product_id: string
  seller_id: string | null
  shipping_mode: 'store' | 'to-store' | 'to-shopper'
  hs_code: string | null
  weight_grams: number | null
  track_stock: boolean
  continue_selling: boolean
}

export const selectSnapshotVersions = (tx: ScopedSql, storeId: string, ids: readonly string[]): Promise<SnapshotVersionRow[]> =>
  tx<SnapshotVersionRow[]>`
    select v.id, v.product_id, p.seller_id, coalesce(s.shipping_mode, 'store') as shipping_mode, v.hs_code, v.weight_grams, v.track_stock, v.continue_selling
    from product_version v join product p on p.id = v.product_id left join seller s on s.id = p.seller_id
    where v.store_id = ${storeId} and v.id = any (${pgArray(ids)}::uuid[])
  `

/** Holds a line at the one location with most left, locked, which must have it all unless the version sells on (DATA-MODEL §7.6); `short` when it held past what was free. */
export const reserveLine = async (tx: ScopedSql, storeId: string, versionId: string, quantity: number, sellsOn: boolean): Promise<{ warehouseId: string | null; short: boolean } | null> => {
  const levels = await tx<{ warehouse_id: string; free: number }[]>`
    select l.warehouse_id, l.on_hand - l.reserved as free from stock_level l join warehouse w on w.id = l.warehouse_id and w.deleted_at is null
    where l.store_id = ${storeId} and l.version_id = ${versionId}
    order by l.on_hand - l.reserved desc, l.warehouse_id
    for update of l
  `
  const at = levels[0]
  if ((at?.free ?? 0) < quantity && !sellsOn) return null
  if (!at) return { warehouseId: null, short: true }
  await tx`update stock_level set reserved = reserved + ${quantity}, updated_at = now() where version_id = ${versionId} and warehouse_id = ${at.warehouse_id}`
  return { warehouseId: at.warehouse_id, short: at.free < quantity }
}

/** Moves the store's order counter on and answers the number it gives this order. */
export const takeOrderNumber = async (tx: ScopedSql, storeId: string): Promise<string> => {
  const [row] = await tx<{ prefix: string | null; n: number }[]>`
    update store set next_order_number = next_order_number + 1 where id = ${storeId} returning order_prefix as prefix, next_order_number - 1 as n
  `
  if (!row) throw new Error('store: no counter')
  return `${row.prefix ?? ''}${row.n}`
}

export interface SnapshotLine {
  versionId: string
  productId: string
  sellerId: string | null
  name: string
  versionName: string | null
  sku: string | null
  hsCode: string | null
  taxClassId: string | null
  taxRateBps: number | null
  quantity: number
  unitAmount: bigint
  /** What the offers took off this line (fact 11: spread over the lines in one place). */
  discountAmount: bigint
  taxAmount: bigint
  lineTotalAmount: bigint
  weightGrams: number | null
  reservedWarehouseId: string | null
  /** A gift card's recipient and day, as the cart held them (migration 0171). */
  gift: CartGift | null
}

export interface OrderSnapshot {
  orderId: string
  number: string
  lines: readonly SnapshotLine[]
  parts: readonly { sellerId: string | null; shippingMode: 'store' | 'to-store' | 'to-shopper' }[]
  /** `label` is a courier's own service name; null for flat delivery and collection, which the storefront words itself. */
  shipping: { amount: bigint; label: string | null } | null
  /** The cart's choice, or null when nothing in it is sent (CATALOG T14). */
  shippingOption: 'courier' | 'flat' | 'pickup' | null
  tax: { amount: bigint; inclusive: boolean }
  /** Each offer taken, named as shoppers see it (OFFERS fact 13); `discount` is their sum, delivery's included. */
  discounts: readonly { promotionId: string; codeId: string | null; label: string; amount: bigint }[]
  discount: bigint
  subtotal: bigint
  total: bigint
  paymentMethod: string
  paymentDueBy: Date | null
  stockReserved: boolean
  now: Date
}

export const writeSnapshot = async (tx: ScopedSql, storeId: string, s: OrderSnapshot): Promise<void> => {
  for (const [position, l] of s.lines.entries()) {
    await tx`
      insert into order_line (order_id, store_id, seller_id, version_id, product_id, name, version_name, sku, hs_code, tax_class_id, tax_rate_bps,
        quantity, unit_amount, discount_amount, tax_amount, line_total_amount, weight_grams, reserved_warehouse_id, position,
        gift_recipient_name, gift_recipient_email, gift_message, gift_send_on)
      values (${s.orderId}, ${storeId}, ${l.sellerId}, ${l.versionId}, ${l.productId}, ${l.name}, ${l.versionName}, ${l.sku}, ${l.hsCode}, ${l.taxClassId}, ${l.taxRateBps},
        ${l.quantity}, ${l.unitAmount.toString()}, ${l.discountAmount.toString()}, ${l.taxAmount.toString()}, ${l.lineTotalAmount.toString()}, ${l.weightGrams}, ${l.reservedWarehouseId}, ${position},
        ${l.gift?.recipientName ?? null}, ${l.gift?.recipientEmail ?? null}, ${l.gift?.message ?? null}, ${l.gift?.sendOn ?? null}::date)
    `
  }
  for (const p of s.parts) {
    await tx`insert into order_part (order_id, store_id, seller_id, shipping_mode) values (${s.orderId}, ${storeId}, ${p.sellerId}, ${p.shippingMode})`
  }
  if (s.shipping) await tx`insert into order_adjustment (order_id, store_id, kind, label, amount) values (${s.orderId}, ${storeId}, 'shipping', ${s.shipping.label}, ${s.shipping.amount.toString()})`
  for (const d of s.discounts) {
    await tx`insert into order_adjustment (order_id, store_id, kind, label, amount, promotion_id, promotion_code_id) values (${s.orderId}, ${storeId}, 'discount', ${d.label}, ${d.amount.toString()}, ${d.promotionId}, ${d.codeId})`
  }
  if (s.tax.amount > 0n) await tx`insert into order_adjustment (order_id, store_id, kind, label, amount) values (${s.orderId}, ${storeId}, 'tax', null, ${s.tax.amount.toString()})`
  await tx`
    update "order" set state = 'placed', number = ${s.number}, placed_at = ${s.now}, tax_inclusive = ${s.tax.inclusive},
      subtotal_amount = ${s.subtotal.toString()}, discount_amount = ${s.discount.toString()}, shipping_amount = ${(s.shipping?.amount ?? 0n).toString()}, tax_amount = ${s.tax.amount.toString()},
      total_amount = ${s.total.toString()}, shipping_method_label = ${s.shipping?.label ?? null}, shipping_option = ${s.shippingOption}, payment_method = ${s.paymentMethod},
      payment_due_by = ${s.paymentDueBy}, stock_reserved = ${s.stockReserved}, checkout_step = null, cart_expires_at = null,
      updated_at = ${s.now}, revision = revision + 1
    where id = ${s.orderId} and store_id = ${storeId}
  `
}

/** `id` is the attempt's, when the provider was given it before the row could be written. */
export const insertPayment = async (tx: ScopedSql, p: { id?: string; orderId: string; storeId: string; provider: string; accountId: string | null; kind: string; amount: bigint; currency: string; mode: 'test' | 'live'; providerRef: string | null }): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into payment (id, order_id, store_id, provider, provider_account_id, kind, amount, currency, mode, provider_ref)
    values (${p.id ?? crypto.randomUUID()}, ${p.orderId}, ${p.storeId}, ${p.provider}, ${p.accountId}, ${p.kind}, ${p.amount.toString()}, ${p.currency}, ${p.mode}, ${p.providerRef})
    returning id
  `
  if (!row) throw new Error('payment: insert returned no row')
  return row.id
}

export interface PlacedOrderRow {
  id: string
  number: string
  state: string
  payment_state: string
  payment_method: string | null
  total_amount: string
  currency: string
  stock_reserved: boolean
}

export const lockPlacedOrder = async (tx: ScopedSql, storeId: string, orderId: string): Promise<PlacedOrderRow | null> =>
  (
    await tx<PlacedOrderRow[]>`
      select id, number, state, payment_state, payment_method, total_amount::text as total_amount, currency, stock_reserved
      from "order" where id = ${orderId} and store_id = ${storeId} and state <> 'cart' for update
    `
  )[0] ?? null

/** A preview storefront's order, paid in test mode: no shopper is told of it and no webhook hears of it (storefront ARCHITECTURE §4.1). */
export const orderIsTest = async (tx: ScopedSql, orderId: string): Promise<boolean> =>
  (await tx`select 1 from payment where order_id = ${orderId} and mode = 'test' limit 1`).length > 0

/** Paid: the order and its pending payment both, at once. */
export const recordPaid = async (tx: ScopedSql, storeId: string, orderId: string, now: Date): Promise<void> => {
  await tx`update "order" set payment_state = 'paid', paid_at = ${now}, payment_due_by = null, updated_at = ${now}, revision = revision + 1 where id = ${orderId} and store_id = ${storeId}`
  await tx`update payment set state = 'captured', captured_at = ${now}, updated_at = ${now} where order_id = ${orderId} and store_id = ${storeId} and state in ('pending', 'authorised')`
}

/** Gives back each line's held stock where it was held: what hasn't left yet, shipped or handed to the store (#310). */
export const releaseStock = async (tx: ScopedSql, storeId: string, orderId: string): Promise<void> => {
  await tx`
    update stock_level l set reserved = greatest(l.reserved - x.quantity, 0), updated_at = now()
    from (select o.version_id, o.reserved_warehouse_id, sum(o.quantity - greatest(o.fulfilled_quantity,
            coalesce((select sum(fl.quantity) from fulfilment_line fl join fulfilment f on f.id = fl.fulfilment_id where fl.order_line_id = o.id and f.kind = 'sent_to_store'), 0)))::int as quantity
          from order_line o
          where o.order_id = ${orderId} and o.store_id = ${storeId} and o.reserved_warehouse_id is not null group by o.version_id, o.reserved_warehouse_id) x
    where l.version_id = x.version_id and l.warehouse_id = x.reserved_warehouse_id
  `
}

export const cancelOrder = async (tx: ScopedSql, storeId: string, orderId: string, reason: 'unpaid_transfer' | 'unpaid' | 'shopper' | 'store' | 'out_of_stock', now: Date): Promise<void> => {
  // An unpaid order gives its gift card back whole; a paid one's share went back with its refund (orders/refunds.ts).
  const [unpaid] = await tx<{ amount: string }[]>`select gift_card_amount::text as amount from "order" where id = ${orderId} and store_id = ${storeId} and payment_state = 'pending' and state = 'placed'`
  if (unpaid) await restoreGiftCard(tx, storeId, orderId, BigInt(unpaid.amount), now)
  await tx`
    update "order" set state = 'cancelled', cancelled_at = ${now}, cancel_reason = ${reason}, stock_reserved = false, payment_due_by = null, updated_at = ${now}, revision = revision + 1
    where id = ${orderId} and store_id = ${storeId}
  `
  await tx`update payment set state = 'failed', updated_at = ${now} where order_id = ${orderId} and store_id = ${storeId} and state = 'pending'`
  await tx`update order_part set state = 'cancelled' where order_id = ${orderId} and store_id = ${storeId}`
  await releaseUses(tx, storeId, orderId)
}

/** Orders unpaid past their time (a transfer's 3 days, a card's day), oldest first, a batch at a time; each is locked when let go. */
export const selectUnpaidOrders = (tx: ScopedSql, now: Date, limit: number): Promise<{ id: string; store_id: string; partner_id: string; number: string; payment_method: string | null }[]> =>
  tx<{ id: string; store_id: string; partner_id: string; number: string; payment_method: string | null }[]>`
    select o.id, o.store_id, s.partner_id, o.number, o.payment_method from "order" o join store s on s.id = o.store_id
    where o.state = 'placed' and o.payment_state = 'pending' and o.payment_due_by is not null and o.payment_due_by <= ${now}
    order by o.payment_due_by limit ${limit}
  `

export interface PaymentAccountRow {
  id: string
  provider: string
  mode: 'test' | 'live'
  public_key: string | null
  bank_details: string | null
  position: number
}

/** The ways the store takes payment now, as checkout shows them. */
export const selectLivePaymentAccounts = (tx: ScopedSql, storeId: string): Promise<PaymentAccountRow[]> =>
  tx<PaymentAccountRow[]>`
    select id, provider, mode, public_key, bank_details, position from payment_provider_account
    where store_id = ${storeId} and status = 'live' and not paused_by_plan order by position, provider
  `

export interface ShopOrderRow {
  id: string
  number: string
  state: 'placed' | 'cancelled'
  payment_state: string
  payment_method: string | null
  email: string | null
  phone: string | null
  currency: string
  subtotal_amount: string
  discount_amount: string
  shipping_amount: string
  tax_amount: string
  total_amount: string
  /** What a gift card paid (migration 0172). */
  gift_card_amount: string
  tax_inclusive: boolean
  shipping_method_label: string | null
  shipping_option: 'courier' | 'flat' | 'pickup' | null
  placed_at: Date
  payment_due_by: Date | null
  lines: { name: string; version_name: string | null; quantity: number; unit_amount: string; line_total_amount: string; gift: { recipientName: string; recipientEmail: string; sendOn: string | null } | null }[]
  /** Each paid download's grant, and each key the order took (migration 0171): none before payment. */
  downloads: { id: string; name: string; uses_left: number; expires_at: string }[]
  keys: { name: string; key: string }[]
  /** The discount lines, named as the shopper saw them (OFFERS fact 13). */
  discounts: { label: string | null; amount: string }[]
}

/** A shopper's own placed order, as its policy lets it read one (its account's, or a guest's by its token). */
export const selectShopOrder = async (tx: ScopedSql, storeId: string, orderId: string): Promise<ShopOrderRow | null> =>
  (
    await tx<ShopOrderRow[]>`
      select o.id, o.number, o.state, o.payment_state, o.payment_method, o.email, o.phone, o.currency, o.subtotal_amount::text as subtotal_amount,
        o.discount_amount::text as discount_amount, o.shipping_amount::text as shipping_amount, o.tax_amount::text as tax_amount, o.total_amount::text as total_amount, o.gift_card_amount::text as gift_card_amount, o.tax_inclusive,
        o.shipping_method_label, o.shipping_option, o.placed_at, o.payment_due_by,
        coalesce((select json_agg(json_build_object('name', l.name, 'version_name', l.version_name, 'quantity', l.quantity,
          'unit_amount', l.unit_amount::text, 'line_total_amount', l.line_total_amount::text, 'gift', case when l.gift_recipient_email is null then null
            else json_build_object('recipientName', l.gift_recipient_name, 'recipientEmail', l.gift_recipient_email, 'sendOn', l.gift_send_on) end) order by l.position)
          from order_line l where l.order_id = o.id), '[]'::json) as lines,
        coalesce((select json_agg(json_build_object('id', d.id, 'name', l.name, 'uses_left', d.uses_left, 'expires_at', d.expires_at) order by l.position)
          from order_download d join order_line l on l.id = d.order_line_id where d.order_id = o.id and ${handedOut(tx)}), '[]'::json) as downloads,
        coalesce((select json_agg(json_build_object('name', l.name, 'key', k.key) order by l.position, k.id)
          from licence_key k join order_line l on l.id = k.order_line_id where l.order_id = o.id and ${handedOut(tx)}), '[]'::json) as keys,
        coalesce((select json_agg(json_build_object('label', a.label, 'amount', a.amount::text) order by a.label, a.id) from order_adjustment a where a.order_id = o.id and a.kind = 'discount'), '[]'::json) as discounts
      from "order" o where o.id = ${orderId} and o.store_id = ${storeId} and o.state <> 'cart'
    `
  )[0] ?? null

export interface PaymentSetupRow {
  id: string
  provider: string
  mode: 'test' | 'live'
  status: 'live' | 'off'
  bank_details: string | null
  external_account_id: string | null
  connected_at: Date
}

export const selectPaymentSetup = (tx: ScopedSql, storeId: string): Promise<PaymentSetupRow[]> =>
  tx<PaymentSetupRow[]>`select id, provider, mode, status, bank_details, external_account_id, connected_at from payment_provider_account where store_id = ${storeId} order by position, provider, mode`

/** A way paid later turned on, with a transfer's bank details; its row made the first time. */
export const saveManualMethod = async (tx: ScopedSql, storeId: string, provider: 'cod' | 'bank_transfer', bankDetails: string | null, now: Date): Promise<void> => {
  await tx`
    insert into payment_provider_account (store_id, provider, bank_details, status) values (${storeId}, ${provider}, ${bankDetails}, 'live')
    on conflict (store_id, provider, mode) do update set bank_details = excluded.bank_details, status = 'live', updated_at = ${now}
  `
}

export const turnOffMethod = async (tx: ScopedSql, storeId: string, provider: string, now: Date): Promise<boolean> =>
  (await tx`update payment_provider_account set status = 'off', updated_at = ${now} where store_id = ${storeId} and provider = ${provider} and status = 'live'`).count > 0

export const selectStoreCountry = async (tx: ScopedSql, storeId: string): Promise<string | null> =>
  (await tx<{ country: string | null }[]>`select country from store where id = ${storeId}`)[0]?.country ?? null
