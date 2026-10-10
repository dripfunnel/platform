import type postgres from 'postgres'
import { pgArray, type ScopedSql } from './index'

// A shopper's cart (migration 0066): an order in state `cart` holding what the shopper chose, read and written as app_shop,
// whose policies keep it to the shopper's own account or the guest token it presented.

export interface CartAddress {
  name: string
  line1: string
  line2: string | null
  city: string
  region: string | null
  postalCode: string | null
  country: string
  phone: string | null
}

export interface CartRow {
  id: string
  customer_id: string | null
  email: string | null
  phone: string | null
  currency: string
  market_id: string | null
  shipping_address: CartAddress | null
  billing_address: CartAddress | null
  shipping_option: 'courier' | 'flat' | 'pickup' | null
  shopper_note: string | null
  checkout_step: 'contact' | 'ship' | 'pay' | null
  revision: number
  /** The codes the shopper typed, as typed after normalising; the engine decides what each does (OFFERS fact 6). */
  promotion_codes: string[]
  lines: { version_id: string; quantity: number }[]
}

/** The shopper's open cart: the guest token's when one was presented, else the account's latest. */
export const selectCart = async (tx: ScopedSql, storeId: string, now: Date): Promise<CartRow | null> =>
  (
    await tx<CartRow[]>`
      select o.id, o.customer_id, o.email, o.phone, o.currency, o.market_id, o.shipping_address, o.billing_address, o.shipping_option,
        o.shopper_note, o.checkout_step, o.revision, to_json(o.promotion_codes) as promotion_codes,
        coalesce((select json_agg(json_build_object('version_id', l.version_id, 'quantity', l.quantity) order by l.added_at, l.version_id) from cart_line l where l.order_id = o.id), '[]'::json) as lines
      from "order" o
      where o.store_id = ${storeId} and o.state = 'cart' and (o.cart_expires_at is null or o.cart_expires_at > ${now})
      order by (o.customer_id is null) desc, o.updated_at desc
      limit 1
    `
  )[0] ?? null

/** Holds the cart's row to the end of the transaction, so two changes from two tabs apply one after the other. */
export const lockCartRow = async (tx: ScopedSql, storeId: string, id: string): Promise<void> => {
  await tx`select id from "order" where id = ${id} and store_id = ${storeId} and state = 'cart' for update`
}

/** The guest cart the request's token opens, which the policy alone decides (migration 0066). */
export const selectGuestCartId = async (tx: ScopedSql, storeId: string): Promise<string | null> =>
  (await tx<{ id: string }[]>`select id from "order" where store_id = ${storeId} and state = 'cart' and customer_id is null limit 1`)[0]?.id ?? null

export const insertCart = async (tx: ScopedSql, storeId: string, c: { customerId: string | null; tokenHash: string | null; currency: string; marketId: string | null; language: string; expiresAt: Date }): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into "order" (store_id, customer_id, currency, market_id, language, cart_expires_at, access_token_hash)
    values (${storeId}, ${c.customerId}, ${c.currency}, ${c.marketId}, ${c.language}, ${c.expiresAt}, ${c.tokenHash})
    returning id
  `
  if (!row) throw new Error('order: cart insert returned no row')
  return row.id
}

/** How many of this version the cart holds; 0 takes the line out. */
export const setCartLine = async (tx: ScopedSql, storeId: string, orderId: string, versionId: string, quantity: number): Promise<void> => {
  if (quantity === 0) {
    await tx`delete from cart_line where order_id = ${orderId} and version_id = ${versionId}`
    return
  }
  await tx`
    insert into cart_line (order_id, store_id, version_id, quantity) values (${orderId}, ${storeId}, ${versionId}, ${quantity})
    on conflict (order_id, version_id) do update set quantity = excluded.quantity
  `
}

export interface CartPatch {
  email?: string | null
  phone?: string | null
  shopperNote?: string | null
  shippingAddress?: CartAddress | null
  billingAddress?: CartAddress | null
  shippingOption?: 'courier' | 'flat' | 'pickup' | null
  checkoutStep?: 'contact' | 'ship' | 'pay' | null
  customerId?: string
  promotionCodes?: readonly string[]
}

/** Writes what changed, moves the revision and the expiry on; false when the cart is no longer the shopper's. */
export const updateCart = async (tx: ScopedSql, id: string, patch: CartPatch, c: { currency: string; marketId: string | null; language: string; expiresAt: Date; now: Date }): Promise<boolean> => {
  const has = (k: keyof CartPatch) => k in patch
  return (
    await tx`
      update "order" set
        email = ${has('email') ? (patch.email ?? null) : tx`email`},
        phone = ${has('phone') ? (patch.phone ?? null) : tx`phone`},
        shopper_note = ${has('shopperNote') ? (patch.shopperNote ?? null) : tx`shopper_note`},
        shipping_address = ${has('shippingAddress') ? (patch.shippingAddress ? tx.json(patch.shippingAddress as unknown as postgres.JSONValue) : null) : tx`shipping_address`},
        billing_address = ${has('billingAddress') ? (patch.billingAddress ? tx.json(patch.billingAddress as unknown as postgres.JSONValue) : null) : tx`billing_address`},
        shipping_option = ${has('shippingOption') ? (patch.shippingOption ?? null) : tx`shipping_option`},
        checkout_step = ${has('checkoutStep') ? (patch.checkoutStep ?? null) : tx`checkout_step`},
        customer_id = ${patch.customerId ?? tx`customer_id`},
        promotion_codes = ${patch.promotionCodes ? tx`${pgArray(patch.promotionCodes)}::text[]` : tx`promotion_codes`},
        currency = ${c.currency}, market_id = ${c.marketId}, language = ${c.language},
        cart_expires_at = ${c.expiresAt}, updated_at = ${c.now}, revision = revision + 1
      where id = ${id} and state = 'cart'
    `
  ).count > 0
}

/** Each version's product and tax class, by id; what shoppers may see is decided after, by the catalogue's rules (cartItems). */
export const selectCartVersions = (tx: ScopedSql, storeId: string, ids: readonly string[]): Promise<{ id: string; product_id: string; tax_class_id: string | null }[]> =>
  ids.length === 0
    ? Promise.resolve([])
    : tx<{ id: string; product_id: string; tax_class_id: string | null }[]>`select id, product_id, tax_class_id from product_version where store_id = ${storeId} and id = any (${pgArray(ids)}::uuid[])`

/**
 * Carts past their expiry, a batch at a time, lines with them: nobody can open one again (the cron's sweep). One reminded
 * in the last 30 days waits, so the unsubscribe link in its email keeps working that long (FIRST-RELEASE §9).
 */
export const deleteExpiredCarts = async (tx: ScopedSql, now: Date, limit: number): Promise<number> =>
  (
    await tx`
      delete from "order" where id in (
        select o.id from "order" o where o.state = 'cart' and o.cart_expires_at < ${now}
          and not exists (select 1 from cart_reminder r where r.order_id = o.id and r.sent_at > ${new Date(now.getTime() - unsubscribeLinkMs)})
        order by o.cart_expires_at limit ${limit})
    `
  ).count

/** How long a reminder's unsubscribe link keeps working after it was sent. */
export const unsubscribeLinkMs = 30 * 86_400_000
