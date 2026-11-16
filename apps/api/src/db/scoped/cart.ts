import type postgres from 'postgres'
import { pgArray, type ScopedSql } from './index'
import { translated } from './shop'

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
  /** The shopper's map pin (#814); absent on an address kept before it. */
  latitude?: number | null
  longitude?: number | null
}

/** Who a gift card line goes to and when (migration 0171); null on every other line. */
export interface CartGift {
  recipientName: string
  recipientEmail: string
  message: string | null
  /** YYYY-MM-DD, or null to send once paid. */
  sendOn: string | null
}

/** A line's answer as kept (DATA-MODEL §7.6): ids only, never a price, ordered by question then choice id. */
export type StoredAnswer = { question: string; choices: { choice: string; quantity: number }[] } | { question: string; text: string } | { question: string; uploads: string[] }

export interface CartRow {
  id: string
  customer_id: string | null
  email: string | null
  phone: string | null
  currency: string
  market_id: string | null
  shipping_address: CartAddress | null
  billing_address: CartAddress | null
  shipping_option: 'courier' | 'flat' | 'pickup' | 'own_delivery' | null
  shopper_note: string | null
  checkout_step: 'contact' | 'ship' | 'pay' | null
  revision: number
  /** The codes the shopper typed, as typed after normalising; the engine decides what each does (OFFERS fact 6). */
  promotion_codes: string[]
  /** The gift card the engine put on it (migration 0172); never the shopper's to write. */
  gift_card_id: string | null
  /** `id` names a line in the Shop API; `answers` are its answers to the product's questions, null on most (migration 0392). */
  lines: { id: string; version_id: string; quantity: number; gift: CartGift | null; answers: StoredAnswer[] | null }[]
}

/** The shopper's open cart: the guest token's when one was presented, else the account's latest. */
export const selectCart = async (tx: ScopedSql, storeId: string, now: Date): Promise<CartRow | null> =>
  (
    await tx<CartRow[]>`
      select o.id, o.customer_id, o.email, o.phone, o.currency, o.market_id, o.shipping_address, o.billing_address, o.shipping_option,
        o.shopper_note, o.checkout_step, o.revision, to_json(o.promotion_codes) as promotion_codes, o.gift_card_id,
        coalesce((select json_agg(json_build_object('id', l.id, 'version_id', l.version_id, 'quantity', l.quantity, 'answers', l.answers, 'gift', case when l.gift_recipient_email is null then null else json_build_object(
          'recipientName', l.gift_recipient_name, 'recipientEmail', l.gift_recipient_email, 'message', l.gift_message, 'sendOn', l.gift_send_on) end) order by l.added_at, l.version_id, l.id) from cart_line l where l.order_id = o.id), '[]'::json) as lines
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

const answersParam = (tx: ScopedSql, answers: readonly StoredAnswer[] | null) => (answers && answers.length > 0 ? tx.json(answers as unknown as postgres.JSONValue) : null)

/**
 * Adds to the line of this version with these answers (one line, fact 56), or starts it: up to 999. Answers the line's id.
 * A line without answers is today's one line per version.
 */
export const addCartLine = async (tx: ScopedSql, storeId: string, orderId: string, versionId: string, answers: readonly StoredAnswer[] | null, quantity: number, max: number): Promise<string | 'version_taken'> => {
  try {
    const [row] = await tx.savepoint(
      (sp) => sp<{ id: string }[]>`
        insert into cart_line (order_id, store_id, version_id, quantity, answers) values (${orderId}, ${storeId}, ${versionId}, ${quantity}, ${answersParam(tx, answers)})
        on conflict (order_id, version_id, answers_key) do update set quantity = least(cart_line.quantity + excluded.quantity, ${max})
        returning id
      `,
    )
    if (!row) throw new Error('cart: line insert returned no row')
    return row.id
  } catch (error) {
    // The old key (order_id, version_id) holds until the contract migration (0392's note): one line a version till then.
    if (typeof error === 'object' && error !== null && 'constraint_name' in error && error.constraint_name === 'cart_line_pkey') return 'version_taken'
    throw error
  }
}

/** How many of a line; 0 takes it out. */
export const setCartLineQuantity = async (tx: ScopedSql, orderId: string, lineId: string, quantity: number): Promise<void> => {
  if (quantity === 0) await tx`delete from cart_line where order_id = ${orderId} and id = ${lineId}`
  else await tx`update cart_line set quantity = ${quantity} where order_id = ${orderId} and id = ${lineId}`
}

/**
 * A line's answers changed (Edit): when another line of the version already has these answers, the two become one, their
 * quantities summed up to `max`. Answers the line that holds them now.
 */
export const setCartLineAnswers = async (tx: ScopedSql, orderId: string, lineId: string, answers: readonly StoredAnswer[] | null, max: number): Promise<string | null> => {
  const [line] = await tx<{ version_id: string; quantity: number }[]>`select version_id, quantity from cart_line where order_id = ${orderId} and id = ${lineId} for update`
  if (!line) return null
  const json = answersParam(tx, answers)
  const [twin] = await tx<{ id: string }[]>`
    select id from cart_line where order_id = ${orderId} and version_id = ${line.version_id} and id <> ${lineId}
      and answers_key = case when ${json}::jsonb is null then '' else encode(sha256(convert_to((${json}::jsonb)::text, 'UTF8')), 'hex') end
  `
  if (!twin) {
    await tx`update cart_line set answers = ${json} where id = ${lineId}`
    return lineId
  }
  await tx`delete from cart_line where id = ${lineId}`
  await tx`update cart_line set quantity = least(quantity + ${line.quantity}, ${max}) where id = ${twin.id}`
  return twin.id
}

/** A gift card line's recipient and day, as the shopper chose them last. */
export const setCartGift = async (tx: ScopedSql, orderId: string, lineId: string, g: CartGift): Promise<void> => {
  await tx`
    update cart_line set gift_recipient_name = ${g.recipientName}, gift_recipient_email = ${g.recipientEmail}, gift_message = ${g.message}, gift_send_on = ${g.sendOn}::date
    where order_id = ${orderId} and id = ${lineId}
  `
}

export interface CartPatch {
  email?: string | null
  phone?: string | null
  shopperNote?: string | null
  shippingAddress?: CartAddress | null
  billingAddress?: CartAddress | null
  shippingOption?: 'courier' | 'flat' | 'pickup' | 'own_delivery' | null
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

/** The cart's delivering warehouse (migration 0363), in system scope: the shopper neither reads nor writes it. */
export const setCartDeliveryWarehouse = async (tx: ScopedSql, storeId: string, id: string, warehouseId: string | null): Promise<void> => {
  await tx`update "order" set delivery_warehouse_id = ${warehouseId} where id = ${id} and store_id = ${storeId} and state = 'cart'`
}

interface CartVersionRow {
  id: string
  product_id: string
  tax_class_id: string | null
  has_questions: boolean
  age_restricted: boolean
  /** Its choices in the shopper's language, in option order ("Size: M", "Colour: Red"). */
  choices: string[]
}

/** A version's choices in the shopper's language, in option order, for a query that names it `v`. */
const choicesOf = (tx: ScopedSql, language: string) => tx`coalesce((select json_agg(${translated(tx, 'option_name', tx`lower(o.name)`, 'name', tx`o.name`, language)} || ': ' || ${translated(tx, 'choice_name', tx`lower(ch.name)`, 'name', tx`ch.name`, language)} order by o.position)
            from product_version_option_value ov join product_option o on o.id = ov.option_id join product_option_value ch on ch.id = ov.value_id
            where ov.version_id = v.id), '[]'::json)`

/**
 * Each version's product and tax class, by id, and whether its product asks questions (#1368: one statement, so a product
 * without any costs nothing more); what shoppers may see is decided after, by the catalogue's rules (cartItems).
 */
export const selectCartVersions = (tx: ScopedSql, storeId: string, ids: readonly string[], language: string): Promise<CartVersionRow[]> =>
  ids.length === 0
    ? Promise.resolve([])
    : tx<CartVersionRow[]>`
        select v.id, v.product_id, v.tax_class_id, exists (select 1 from product_question q where q.product_id = v.product_id) as has_questions,
          coalesce((select f.age_restricted from product_flag f where f.product_id = v.product_id), false) as age_restricted,
          ${choicesOf(tx, language)} as choices
        from product_version v where v.store_id = ${storeId} and v.id = any (${pgArray(ids)}::uuid[])
      `

interface CartLineDisplayRow {
  id: string
  product_name: string
  version_name: string | null
  choices: string[]
  /** The version's own photo, else the product's first (the same pick the shop makes for a line, #1465). */
  photo_asset_id: string | null
}

/**
 * What names a cart line, whatever its product's state (hidden, deleted, a version removed): for display only, so a shopper
 * can tell which item an unavailable line was. Nothing here makes it buyable.
 */
export const selectCartLineDisplays = (tx: ScopedSql, storeId: string, ids: readonly string[], language: string): Promise<CartLineDisplayRow[]> =>
  ids.length === 0
    ? Promise.resolve([])
    : tx<CartLineDisplayRow[]>`
        select v.id, ${translated(tx, 'product', tx`p.id`, 'name', tx`p.name`, language)} as product_name,
          ${translated(tx, 'version', tx`v.id`, 'name', tx`v.name`, language)} as version_name,
          ${choicesOf(tx, language)} as choices,
          coalesce(v.photo_asset_id, (select ph.asset_id from product_photo ph where ph.product_id = p.id order by ph.position limit 1)) as photo_asset_id
        from product_version v join product p on p.id = v.product_id
        where v.store_id = ${storeId} and v.id = any (${pgArray(ids)}::uuid[])
      `

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
          -- A cart holding shoppers' files waits: they're kept with no automatic deletion (rule 30 of #1367, DATA-MODEL §7.6).
          and not exists (select 1 from shopper_upload u where u.order_id = o.id)
        order by o.cart_expires_at limit ${limit})
    `
  ).count

/** How long a reminder's unsubscribe link keeps working after it was sent. */
export const unsubscribeLinkMs = 30 * 86_400_000
