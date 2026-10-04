import type { KeysetPage } from './activity'
import type { ScopedSql } from './index'

// Billing on the Platform API (ui/platform/FIRST-RELEASE.md §11, §14.3; #201). Partner reads run in
// the partner's scope, which 0019's and 0033's policies hold to its own rows; the Stripe webhook's
// writes run as app_system.

/** A bigint of minor units as a JS integer; past 2^53 it refuses rather than round. */
const minorUnits = (value: string | number | bigint): number => {
  const n = BigInt(value)
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('money: beyond exact integer range')
  return Number(n)
}

export type PayoutStatus = 'missing' | 'verifying' | 'verified' | 'failed'
export type CardStatus = 'missing' | 'on_file' | 'declined'

export interface BillingAccountRow {
  partner_id: string
  stripe_account_id: string | null
  stripe_customer_id: string | null
  payout_bank: string | null
  payout_last4: string | null
  payout_status: PayoutStatus
  payout_failure: string | null
  card_brand: string | null
  card_last4: string | null
  card_expires: Date | null
  card_status: CardStatus
}

export const selectBillingAccount = async (tx: ScopedSql, partnerId: string): Promise<BillingAccountRow | null> =>
  (await tx<BillingAccountRow[]>`
    select partner_id, stripe_account_id, stripe_customer_id, payout_bank, payout_last4, payout_status, payout_failure, card_brand, card_last4, card_expires, card_status
    from partner_billing_account where partner_id = ${partnerId}
  `)[0] ?? null

/** One account change at a time per partner, so two tabs can't create two Stripe accounts. */
export const lockBillingAccount = async (tx: ScopedSql, partnerId: string): Promise<void> => {
  await tx`select pg_advisory_xact_lock(hashtext(${`partner_billing:${partnerId}`}))`
}

export type BillingAccountPatch = Partial<Omit<BillingAccountRow, 'partner_id'>>

// The bare row first, then the change: a CHECK is tested on the proposed insert before ON CONFLICT
// could turn it into an update, so a partial insert would fail the "known" checks.
export const saveBillingAccount = async (tx: ScopedSql, partnerId: string, patch: BillingAccountPatch, at: Date): Promise<void> => {
  await tx`insert into partner_billing_account (partner_id, updated_at) values (${partnerId}, ${at}) on conflict (partner_id) do nothing`
  await tx`update partner_billing_account set ${tx({ ...patch, updated_at: at })} where partner_id = ${partnerId}`
}

export const selectContractCurrency = async (tx: ScopedSql, partnerId: string): Promise<string | null> =>
  (await tx<{ fee_currency: string }[]>`select fee_currency from partner_contract where partner_id = ${partnerId}`)[0]?.fee_currency ?? null

export const setBillingMode = async (tx: ScopedSql, partnerId: string, mode: 'dripfunnel' | 'own'): Promise<void> => {
  await tx`update partner set billing_mode = ${mode} where id = ${partnerId}`
}

export interface PaymentRow {
  id: string
  charged_at: Date
  store_id: string
  store_name: string
  kind: 'subscription' | 'proration' | 'refund'
  status: 'paid' | 'failed' | 'refunded' | 'recovered'
  amount: number
  currency: string
  failure_reason: string | null
  card_last4: string | null
  retry_at: Date | null
  attempt: number | null
}

const paymentColumns = (tx: ScopedSql) => tx`
  c.id, date_trunc('milliseconds', c.charged_at) as charged_at, c.store_id, s.name as store_name, c.kind, c.status,
  c.amount::text as amount, c.currency, c.failure_reason, c.card_last4, c.retry_at, c.attempt
`

const asPayment = (r: Omit<PaymentRow, 'amount'> & { amount: string }): PaymentRow => ({ ...r, amount: minorUnits(r.amount) })

/** Newest first. */
export const selectPayments = async (tx: ScopedSql, partnerId: string, page: KeysetPage, limit: number): Promise<PaymentRow[]> => {
  const backwards = page.before !== undefined
  const rows = await tx<(Omit<PaymentRow, 'amount'> & { amount: string })[]>`
    select ${paymentColumns(tx)} from merchant_charge c join store s on s.id = c.store_id
    where c.partner_id = ${partnerId}
      ${page.after !== undefined ? tx`and (date_trunc('milliseconds', c.charged_at), c.id) < (${page.after.occurredAt}, ${page.after.id}::uuid)` : tx``}
      ${page.before !== undefined ? tx`and (date_trunc('milliseconds', c.charged_at), c.id) > (${page.before.occurredAt}, ${page.before.id}::uuid)` : tx``}
    ${backwards ? tx`order by date_trunc('milliseconds', c.charged_at) asc, c.id asc` : tx`order by date_trunc('milliseconds', c.charged_at) desc, c.id desc`}
    limit ${limit + 1}
  `
  return (backwards ? rows.reverse() : rows).map(asPayment)
}

/** "Failed, being retried": the next retry first. */
export const selectRetrying = async (tx: ScopedSql, partnerId: string, limit: number): Promise<PaymentRow[]> =>
  (
    await tx<(Omit<PaymentRow, 'amount'> & { amount: string })[]>`
    select ${paymentColumns(tx)} from merchant_charge c join store s on s.id = c.store_id
    where c.partner_id = ${partnerId} and c.status = 'failed' and c.retry_at is not null
    order by c.retry_at, c.id limit ${limit}
  `
  ).map(asPayment)

export const countRetrying = async (tx: ScopedSql, partnerId: string): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from merchant_charge where partner_id = ${partnerId} and status = 'failed' and retry_at is not null`)[0]?.n ?? 0

export interface PayoutRow {
  id: string
  period_start: Date
  currency: string
  gross: number
  fee: number
  adjustments: number
  adjustment_note: string | null
  amount: number
  status: 'scheduled' | 'paid' | 'held' | 'failed'
  scheduled_for: Date
  paid_at: Date | null
  to_last4: string | null
}

type PayoutText = Omit<PayoutRow, 'gross' | 'fee' | 'adjustments' | 'amount'> & { gross: string; fee: string; adjustments: string; amount: string }

// A date as its UTC midnight, never the session's zone's: the period is a calendar month.

/** Newest period first; the cursor's time is the period's start. */
export const selectPayouts = async (tx: ScopedSql, partnerId: string, page: KeysetPage, limit: number): Promise<PayoutRow[]> => {
  const backwards = page.before !== undefined
  const start = tx`(period_start::timestamp at time zone 'UTC')`
  const rows = await tx<PayoutText[]>`
    select id, ${start} as period_start, currency, gross::text, fee::text, adjustments::text, adjustment_note, amount::text, status, (scheduled_for::timestamp at time zone 'UTC') as scheduled_for, paid_at, to_last4
    from partner_payout where partner_id = ${partnerId}
      ${page.after !== undefined ? tx`and (${start}, id) < (${page.after.occurredAt}, ${page.after.id}::uuid)` : tx``}
      ${page.before !== undefined ? tx`and (${start}, id) > (${page.before.occurredAt}, ${page.before.id}::uuid)` : tx``}
    ${backwards ? tx`order by period_start asc, id asc` : tx`order by period_start desc, id desc`}
    limit ${limit + 1}
  `
  return (backwards ? rows.reverse() : rows).map((r) => ({ ...r, gross: minorUnits(r.gross), fee: minorUnits(r.fee), adjustments: minorUnits(r.adjustments), amount: minorUnits(r.amount) }))
}

/** What the partner's share comes to so far in a period, net of refunds, in its payout currency. */
export const selectShareSince = async (tx: ScopedSql, partnerId: string, from: Date, to: Date): Promise<{ currency: string; amount: number } | null> => {
  const row = (
    await tx<{ currency: string; amount: string }[]>`
      select payout_currency as currency,
        (coalesce(sum(partner_amount) filter (where status in ('paid', 'recovered') and kind <> 'refund'), 0)
          - coalesce(sum(partner_amount) filter (where kind = 'refund'), 0))::text as amount
      from merchant_charge where partner_id = ${partnerId} and charged_at >= ${from} and charged_at < ${to}
      group by payout_currency
    `
  )[0]
  return row ? { currency: row.currency, amount: minorUnits(row.amount) } : null
}

export const anyCollected = async (tx: ScopedSql, partnerId: string): Promise<boolean> =>
  (await tx<{ any: boolean }[]>`select exists (select 1 from merchant_charge where partner_id = ${partnerId} and status in ('paid', 'recovered')) as any`)[0]?.any ?? false

export interface InvoiceRow {
  id: string
  stripe_invoice_id: string
  number: string | null
  what: string
  amount: number
  currency: string
  status: 'open' | 'paid' | 'void'
  issued_at: Date
  due_at: Date | null
  paid_at: Date | null
}

type InvoiceText = Omit<InvoiceRow, 'amount'> & { amount: string }

export const selectInvoices = async (tx: ScopedSql, partnerId: string, page: KeysetPage, limit: number): Promise<InvoiceRow[]> => {
  const backwards = page.before !== undefined
  const rows = await tx<InvoiceText[]>`
    select id, stripe_invoice_id, number, what, amount::text, currency, status, date_trunc('milliseconds', issued_at) as issued_at, due_at, paid_at
    from partner_invoice where partner_id = ${partnerId} and status <> 'void'
      ${page.after !== undefined ? tx`and (date_trunc('milliseconds', issued_at), id) < (${page.after.occurredAt}, ${page.after.id}::uuid)` : tx``}
      ${page.before !== undefined ? tx`and (date_trunc('milliseconds', issued_at), id) > (${page.before.occurredAt}, ${page.before.id}::uuid)` : tx``}
    ${backwards ? tx`order by date_trunc('milliseconds', issued_at) asc, id asc` : tx`order by date_trunc('milliseconds', issued_at) desc, id desc`}
    limit ${limit + 1}
  `
  return (backwards ? rows.reverse() : rows).map((r) => ({ ...r, amount: minorUnits(r.amount) }))
}

export const selectInvoice = async (tx: ScopedSql, partnerId: string, id: string): Promise<InvoiceRow | null> => {
  const row = (
    await tx<InvoiceText[]>`select id, stripe_invoice_id, number, what, amount::text, currency, status, issued_at, due_at, paid_at from partner_invoice where partner_id = ${partnerId} and id = ${id}`
  )[0]
  return row ? { ...row, amount: minorUnits(row.amount) } : null
}

// ---- The webhook (app_system) ----

/** True the first time an event id is seen; a replay answers false and changes nothing (SAAS §7.2). */
export const insertBillingEvent = async (tx: ScopedSql, e: { id: string; type: string; partnerId: string | null; storeId: string | null; at: Date }): Promise<boolean> =>
  (await tx`insert into billing_event (id, type, partner_id, store_id, received_at, handled_at) values (${e.id}, ${e.type}, ${e.partnerId}, ${e.storeId}, ${e.at}, ${e.at}) on conflict (id) do nothing returning id`).length === 1

export const setEventPartner = async (tx: ScopedSql, eventId: string, partnerId: string): Promise<void> => {
  await tx`update billing_event set partner_id = ${partnerId} where id = ${eventId}`
}

export const selectPartnerByAccount = async (tx: ScopedSql, accountId: string): Promise<string | null> =>
  (await tx<{ partner_id: string }[]>`select partner_id from partner_billing_account where stripe_account_id = ${accountId}`)[0]?.partner_id ?? null

export const selectPartnerByCustomer = async (tx: ScopedSql, customerId: string): Promise<string | null> =>
  (await tx<{ partner_id: string }[]>`select partner_id from partner_billing_account where stripe_customer_id = ${customerId}`)[0]?.partner_id ?? null

/** The store a merchant invoice is for, when its Stripe customer is that store's own. */
export const selectStoreByCustomer = async (tx: ScopedSql, storeId: string, customerId: string): Promise<{ store_id: string; partner_id: string } | null> =>
  (await tx<{ store_id: string; partner_id: string }[]>`select store_id, partner_id from store_subscription where store_id = ${storeId} and stripe_customer_id = ${customerId}`)[0] ?? null

export interface ChargeUpsert {
  stripeRef: string
  partnerId: string
  storeId: string
  kind: 'subscription' | 'proration' | 'refund'
  status: 'paid' | 'failed' | 'refunded' | 'recovered'
  amount: number
  currency: string
  payoutCurrency: string
  payoutGross: number
  fee: number
  cardLast4: string | null
  failureReason: string | null
  invoiceId: string | null
  retryAt: Date | null
  attempt: number | null
  chargedAt: Date
}

/**
 * The row as Stripe has it now, whatever order the events came in. Paid is final on a Stripe
 * invoice, so a read that saw it unpaid but committed later never takes a paid row back.
 */
export const upsertCharge = async (tx: ScopedSql, c: ChargeUpsert): Promise<void> => {
  await tx`
    insert into merchant_charge (stripe_ref, partner_id, store_id, kind, status, amount, currency, payout_currency, payout_gross, fee_amount, partner_amount, card_last4, failure_reason, invoice_id, retry_at, attempt, charged_at)
    values (${c.stripeRef}, ${c.partnerId}, ${c.storeId}, ${c.kind}, ${c.status}, ${c.amount}, ${c.currency}, ${c.payoutCurrency}, ${c.payoutGross}, ${c.fee}, ${c.payoutGross - c.fee}, ${c.cardLast4}, ${c.failureReason}, ${c.invoiceId}, ${c.retryAt}, ${c.attempt}, ${c.chargedAt})
    on conflict (stripe_ref) do update set
      status = excluded.status, amount = excluded.amount, payout_gross = excluded.payout_gross, fee_amount = excluded.fee_amount,
      partner_amount = excluded.partner_amount, card_last4 = excluded.card_last4, failure_reason = excluded.failure_reason,
      retry_at = excluded.retry_at, attempt = excluded.attempt, charged_at = excluded.charged_at
    where not (merchant_charge.status in ('paid', 'recovered', 'refunded') and excluded.status = 'failed')
  `
}

export const selectChargeByRef = async (tx: ScopedSql, stripeRef: string): Promise<{ amount: number; payout_gross: number; fee_amount: number; payout_currency: string; partner_id: string; store_id: string } | null> => {
  const row = (
    await tx<{ amount: string; payout_gross: string; fee_amount: string; payout_currency: string; partner_id: string; store_id: string }[]>`
      select amount::text, payout_gross::text, fee_amount::text, payout_currency, partner_id, store_id from merchant_charge where stripe_ref = ${stripeRef}
    `
  )[0]
  return row ? { ...row, amount: minorUnits(row.amount), payout_gross: minorUnits(row.payout_gross), fee_amount: minorUnits(row.fee_amount) } : null
}

export interface PayoutUpsert {
  stripePayoutId: string
  partnerId: string
  periodStart: Date
  periodEnd: Date
  currency: string
  gross: number
  fee: number
  amount: number
  stores: number
  status: 'scheduled' | 'paid' | 'failed'
  scheduledFor: Date
  paidAt: Date | null
  toLast4: string | null
  failureReason: string | null
}

/** Stripe's payout amount is what was paid; what it doesn't explain beside the month's charges is the adjustment. */
export const upsertPayout = async (tx: ScopedSql, p: PayoutUpsert): Promise<void> => {
  const adjustments = p.amount - (p.gross - p.fee)
  await tx`
    insert into partner_payout (partner_id, period_start, period_end, currency, gross, fee, adjustments, amount, stores, status, scheduled_for, paid_at, stripe_payout_id, to_last4, failure_reason)
    values (${p.partnerId}, ${p.periodStart}, ${p.periodEnd}, ${p.currency}, ${p.gross}, ${p.fee}, ${adjustments}, ${p.amount}, ${p.stores}, ${p.status}, ${p.scheduledFor}, ${p.paidAt}, ${p.stripePayoutId}, ${p.toLast4}, ${p.failureReason})
    on conflict (partner_id, period_start) do update set
      gross = excluded.gross, fee = excluded.fee, adjustments = excluded.adjustments, amount = excluded.amount, stores = excluded.stores,
      status = excluded.status, scheduled_for = excluded.scheduled_for, paid_at = excluded.paid_at, stripe_payout_id = excluded.stripe_payout_id,
      to_last4 = excluded.to_last4, failure_reason = excluded.failure_reason, held_reason = null
    where not (partner_payout.status in ('paid', 'failed') and excluded.status = 'scheduled')
  `
}

/** A period's charges as the payout counts them, net of refunds, and how many stores paid. */
export const selectPeriodTotals = async (tx: ScopedSql, partnerId: string, from: Date, to: Date): Promise<{ gross: number; fee: number; stores: number }> => {
  const row = (
    await tx<{ gross: string; fee: string; stores: number }[]>`
      select
        (coalesce(sum(payout_gross) filter (where kind <> 'refund' and status in ('paid', 'recovered')), 0) - coalesce(sum(payout_gross) filter (where kind = 'refund'), 0))::text as gross,
        (coalesce(sum(fee_amount) filter (where kind <> 'refund' and status in ('paid', 'recovered')), 0) - coalesce(sum(fee_amount) filter (where kind = 'refund'), 0))::text as fee,
        count(distinct store_id) filter (where kind <> 'refund' and status in ('paid', 'recovered'))::int as stores
      from merchant_charge where partner_id = ${partnerId} and charged_at >= ${from} and charged_at < ${to}
    `
  )[0]
  return { gross: minorUnits(row?.gross ?? '0'), fee: minorUnits(row?.fee ?? '0'), stores: row?.stores ?? 0 }
}

export const upsertPartnerInvoice = async (
  tx: ScopedSql,
  i: { partnerId: string; stripeInvoiceId: string; number: string | null; what: string; amount: number; currency: string; status: 'open' | 'paid' | 'void'; issuedAt: Date; dueAt: Date | null; paidAt: Date | null },
): Promise<void> => {
  await tx`
    insert into partner_invoice (partner_id, stripe_invoice_id, number, what, amount, currency, status, issued_at, due_at, paid_at)
    values (${i.partnerId}, ${i.stripeInvoiceId}, ${i.number}, ${i.what}, ${i.amount}, ${i.currency}, ${i.status}, ${i.issuedAt}, ${i.dueAt}, ${i.paidAt})
    on conflict (stripe_invoice_id) do update set number = excluded.number, what = excluded.what, amount = excluded.amount, status = excluded.status, due_at = excluded.due_at, paid_at = excluded.paid_at
    where partner_invoice.status = 'open'
  `
}

/** The feed's freshness: the last event handled for the partner, and since when Stripe has been slow. */
export const touchBillingFeed = async (tx: ScopedSql, partnerId: string, at: Date, stale: boolean): Promise<void> => {
  await tx`
    insert into partner_billing_feed (partner_id, synced_at, stale_since) values (${partnerId}, ${at}, ${stale ? at : null})
    on conflict (partner_id) do update set
      synced_at = case when ${stale} then partner_billing_feed.synced_at else excluded.synced_at end,
      stale_since = case when ${stale} then coalesce(partner_billing_feed.stale_since, excluded.stale_since) else null end
  `
}

export const selectBillingFeed = async (tx: ScopedSql, partnerId: string): Promise<{ synced_at: Date; stale_since: Date | null } | null> =>
  (await tx<{ synced_at: Date; stale_since: Date | null }[]>`select synced_at, stale_since from partner_billing_feed where partner_id = ${partnerId}`)[0] ?? null
