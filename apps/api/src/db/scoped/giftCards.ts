import type { PageWindow } from '#core/paging'
import type { ScopedSql } from './index'

// A gift card's balance and its redemption (migration 0112; FIRST-RELEASE §19): every balance change in system scope,
// under the card's row lock, with its movement in the ledger; the merchant side reads the cards it issued.

export interface UsableGiftCardRow {
  id: string
  currency: string
  balance_amount: string
  expires_at: Date | null
  code_last4: string
}

const usable = (tx: ScopedSql, at: Date) => tx`g.status = 'active' and g.sent_at is not null and (g.expires_at is null or g.expires_at > ${at}) and g.balance_amount > 0`

/** The card a code opens in this store, while it can still be spent; null alike for a wrong, unsent, expired or used-up one. */
export const selectGiftCardByCode = async (tx: ScopedSql, storeId: string, codeHash: string, at: Date): Promise<UsableGiftCardRow | null> =>
  (await tx<UsableGiftCardRow[]>`select g.id, g.currency, g.balance_amount::text as balance_amount, g.expires_at, g.code_last4 from gift_card g where g.store_id = ${storeId} and g.code_hash = ${codeHash} and ${usable(tx, at)}`)[0] ?? null

export const selectUsableGiftCard = async (tx: ScopedSql, storeId: string, id: string, at: Date): Promise<UsableGiftCardRow | null> =>
  (await tx<UsableGiftCardRow[]>`select g.id, g.currency, g.balance_amount::text as balance_amount, g.expires_at, g.code_last4 from gift_card g where g.store_id = ${storeId} and g.id = ${id} and ${usable(tx, at)}`)[0] ?? null

/** Locked for the redemption: the balance a placement takes from, checked again under the lock. */
export const lockUsableGiftCard = async (tx: ScopedSql, storeId: string, id: string, at: Date): Promise<UsableGiftCardRow | null> =>
  (await tx<UsableGiftCardRow[]>`select g.id, g.currency, g.balance_amount::text as balance_amount, g.expires_at, g.code_last4 from gift_card g where g.store_id = ${storeId} and g.id = ${id} and ${usable(tx, at)} for update`)[0] ?? null

/** The card a cart holds, or none; the cart's revision moves, so a placement priced before refuses (CART_CHANGED). */
export const setCartGiftCard = async (tx: ScopedSql, storeId: string, orderId: string, giftCardId: string | null, at: Date): Promise<boolean> =>
  (await tx`update "order" set gift_card_id = ${giftCardId}, updated_at = ${at}, revision = revision + 1 where id = ${orderId} and store_id = ${storeId} and state = 'cart'`).count === 1

/** What placement takes from the locked card, once an order. */
export const redeemGiftCard = async (tx: ScopedSql, r: { storeId: string; giftCardId: string; orderId: string; amount: bigint; currency: string; at: Date }): Promise<void> => {
  await tx`update gift_card set balance_amount = balance_amount - ${r.amount.toString()}, updated_at = ${r.at} where id = ${r.giftCardId} and balance_amount >= ${r.amount.toString()}`
  await tx`insert into gift_card_movement (gift_card_id, store_id, kind, amount, currency, order_id) values (${r.giftCardId}, ${r.storeId}, 'redeemed', ${r.amount.toString()}, ${r.currency}, ${r.orderId})`
  await tx`update "order" set gift_card_amount = ${r.amount.toString()} where id = ${r.orderId} and store_id = ${r.storeId}`
}

/** Back onto the card an order took it from: a cancellation's whole share, or a refund's part of it. */
export const restoreGiftCard = async (tx: ScopedSql, storeId: string, orderId: string, amount: bigint, at: Date): Promise<void> => {
  if (amount <= 0n) return
  const [order] = await tx<{ gift_card_id: string | null; currency: string }[]>`select gift_card_id, currency from "order" where id = ${orderId} and store_id = ${storeId}`
  if (!order?.gift_card_id) return
  await tx`update gift_card set balance_amount = least(initial_amount, balance_amount + ${amount.toString()}), updated_at = ${at} where id = ${order.gift_card_id}`
  await tx`insert into gift_card_movement (gift_card_id, store_id, kind, amount, currency, order_id) values (${order.gift_card_id}, ${storeId}, 'restored', ${amount.toString()}, ${order.currency}, ${orderId})`
}

export interface IssuedGiftCardRow {
  id: string
  code_last4: string | null
  currency: string
  initial_amount: string
  balance_amount: string
  expires_at: Date | null
  recipient_name: string | null
  recipient_email: string
  send_on: string | null
  sent_at: Date | null
  status: 'active' | 'disabled'
  by_order: boolean
  created_at: Date
}

/** A gift card product's cards, newest first (CatEditor "Cards issued"). */
export const selectIssuedGiftCards = (tx: ScopedSql, storeId: string, productId: string, window: PageWindow): Promise<IssuedGiftCardRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<IssuedGiftCardRow[]>`
    select g.id, g.code_last4, g.currency, g.initial_amount::text as initial_amount, g.balance_amount::text as balance_amount, g.expires_at,
      g.recipient_name, g.recipient_email, g.send_on::text as send_on, g.sent_at, g.status, g.order_line_id is not null as by_order, g.created_at
    from gift_card g where g.store_id = ${storeId} and g.product_id = ${productId}
      and ${window.after ? tx`(g.created_at, g.id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(g.created_at, g.id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by g.created_at ${backwards ? tx`asc` : tx`desc`}, g.id ${backwards ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `
}

export interface GiftCardAmountRow {
  product_id: string
  product_name: string
  amount: string
  currency: string
  expiry_months: number | null
  partner_id: string
}

/** One of a gift card product's amounts, in the store's own currency: what "Issue a card" gives. */
export const selectGiftCardAmount = async (tx: ScopedSql, storeId: string, productId: string, versionId: string): Promise<GiftCardAmountRow | null> =>
  (
    await tx<GiftCardAmountRow[]>`
      select p.id as product_id, p.name as product_name, vp.amount::text as amount, vp.currency, p.gift_card_expiry_months as expiry_months, s.partner_id
      from product p join product_version v on v.product_id = p.id and v.deleted_at is null
        join store s on s.id = p.store_id join version_price vp on vp.version_id = v.id and vp.currency = s.pricing_currency
      where p.id = ${productId} and v.id = ${versionId} and p.store_id = ${storeId} and p.product_type = 'gift_card' and p.deleted_at is null
    `
  )[0] ?? null

export const insertIssuedGiftCard = async (tx: ScopedSql, g: { storeId: string; productId: string; currency: string; amount: bigint; expiryMonths: number | null; recipientName: string | null; recipientEmail: string; issuedBy: string; at: Date }): Promise<string> => {
  const [made] = await tx<{ id: string }[]>`
    insert into gift_card (store_id, product_id, currency, initial_amount, balance_amount, expiry_months, recipient_name, recipient_email, issued_by)
    values (${g.storeId}, ${g.productId}, ${g.currency}, ${g.amount.toString()}, ${g.amount.toString()}, ${g.expiryMonths}, ${g.recipientName}, ${g.recipientEmail}, ${g.issuedBy})
    returning id
  `
  if (!made) throw new Error('gift_card: insert returned no row')
  await tx`insert into gift_card_movement (gift_card_id, store_id, kind, amount, currency) values (${made.id}, ${g.storeId}, 'issued', ${g.amount.toString()}, ${g.currency})`
  return made.id
}
