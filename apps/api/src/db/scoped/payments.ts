import type { ScopedSql } from './index'

// Card payments (migration 0069; DATA-MODEL §7.6), in system scope: the engine has checked the caller, and these name the
// store or the provider's own ids. Sealed keys are read only to open them for a call (THIRD-PARTY-ACCESS §3.1).

export interface GatewayAccountRow {
  id: string
  provider: string
  mode: 'test' | 'live'
  external_account_id: string | null
  credentials_enc: string | null
  public_key: string | null
}

/** The account a card provider takes payment through in this mode; Stripe's one connection serves both modes. */
export const selectGatewayAccount = async (tx: ScopedSql, storeId: string, provider: string, mode: 'test' | 'live'): Promise<GatewayAccountRow | null> =>
  (
    await tx<GatewayAccountRow[]>`
      select id, provider, mode, external_account_id, credentials_enc, public_key from payment_provider_account
      where store_id = ${storeId} and provider = ${provider} and status = 'live' and not paused_by_plan and (mode = ${mode} or provider = 'stripe')
    `
  )[0] ?? null

export const selectAccountById = async (tx: ScopedSql, id: string): Promise<GatewayAccountRow | null> =>
  (await tx<GatewayAccountRow[]>`select id, provider, mode, external_account_id, credentials_enc, public_key from payment_provider_account where id = ${id}`)[0] ?? null

/** The store's connected Stripe account, for Stripe Tax and checkout; null when it has none taking payment. */
export const selectStripeAccountId = async (tx: ScopedSql, storeId: string): Promise<string | null> =>
  (
    await tx<{ id: string }[]>`
      select external_account_id as id from payment_provider_account
      where store_id = ${storeId} and provider = 'stripe' and status = 'live' and external_account_id is not null
    `
  )[0]?.id ?? null

/** Which store a connected Stripe account is, for its webhook events (THIRD-PARTY-ACCESS §3.1). */
export const selectStoreByStripeAccount = async (tx: ScopedSql, accountId: string): Promise<{ id: string; store_id: string; partner_id: string } | null> =>
  (
    await tx<{ id: string; store_id: string; partner_id: string }[]>`
      select a.id, a.store_id, s.partner_id from payment_provider_account a join store s on s.id = a.store_id
      where a.provider = 'stripe' and a.external_account_id = ${accountId}
    `
  )[0] ?? null

/** Whether another store holds this Stripe account (a merchant approving one account for two stores). */
export const stripeAccountTaken = async (tx: ScopedSql, storeId: string, accountId: string): Promise<boolean> =>
  (await tx`select 1 from payment_provider_account where provider = 'stripe' and external_account_id = ${accountId} and store_id <> ${storeId}`).length > 0

/** Connected: a live row holding the account's id, whatever was there before. */
export const saveStripeAccount = async (tx: ScopedSql, storeId: string, accountId: string, now: Date): Promise<void> => {
  await tx`
    insert into payment_provider_account (store_id, provider, mode, external_account_id, status, connected_at, updated_at)
    values (${storeId}, 'stripe', 'live', ${accountId}, 'live', ${now}, ${now})
    on conflict (store_id, provider, mode) do update set external_account_id = excluded.external_account_id, status = 'live', connected_at = ${now}, updated_at = ${now}
  `
}

/** Off, its keys and connected account cleared, the row kept for its payments; answers the Stripe account it held. */
export const disconnectProvider = async (tx: ScopedSql, storeId: string, provider: string, now: Date): Promise<{ count: number; stripeAccount: string | null }> => {
  const rows = await tx<{ was: string | null }[]>`
    update payment_provider_account a set status = 'off', credentials_enc = null, webhook_secret_enc = null, external_account_id = null, updated_at = ${now}
    from (select id, external_account_id as was from payment_provider_account where store_id = ${storeId} and provider = ${provider} for update) old
    where a.id = old.id and a.status = 'live'
    returning old.was
  `
  return { count: rows.length, stripeAccount: rows.find((r) => r.was)?.was ?? null }
}

/** Stripe ended the platform's access from its side: the account no longer takes payment. */
export const forgetStripeAccount = async (tx: ScopedSql, accountId: string, now: Date): Promise<number> =>
  (await tx`update payment_provider_account set status = 'off', external_account_id = null, updated_at = ${now} where provider = 'stripe' and external_account_id = ${accountId}`).count

/** How many ways to pay the store has live: its only one can't be turned off (SetOps). */
export const countLiveMethods = async (tx: ScopedSql, storeId: string): Promise<number> =>
  Number((await tx<{ n: string }[]>`select count(distinct provider)::text as n from payment_provider_account where store_id = ${storeId} and status = 'live'`)[0]?.n ?? 0)

export interface PaymentToSettleRow {
  id: string
  order_id: string
  store_id: string
  partner_id: string
  provider: string
  provider_account_id: string | null
  provider_ref: string | null
  state: 'pending' | 'authorised' | 'captured' | 'failed' | 'refunded' | 'mismatch'
  amount: string
  currency: string
  mode: 'test' | 'live'
  order_number: string
  order_state: 'cart' | 'placed' | 'cancelled'
  order_payment_state: string
  stock_reserved: boolean
  payment_due_by: Date | null
}

const settleColumns = (tx: ScopedSql) => tx`
  p.id, p.order_id, p.store_id, s.partner_id, p.provider, p.provider_account_id, p.provider_ref, p.state, p.amount::text as amount, p.currency, p.mode,
  o.number as order_number, o.state as order_state, o.payment_state as order_payment_state, o.stock_reserved, o.payment_due_by
`

/** A payment and its order, locked, by the provider's own id: what a webhook or a return names. */
export const lockPaymentByRef = async (tx: ScopedSql, provider: string, providerRef: string): Promise<PaymentToSettleRow | null> =>
  (
    await tx<PaymentToSettleRow[]>`
      select ${settleColumns(tx)} from payment p join "order" o on o.id = p.order_id join store s on s.id = p.store_id
      where p.provider = ${provider} and p.provider_ref = ${providerRef}
      for update of p, o
    `
  )[0] ?? null

/** The order's latest payment started with a provider: the one a return or a retry is about. */
export const selectLatestPayment = async (tx: ScopedSql, storeId: string, orderId: string): Promise<PaymentToSettleRow | null> =>
  (
    await tx<PaymentToSettleRow[]>`
      select ${settleColumns(tx)} from payment p join "order" o on o.id = p.order_id join store s on s.id = p.store_id
      where p.store_id = ${storeId} and p.order_id = ${orderId} and p.provider_ref is not null
      order by p.created_at desc, p.id limit 1
    `
  )[0] ?? null

export const markPaymentCaptured = async (tx: ScopedSql, paymentId: string, now: Date): Promise<void> => {
  await tx`update payment set state = 'captured', captured_at = ${now}, updated_at = ${now} where id = ${paymentId}`
}

export const markPaymentFailed = async (tx: ScopedSql, paymentId: string, now: Date): Promise<void> => {
  await tx`update payment set state = 'failed', updated_at = ${now} where id = ${paymentId} and state = 'pending'`
}

/** A new attempt replaces the order's earlier ones still waiting. */
export const failPendingPayments = async (tx: ScopedSql, storeId: string, orderId: string, now: Date): Promise<void> => {
  await tx`update payment set state = 'failed', updated_at = ${now} where store_id = ${storeId} and order_id = ${orderId} and state = 'pending'`
}

/** Paid by its provider: the order only (the payment is marked by itself), and paid on a cancelled one too, for a refund. */
export const markOrderPaid = async (tx: ScopedSql, storeId: string, orderId: string, now: Date): Promise<void> => {
  await tx`update "order" set payment_state = 'paid', paid_at = ${now}, payment_due_by = null, updated_at = ${now}, revision = revision + 1 where id = ${orderId} and store_id = ${storeId}`
}

export interface LineToHoldRow {
  id: string
  version_id: string
  quantity: number
  track_stock: boolean
}

/** A paid order's lines whose stock is counted, to hold now (PLATFORM-PROMPT §5.4), in version order as placement locks them. */
export const selectLinesToHold = (tx: ScopedSql, storeId: string, orderId: string): Promise<LineToHoldRow[]> =>
  tx<LineToHoldRow[]>`
    select l.id, l.version_id, l.quantity, coalesce(v.track_stock, false) as track_stock
    from order_line l left join product_version v on v.id = l.version_id
    where l.store_id = ${storeId} and l.order_id = ${orderId} and l.reserved_warehouse_id is null order by l.version_id, l.id
  `

export const setLineWarehouse = async (tx: ScopedSql, lineId: string, warehouseId: string): Promise<void> => {
  await tx`update order_line set reserved_warehouse_id = ${warehouseId} where id = ${lineId}`
}

/** A wrong amount: the payment marked so it is never read again, and its order out of the sweep's queue for the merchant. */
export const holdForMerchant = async (tx: ScopedSql, storeId: string, orderId: string, paymentId: string, now: Date): Promise<void> => {
  await tx`update payment set state = 'mismatch', updated_at = ${now} where id = ${paymentId}`
  await tx`update "order" set payment_due_by = null where id = ${orderId} and store_id = ${storeId}`
}

/** Asked again later, behind newer due orders, while its provider can't be read. */
export const deferUnpaid = async (tx: ScopedSql, storeId: string, orderId: string, until: Date): Promise<void> => {
  await tx`update "order" set payment_due_by = ${until} where id = ${orderId} and store_id = ${storeId} and state = 'placed' and payment_state = 'pending'`
}

export const markStockReserved = async (tx: ScopedSql, storeId: string, orderId: string): Promise<void> => {
  await tx`update "order" set stock_reserved = true where id = ${orderId} and store_id = ${storeId}`
}

export interface ConnectRow {
  id: string
  store_id: string
  partner_id: string
  return_host: string
  started_by: string
  expires_at: Date
}

/** Starting again replaces an unfinished one. */
export const savePendingConnect = async (tx: ScopedSql, c: { storeId: string; stateHash: string; returnHost: string; by: string; expiresAt: Date }): Promise<void> => {
  await tx`delete from payment_connect where store_id = ${c.storeId} and provider = 'stripe'`
  await tx`
    insert into payment_connect (store_id, provider, status, state_hash, return_host, started_by, expires_at)
    values (${c.storeId}, 'stripe', 'pending', ${c.stateHash}, ${c.returnHost}, ${c.by}, ${c.expiresAt})
  `
}

export const selectPendingConnect = async (tx: ScopedSql, stateHash: string): Promise<ConnectRow | null> =>
  (
    await tx<ConnectRow[]>`
      select c.id, c.store_id, s.partner_id, c.return_host, c.started_by, c.expires_at from payment_connect c join store s on s.id = c.store_id
      where c.state_hash = ${stateHash} and c.status = 'pending'
    `
  )[0] ?? null

export const approveConnect = async (tx: ScopedSql, id: string, c: { accountId: string; finishHash: string; expiresAt: Date }): Promise<boolean> =>
  (
    await tx`
      update payment_connect set status = 'approved', state_hash = null, finish_hash = ${c.finishHash}, external_account_id = ${c.accountId}, expires_at = ${c.expiresAt}
      where id = ${id} and status = 'pending' returning id
    `
  ).length === 1

export const deleteConnect = async (tx: ScopedSql, id: string): Promise<void> => {
  await tx`delete from payment_connect where id = ${id}`
}

/** Finished by the person who started it, in their own session (login CSRF, as Connect Shopify): answers the account approved. */
export const takeApprovedConnect = async (tx: ScopedSql, c: { storeId: string; finishHash: string; by: string; at: Date }): Promise<string | null> =>
  (
    await tx<{ account: string }[]>`
      delete from payment_connect
      where store_id = ${c.storeId} and provider = 'stripe' and status = 'approved' and finish_hash = ${c.finishHash} and started_by = ${c.by} and expires_at > ${c.at}
      returning external_account_id as account
    `
  )[0]?.account ?? null

export const deleteStaleConnects = async (tx: ScopedSql, now: Date): Promise<number> => (await tx`delete from payment_connect where expires_at < ${now}`).count
