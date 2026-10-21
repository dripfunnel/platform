import { insertOutbox } from './outbox'
import type { ScopedSql } from './index'

// What a paid order's downloads, services and gift cards become (migration 0171; CATALOG-DESIGN T14), written by the
// engine in system scope as the payment is: a download's grant, keys from the pool, a gift card and its ledger.

/** An order's downloads and keys stay out only while it is paid: a refund in full closes its links and hides its keys. */
export const handedOut = (tx: ScopedSql) => tx`o.state = 'placed' and o.payment_state in ('paid', 'partly_refunded')`

export interface LineToDeliverRow {
  id: string
  product_id: string
  product_type: 'physical' | 'digital' | 'service' | 'gift_card'
  download_mode: 'file' | 'keys' | null
  download_asset_id: string | null
  download_limit: number
  download_days: number
  gift_card_expiry_months: number | null
  quantity: number
  unit_amount: string
  gift_recipient_name: string | null
  gift_recipient_email: string | null
  gift_message: string | null
  gift_send_on: string | null
}

export interface OrderToDeliverRow {
  partner_id: string
  number: string
  currency: string
  time_zone: string
  /** Paid in test mode on a preview storefront: nothing real is handed out (storefront ARCHITECTURE §4.1). */
  test: boolean
  lines: LineToDeliverRow[]
}

export const selectOrderToDeliver = async (tx: ScopedSql, storeId: string, orderId: string): Promise<OrderToDeliverRow | null> =>
  (
    await tx<OrderToDeliverRow[]>`
      select s.partner_id, o.number, o.currency, s.time_zone,
        exists (select 1 from payment m where m.order_id = o.id and m.mode = 'test') as test,
        coalesce((select json_agg(json_build_object('id', l.id, 'product_id', l.product_id, 'product_type', p.product_type, 'download_mode', p.download_mode,
            'download_asset_id', p.download_asset_id, 'download_limit', p.download_limit, 'download_days', p.download_days,
            'gift_card_expiry_months', p.gift_card_expiry_months, 'quantity', l.quantity, 'unit_amount', l.unit_amount::text,
            'gift_recipient_name', l.gift_recipient_name, 'gift_recipient_email', l.gift_recipient_email, 'gift_message', l.gift_message, 'gift_send_on', l.gift_send_on)
          order by l.position) from order_line l join product p on p.id = l.product_id where l.order_id = o.id and p.product_type in ('digital', 'gift_card')), '[]'::json) as lines
      from "order" o join store s on s.id = o.store_id
      where o.id = ${orderId} and o.store_id = ${storeId} and o.state = 'placed' and o.payment_state = 'paid'
    `
  )[0] ?? null

/** True when this call made the grant; a replay of the payment finds it made. */
export const insertDownload = async (tx: ScopedSql, d: { storeId: string; orderId: string; lineId: string; assetId: string; uses: number; expiresAt: Date }): Promise<boolean> =>
  (
    await tx`
      insert into order_download (order_id, order_line_id, store_id, asset_id, uses_left, expires_at)
      values (${d.orderId}, ${d.lineId}, ${d.storeId}, ${d.assetId}, ${d.uses}, ${d.expiresAt})
      on conflict (order_line_id) do nothing
    `
  ).count === 1

/** Up to what the line still lacks, oldest key first; one buyer waits for none another holds the lock of. */
export const assignKeys = async (tx: ScopedSql, storeId: string, productId: string, lineId: string, quantity: number, at: Date): Promise<{ assigned: number; short: number }> => {
  const [held] = await tx<{ n: number }[]>`select count(*)::int as n from licence_key where order_line_id = ${lineId}`
  const wanted = quantity - (held?.n ?? 0)
  if (wanted <= 0) return { assigned: 0, short: 0 }
  const assigned = (
    await tx`
      update licence_key set order_line_id = ${lineId}, assigned_at = ${at}
      where id in (select id from licence_key where store_id = ${storeId} and product_id = ${productId} and order_line_id is null order by created_at, id limit ${wanted} for update skip locked)
    `
  ).count
  return { assigned, short: wanted - assigned }
}

/** Paid live orders' key lines still short of a key, oldest first: what a new batch of keys goes to. */
export const selectLinesWaitingForKeys = (tx: ScopedSql, storeId: string, productId: string): Promise<{ id: string; order_id: string; partner_id: string; quantity: number }[]> =>
  tx<{ id: string; order_id: string; partner_id: string; quantity: number }[]>`
    select l.id, l.order_id, s.partner_id, l.quantity from order_line l join "order" o on o.id = l.order_id join store s on s.id = o.store_id
    where l.store_id = ${storeId} and l.product_id = ${productId} and o.state = 'placed' and o.payment_state = 'paid'
      and not exists (select 1 from payment m where m.order_id = o.id and m.mode = 'test')
      and (select count(*) from licence_key k where k.order_line_id = l.id) < l.quantity
    order by o.paid_at, l.position
    limit 100
  `

export interface NewGiftCard {
  storeId: string
  orderId: string
  lineId: string
  productId: string
  currency: string
  amount: bigint
  expiryMonths: number | null
  recipientName: string | null
  recipientEmail: string
  message: string | null
  sendOn: string | null
}

/** The card a paid gift card line becomes, with its `issued` movement; null when a replay finds it issued. */
export const issueOrderGiftCard = async (tx: ScopedSql, g: NewGiftCard): Promise<string | null> => {
  const [made] = await tx<{ id: string }[]>`
    insert into gift_card (store_id, product_id, currency, initial_amount, balance_amount, expiry_months, recipient_name, recipient_email, message, send_on, order_line_id)
    values (${g.storeId}, ${g.productId}, ${g.currency}, ${g.amount.toString()}, ${g.amount.toString()}, ${g.expiryMonths}, ${g.recipientName}, ${g.recipientEmail}, ${g.message}, ${g.sendOn}::date, ${g.lineId})
    on conflict (order_line_id) do nothing
    returning id
  `
  if (!made) return null
  await tx`insert into gift_card_movement (gift_card_id, store_id, kind, amount, currency, order_id) values (${made.id}, ${g.storeId}, 'issued', ${g.amount.toString()}, ${g.currency}, ${g.orderId})`
  return made.id
}

/** 08:00 in the store's time zone on the day chosen ("We email it that morning"), or now when that has passed. */
export const sendTimeOf = async (tx: ScopedSql, sendOn: string | null, timeZone: string, now: Date): Promise<Date> => {
  if (sendOn === null) return now
  const [row] = await tx<{ at: Date }[]>`select greatest(((${sendOn}::date + time '08:00') at time zone ${timeZone}), ${now}::timestamptz) as at`
  return row?.at ?? now
}

export const queueEmail = (tx: ScopedSql, e: { partnerId: string; storeId: string; key: string; payload: Record<string, unknown>; notBefore?: Date }) =>
  insertOutbox(tx, { kind: 'email', idempotencyKey: e.key, payload: e.payload, partnerId: e.partnerId, storeId: e.storeId, ...(e.notBefore ? { notBefore: e.notBefore } : {}) })

export interface DownloadsEmailRow {
  store_id: string
  partner_id: string
  store_name: string
  locale: string
  number: string
  email: string | null
  downloads: { id: string; name: string; uses_left: number; expires_at: string }[]
  keys: { name: string; key: string }[]
}

/** What a paid order's downloads email lists: each link's grant and every key it took. */
export const selectDownloadsEmail = async (tx: ScopedSql, orderId: string): Promise<DownloadsEmailRow | null> =>
  (
    await tx<DownloadsEmailRow[]>`
      select o.store_id, s.partner_id, s.name as store_name, s.main_language as locale, o.number, o.email,
        coalesce((select json_agg(json_build_object('id', d.id, 'name', l.name, 'uses_left', d.uses_left, 'expires_at', d.expires_at) order by l.position)
          from order_download d join order_line l on l.id = d.order_line_id where d.order_id = o.id), '[]'::json) as downloads,
        coalesce((select json_agg(json_build_object('name', l.name, 'key', k.key) order by l.position, k.assigned_at, k.id)
          from licence_key k join order_line l on l.id = k.order_line_id where l.order_id = o.id), '[]'::json) as keys
      from "order" o join store s on s.id = o.store_id
      where o.id = ${orderId} and ${handedOut(tx)}
    `
  )[0] ?? null

export interface GiftCardToSendRow {
  id: string
  store_id: string
  partner_id: string
  store_name: string
  locale: string
  currency: string
  balance_amount: string
  recipient_name: string | null
  recipient_email: string
  message: string | null
  expires_at: Date | null
}

/**
 * The card's code set as its email is composed, once: the code lives only in that email, so a card already sent is
 * never sent again (its code can't be shown twice). Null for one sent, disabled or unknown, and for one whose order was
 * refunded in full or cancelled before its day.
 */
export const markGiftCardSent = async (tx: ScopedSql, id: string, code: { hash: string; last4: string }, at: Date): Promise<GiftCardToSendRow | null> =>
  (
    await tx<GiftCardToSendRow[]>`
      update gift_card g set code_hash = ${code.hash}, code_last4 = ${code.last4}, sent_at = ${at},
        expires_at = case when g.expiry_months is null then null else ${at}::timestamptz + make_interval(months => g.expiry_months) end, updated_at = ${at}
      from store s
      where g.id = ${id} and s.id = g.store_id and g.code_hash is null and g.status = 'active'
        and (g.order_line_id is null or exists (select 1 from order_line l join "order" o on o.id = l.order_id where l.id = g.order_line_id and ${handedOut(tx)}))
      returning g.id, g.store_id, s.partner_id, s.name as store_name, s.main_language as locale, g.currency, g.balance_amount::text as balance_amount,
        g.recipient_name, g.recipient_email, g.message, g.expires_at
    `
  )[0] ?? null

/** The card's store and partner, checked (and its code hashed with the store) before anything is written. */
export const selectGiftCardStore = async (tx: ScopedSql, id: string): Promise<{ store_id: string; partner_id: string } | null> =>
  (await tx<{ store_id: string; partner_id: string }[]>`select g.store_id, s.partner_id from gift_card g join store s on s.id = g.store_id where g.id = ${id}`)[0] ?? null

export interface DownloadToServeRow {
  r2_key: string
  mime: string
  bytes: number
  name: string
}

/** A grant this store's link may still open, locked while its use is spent: the order placed, not refunded in full. */
export const lockDownloadToServe = async (tx: ScopedSql, storeId: string, grantId: string, at: Date): Promise<DownloadToServeRow | null> =>
  (
    await tx<DownloadToServeRow[]>`
      select a.r2_key, a.mime, a.bytes, l.name from order_download d
      join asset a on a.id = d.asset_id join order_line l on l.id = d.order_line_id join "order" o on o.id = d.order_id
      where d.id = ${grantId} and d.store_id = ${storeId} and d.uses_left > 0 and d.expires_at > ${at}
        and ${handedOut(tx)}
      for update of d
    `
  )[0] ?? null

export const spendDownload = async (tx: ScopedSql, grantId: string): Promise<void> => {
  await tx`update order_download set uses_left = uses_left - 1 where id = ${grantId} and uses_left > 0`
}
