import type { Keyset } from '#core/cursor'
import { pageLimit, type ScopedSql } from './index'

// The store's own billing (migrations/0014, 0140; DATA-MODEL §7.9). The subscription is read and written in system
// scope by billing alone, always by the caller's own store id; the details and invoices are read in the store's scope.

export interface BillingSubscriptionRow {
  store_id: string
  partner_id: string
  plan_id: string
  plan_version: number
  plan_name: string
  status: 'trial' | 'active' | 'past_due' | 'cancelled'
  interval: 'month' | 'year'
  currency: string
  amount: number
  period_start: Date
  period_end: Date
  trial_ends_at: Date | null
  cancel_at: Date | null
  next_plan_id: string | null
  next_plan_version: number | null
  next_plan_name: string | null
  next_interval: 'month' | 'year' | null
  change_at: Date | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  payment_method_brand: string | null
  payment_method_last4: string | null
  payment_method_expires: Date | null
  partner_name: string
  billing_mode: 'dripfunnel' | 'own'
  store_name: string
  store_status: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled' | 'closed'
  /** When Stripe last told billing anything about this partner's money, for "may be minutes behind" (SAAS §7.2). */
  synced_at: Date | null
}

const subscriptionColumns = (tx: ScopedSql) => tx`
  select sub.store_id, sub.partner_id, sub.plan_id, sub.plan_version, p.name as plan_name, sub.status, sub.interval, sub.currency, sub.amount,
    sub.period_start, sub.period_end, sub.trial_ends_at, sub.cancel_at, sub.next_plan_id, sub.next_plan_version, np.name as next_plan_name,
    sub.next_interval, sub.change_at, sub.stripe_customer_id, sub.stripe_subscription_id, sub.payment_method_brand, sub.payment_method_last4,
    sub.payment_method_expires, pa.name as partner_name, pa.billing_mode, s.name as store_name, s.status as store_status, f.synced_at
  from store_subscription sub
  join store s on s.id = sub.store_id
  join plan p on p.id = sub.plan_id
  join partner pa on pa.id = sub.partner_id
  left join plan np on np.id = sub.next_plan_id
  left join partner_billing_feed f on f.partner_id = sub.partner_id
`

export const selectBillingSubscription = async (tx: ScopedSql, storeId: string, lock = false): Promise<BillingSubscriptionRow | null> =>
  (await tx<BillingSubscriptionRow[]>`${subscriptionColumns(tx)} where sub.store_id = ${storeId} ${lock ? tx`for update of sub` : tx``}`)[0] ?? null

/** The store a subscription event is for, when its Stripe subscription is that store's own. */
export const selectStoreBySubscription = async (tx: ScopedSql, storeId: string, subscriptionId: string): Promise<BillingSubscriptionRow | null> =>
  (await tx<BillingSubscriptionRow[]>`${subscriptionColumns(tx)} where sub.store_id = ${storeId} and sub.stripe_subscription_id = ${subscriptionId} for update of sub`)[0] ?? null

/** Takes the store's billing claim when none is held or the last one lapsed; null while another change is under way. */
export const claimBilling = async (tx: ScopedSql, storeId: string, at: Date, until: Date): Promise<string | null> => {
  const claim = crypto.randomUUID()
  const rows = await tx`
    update store_subscription set billing_claim = ${claim}, billing_claim_until = ${until}
    where store_id = ${storeId} and (billing_claim is null or billing_claim_until < ${at}) returning store_id
  `
  return rows.length === 1 ? claim : null
}

export const releaseBilling = async (tx: ScopedSql, storeId: string, claim: string): Promise<void> => {
  await tx`update store_subscription set billing_claim = null, billing_claim_until = null where store_id = ${storeId} and billing_claim = ${claim}`
}

export const saveStripeCustomer = async (tx: ScopedSql, storeId: string, customerId: string): Promise<void> => {
  await tx`update store_subscription set stripe_customer_id = ${customerId} where store_id = ${storeId} and stripe_customer_id is null`
}

export const saveCard = async (tx: ScopedSql, storeId: string, card: { brand: string; last4: string; expires: Date }): Promise<void> => {
  await tx`
    update store_subscription set payment_method_brand = ${card.brand}, payment_method_last4 = ${card.last4}, payment_method_expires = ${card.expires}
    where store_id = ${storeId}
  `
}

export interface PlanMove {
  planId: string
  planVersion: number
  interval: 'month' | 'year'
  amount: number
}

/** The store is on the plan from now, its period Stripe's; any scheduled change is gone. store.plan_id mirrors it (§7.9). */
export const applyPlan = async (tx: ScopedSql, storeId: string, move: PlanMove & { subscriptionId: string | null; periodStart: Date; periodEnd: Date }): Promise<void> => {
  await tx`
    update store_subscription set plan_id = ${move.planId}, plan_version = ${move.planVersion}, interval = ${move.interval}, amount = ${move.amount},
      stripe_subscription_id = coalesce(${move.subscriptionId}, stripe_subscription_id), period_start = ${move.periodStart}, period_end = ${move.periodEnd},
      status = case when status = 'trial' then 'active' else status end, trial_ends_at = case when status = 'trial' then null else trial_ends_at end,
      next_plan_id = null, next_plan_version = null, next_interval = null, change_at = null
    where store_id = ${storeId}
  `
  await tx`update store set plan_id = ${move.planId}, trial_ends_at = null where id = ${storeId}`
}

export const scheduleChange = async (tx: ScopedSql, storeId: string, move: PlanMove & { at: Date }): Promise<void> => {
  await tx`
    update store_subscription set next_plan_id = ${move.planId}, next_plan_version = ${move.planVersion}, next_interval = ${move.interval}, change_at = ${move.at}
    where store_id = ${storeId}
  `
}

export const clearScheduledChange = async (tx: ScopedSql, storeId: string): Promise<void> => {
  await tx`update store_subscription set next_plan_id = null, next_plan_version = null, next_interval = null, change_at = null where store_id = ${storeId}`
}

/** What Stripe says of the subscription now: its status and period, never the plan, which the service moves (SAAS §7.2). */
export const syncSubscription = async (tx: ScopedSql, storeId: string, s: { status: BillingSubscriptionRow['status']; periodStart: Date; periodEnd: Date; cancelAt: Date | null }): Promise<void> => {
  await tx`
    update store_subscription set status = ${s.status}, period_start = ${s.periodStart}, period_end = ${s.periodEnd}, cancel_at = ${s.cancelAt}
    where store_id = ${storeId}
  `
}

// ---- The Owner's details (store scope) ----

export interface BillingDetailsRow {
  legal_name: string
  address: Record<string, string>
  email: string
  tax_id: string | null
  tax_id_kind: 'gstin' | 'vat' | null
  updated_at: Date
}

export const selectBillingDetails = async (tx: ScopedSql, storeId: string): Promise<BillingDetailsRow | null> =>
  (await tx<BillingDetailsRow[]>`select legal_name, address, email, tax_id, tax_id_kind, updated_at from store_billing_details where store_id = ${storeId}`)[0] ?? null

export const upsertBillingDetails = async (tx: ScopedSql, storeId: string, d: Omit<BillingDetailsRow, 'updated_at'>, at: Date): Promise<void> => {
  await tx`
    insert into store_billing_details (store_id, legal_name, address, email, tax_id, tax_id_kind, updated_at)
    values (${storeId}, ${d.legal_name}, ${JSON.stringify(d.address)}::text::jsonb, ${d.email}, ${d.tax_id}, ${d.tax_id_kind}, ${at})
    on conflict (store_id) do update set legal_name = excluded.legal_name, address = excluded.address, email = excluded.email,
      tax_id = excluded.tax_id, tax_id_kind = excluded.tax_id_kind, updated_at = excluded.updated_at
  `
}

// ---- Invoices ----

export interface StoreInvoiceRow {
  id: string
  stripe_invoice_id: string
  number: string | null
  kind: 'subscription' | 'proration' | 'setup' | 'usage' | 'credit'
  status: 'paid' | 'open' | 'void' | 'refunded'
  amount: string
  tax_amount: string
  currency: string
  issued_at: Date
  paid_at: Date | null
  lines: { label: string; amount: string; kind: string; period_start: string | null; period_end: string | null }[]
}

const invoiceColumns = (tx: ScopedSql) => tx`
  select i.id, i.stripe_invoice_id, i.number, i.kind, i.status, i.amount::text, i.tax_amount::text, i.currency, i.issued_at, i.paid_at,
    coalesce((select json_agg(json_build_object('label', l.label, 'amount', l.amount::text, 'kind', l.kind, 'period_start', l.period_start, 'period_end', l.period_end) order by l.position)
      from invoice_line l where l.invoice_id = i.id), '[]'::json) as lines
  from invoice i
`

/** Newest first, a keyset page at a time. */
export const selectStoreInvoices = (tx: ScopedSql, storeId: string, page: { after?: Keyset | undefined; before?: Keyset | undefined }, limit: number): Promise<StoreInvoiceRow[]> =>
  tx<StoreInvoiceRow[]>`
    ${invoiceColumns(tx)} where i.store_id = ${storeId}
      ${page.after ? tx`and (i.issued_at, i.id) < (${page.after.occurredAt}, ${page.after.id}::uuid)` : tx``}
      ${page.before ? tx`and (i.issued_at, i.id) > (${page.before.occurredAt}, ${page.before.id}::uuid)` : tx``}
    order by i.issued_at ${page.before ? tx`asc` : tx`desc`}, i.id ${page.before ? tx`asc` : tx`desc`} limit ${pageLimit(limit) + 1}
  `

export const selectStoreInvoice = async (tx: ScopedSql, storeId: string, id: string): Promise<StoreInvoiceRow | null> =>
  (await tx<StoreInvoiceRow[]>`${invoiceColumns(tx)} where i.store_id = ${storeId} and i.id = ${id}`)[0] ?? null

export interface InvoiceUpsert {
  storeId: string
  stripeInvoiceId: string
  number: string | null
  kind: StoreInvoiceRow['kind']
  status: StoreInvoiceRow['status']
  amount: number
  taxAmount: number
  currency: string
  issuedAt: Date
  paidAt: Date | null
  lines: { label: string; amount: number; kind: 'plan' | 'proration_charge' | 'proration_credit'; periodStart: Date | null; periodEnd: Date | null }[]
}

/**
 * The invoice as Stripe has it now, its details snapshotted the first time it is seen and never after (SAAS §7.2).
 * Paid, void and refunded are final on Stripe, so a read that saw it open but committed later never takes one back.
 */
export const upsertStoreInvoice = async (tx: ScopedSql, i: InvoiceUpsert): Promise<void> => {
  const [row] = await tx<{ id: string; inserted: boolean }[]>`
    insert into invoice (store_id, stripe_invoice_id, number, kind, status, amount, tax_amount, currency, billing_details, issued_at, paid_at)
    values (${i.storeId}, ${i.stripeInvoiceId}, ${i.number}, ${i.kind}, ${i.status}, ${i.amount}, ${i.taxAmount}, ${i.currency},
      (select to_jsonb(d) - 'store_id' - 'updated_at' from store_billing_details d where d.store_id = ${i.storeId}), ${i.issuedAt}, ${i.paidAt})
    on conflict (stripe_invoice_id) do update set number = coalesce(excluded.number, invoice.number), status = excluded.status, amount = excluded.amount,
      tax_amount = excluded.tax_amount, paid_at = excluded.paid_at
    where invoice.store_id = excluded.store_id and not (invoice.status in ('paid', 'void', 'refunded') and excluded.status = 'open')
    returning id, (xmax = 0) as inserted
  `
  if (!row?.inserted || i.lines.length === 0) return
  const lines = i.lines.map((l, position) => ({ position, label: l.label, amount: l.amount, kind: l.kind, period_start: l.periodStart, period_end: l.periodEnd }))
  await tx`
    insert into invoice_line (invoice_id, store_id, position, label, amount, currency, kind, period_start, period_end)
    select ${row.id}, ${i.storeId}, l.position, l.label, l.amount, ${i.currency}, l.kind, l.period_start, l.period_end
    from json_to_recordset(${JSON.stringify(lines)}::text::json) as l(position int, label text, amount bigint, kind text, period_start timestamptz, period_end timestamptz)
  `
}

// ---- Dunning (SAAS §7.3) ----

/** Past-due stores whose 14 days are up, oldest first, locked for this sweep and skipped by any other. */
export const selectOverdueStores = (tx: ScopedSql, since: Date, limit: number): Promise<{ id: string }[]> =>
  tx<{ id: string }[]>`
    select id from store where status = 'past_due' and past_due_since <= ${since}
    order by past_due_since, id limit ${limit} for update skip locked
  `

// ---- The partner's plans, read for the merchant (system scope: plan_store_read shows a store only its own) ----

export interface CataloguePlanRow {
  id: string
  name: string
  description: string | null
  version: number
}

export const selectCataloguePlans = (tx: ScopedSql, partnerId: string): Promise<CataloguePlanRow[]> =>
  tx<CataloguePlanRow[]>`select id, name, description, version from plan where partner_id = ${partnerId} and status = 'live' order by name, id limit 100`

export const selectLivePlan = async (tx: ScopedSql, partnerId: string, planId: string): Promise<CataloguePlanRow | null> =>
  (await tx<CataloguePlanRow[]>`select id, name, description, version from plan where partner_id = ${partnerId} and id = ${planId} and status = 'live'`)[0] ?? null
