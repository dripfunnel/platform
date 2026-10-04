import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { type PartnerCaller, partnerContextOf } from '#auth/partnerCaller'
import { withScope, type ScopedSql } from '#db/scoped/index'
import {
  anyCollected,
  lockBillingAccount,
  saveBillingAccount,
  selectBillingAccount,
  selectBillingFeed,
  selectContractCurrency,
  selectInvoice,
  selectInvoices,
  selectPayments,
  selectPayouts,
  selectRetrying,
  selectShareSince,
  setBillingMode as writeBillingMode,
  type BillingAccountRow,
  type InvoiceRow,
  type PaymentRow,
  type PayoutRow,
} from '#db/scoped/partnerBilling'
import { selectCompany } from '#db/scoped/partnerTeam'
import { selectBillingMode } from '#db/scoped/partnerConsole'
import { StripeRefused, StripeUnavailable, type StripeApi, type StripeBankAccount } from '#integrations/stripe/index'
import { partnerEntry, type PageInfo } from '#saas/activity/index'
import { decodePage, pageOf, type PageRequest } from '#saas/staff/index'

// Billing on the Platform API (ui/platform/FIRST-RELEASE.md §11, §14.3; SAAS §7; #201): the
// partner's merchants' payments, its payouts and DripFunnel's invoices, who bills, and the payout
// account and card, which reach Stripe only as tokens made in the browser.

export const billingAudit = {
  setBillingMode: 'partner.billing_mode_set',
  setPayoutAccount: 'partner.payout_account_set',
  setPaymentMethod: 'partner.payment_method_set',
} as const

export const billingPageSize = 25
const retryingMax = 20
// Billing's retry schedule on DripFunnel's Stripe account (Revenue recovery): four tries, the
// prototype's "attempt 4 of 4". When the dunning policy is decided (SAAS §7.3) this follows it.
export const retryAttempts = 4

export type BillingRefusal = 'INVALID_INPUT' | 'NOT_FOUND' | 'NOT_CONNECTED' | 'PROVIDER_UNAVAILABLE' | 'TOKEN_REFUSED' | 'NO_COUNTRY' | 'NO_PDF'
export type BillingResult = { ok: true } | { ok: false; reason: BillingRefusal }

// Only Stripe's own tokens: a bank account from Stripe.js (`btok_`) and a card from its hosted
// field (`pm_`). A number in either is refused before anything else looks at it.
const bankToken = z.string().regex(/^btok_[A-Za-z0-9]{6,}$/)
const cardToken = z.string().regex(/^pm_[A-Za-z0-9]{6,}$/)
const modeInput = z.enum(['dripfunnel', 'own'])
const id = z.guid()

export interface PartnerBillingDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  stripe: StripeApi | null
  now: () => Date
}

const money = (amount: number, currency: string) => ({ amount, currency })

const paymentDto = (p: PaymentRow) => ({
  id: p.id,
  at: p.charged_at,
  storeId: p.store_id,
  storeName: p.store_name,
  kind: p.kind,
  amount: money(p.amount, p.currency),
  status: p.status,
  note: p.failure_reason,
  cardLast4: p.card_last4,
})

const retryingDto = (p: PaymentRow) => ({
  storeId: p.store_id,
  storeName: p.store_name,
  amount: money(p.amount, p.currency),
  why: p.failure_reason,
  cardLast4: p.card_last4,
  retryAt: p.retry_at,
  attempt: p.attempt ?? 1,
  attempts: retryAttempts,
})

const payoutDto = (p: PayoutRow) => ({
  id: p.id,
  month: p.period_start.toISOString().slice(0, 7),
  collected: money(p.gross, p.currency),
  fee: money(p.fee, p.currency),
  adjustment: p.adjustments !== 0 ? { amount: money(p.adjustments, p.currency), note: p.adjustment_note } : null,
  payout: money(p.amount, p.currency),
  paidOn: p.paid_at,
  status: p.status,
  toLast4: p.to_last4,
})

const invoiceDto = (i: InvoiceRow, at: Date) => ({
  id: i.id,
  number: i.number,
  at: i.issued_at,
  what: i.what,
  amount: money(i.amount, i.currency),
  status: i.status === 'open' && i.due_at !== null && i.due_at < at ? ('overdue' as const) : i.status,
})

const payoutAccountDto = (a: BillingAccountRow | null) => ({
  bank: a?.payout_bank ?? null,
  last4: a?.payout_last4 ?? null,
  status: a?.payout_status ?? ('missing' as const),
  failure: a?.payout_failure ?? null,
})

const paymentMethodDto = (a: BillingAccountRow | null) => ({
  brand: a?.card_brand ?? null,
  last4: a?.card_last4 ?? null,
  expires: a?.card_expires ? a.card_expires.toISOString().slice(0, 7) : null,
  status: a?.card_status ?? ('missing' as const),
})

/** Stripe's bank account states, in the console's four (§14.3). */
export const payoutStatusOf = (status: StripeBankAccount['status']): 'verifying' | 'verified' | 'failed' =>
  status === 'verified' ? 'verified' : status === 'verification_failed' || status === 'errored' ? 'failed' : 'verifying'

const monthStart = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
const nextMonthStart = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))

export type NextPayout =
  | { state: 'scheduled'; date: string; soFar: { amount: number; currency: string }; toLast4: string | null }
  | { state: 'heldVerification' }
  | { state: 'first' }

export const createPartnerBillingService = ({ sql, caller, facts, activity, stripe, now }: PartnerBillingDeps) => {
  const partnerId = caller.partner.id
  const context = partnerContextOf(caller)
  const entry = partnerEntry(caller, facts)
  const read = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)

  /** The retrying block rides on the first page only. Null for a cursor it cannot read. */
  const merchantPayments = (page: PageRequest) => {
    const decoded = decodePage(page, billingPageSize)
    if (!decoded.ok) return Promise.resolve(null)
    return read(async (tx) => {
      const rows = await selectPayments(tx, partnerId, decoded, decoded.limit)
      const { rows: pageRows, pageInfo } = pageOf(rows, decoded, (r) => ({ occurredAt: r.charged_at, id: r.id }))
      const first = decoded.after === undefined && decoded.before === undefined
      return { failed: first ? (await selectRetrying(tx, partnerId, retryingMax)).map(retryingDto) : [], items: pageRows.map(paymentDto), pageInfo }
    })
  }

  const payouts = (page: PageRequest): Promise<{ items: ReturnType<typeof payoutDto>[]; pageInfo: PageInfo } | null> => {
    const decoded = decodePage(page, billingPageSize)
    if (!decoded.ok) return Promise.resolve(null)
    return read(async (tx) => {
      const rows = await selectPayouts(tx, partnerId, decoded, decoded.limit)
      const { rows: pageRows, pageInfo } = pageOf(rows, decoded, (r) => ({ occurredAt: r.period_start, id: r.id }))
      return { items: pageRows.map(payoutDto), pageInfo }
    })
  }

  // §11.2's four states. A lapsed contract has no model yet (FIRST-RELEASE §18), so "held: your
  // contract lapsed" is never answered rather than guessed.
  const nextPayout = (): Promise<NextPayout> =>
    read(async (tx) => {
      if (!(await anyCollected(tx, partnerId))) return { state: 'first' }
      const account = await selectBillingAccount(tx, partnerId)
      if (account?.payout_status !== 'verified') return { state: 'heldVerification' }
      const at = now()
      const share = await selectShareSince(tx, partnerId, monthStart(at), nextMonthStart(at))
      const currency = share?.currency ?? (await selectContractCurrency(tx, partnerId)) ?? 'USD'
      return { state: 'scheduled', date: nextMonthStart(at).toISOString().slice(0, 10), soFar: money(share?.amount ?? 0, currency), toLast4: account.payout_last4 }
    })

  const partnerInvoices = (page: PageRequest) => {
    const decoded = decodePage(page, billingPageSize)
    if (!decoded.ok) return Promise.resolve(null)
    return read(async (tx) => {
      const rows = await selectInvoices(tx, partnerId, decoded, decoded.limit)
      const { rows: pageRows, pageInfo } = pageOf(rows, decoded, (r) => ({ occurredAt: r.issued_at, id: r.id }))
      const at = now()
      return { items: pageRows.map((r) => invoiceDto(r, at)), pageInfo }
    })
  }

  const billingSettings = () =>
    read(async (tx) => {
      const feed = await selectBillingFeed(tx, partnerId)
      return {
        mode: await selectBillingMode(tx, partnerId),
        payoutAccount: payoutAccountDto(await selectBillingAccount(tx, partnerId)),
        // The stale strip (§11, CONSOLE-DESIGN H7): when Stripe last told us something, and since when it has been slow.
        asOf: feed?.synced_at ?? null,
        staleSince: feed?.stale_since ?? null,
      }
    })

  const payoutAccount = () => read(async (tx) => payoutAccountDto(await selectBillingAccount(tx, partnerId)))
  const paymentMethod = () => read(async (tx) => paymentMethodDto(await selectBillingAccount(tx, partnerId)))

  const setBillingMode = (raw: unknown): Promise<BillingResult> => {
    const mode = modeInput.safeParse(raw)
    if (!mode.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    return read(async (tx): Promise<BillingResult> => {
      const before = await selectBillingMode(tx, partnerId)
      if (before === mode.data) return { ok: true }
      await writeBillingMode(tx, partnerId, mode.data)
      await activity.record(tx, entry({ action: billingAudit.setBillingMode, target: { type: 'partner', id: partnerId, label: caller.partner.name }, reason: null, changes: [{ field: 'billing_mode', before, after: mode.data }] }))
      return { ok: true }
    })
  }

  /** Stripe's answer as a refusal the console words; anything else is a real error. */
  const providerRefusal = (error: unknown): BillingResult => {
    if (error instanceof StripeUnavailable) return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
    if (error instanceof StripeRefused) return { ok: false, reason: 'TOKEN_REFUSED' }
    throw error
  }

  // §14.3: the bank account goes to the partner's Connect account; Stripe's test deposit verifies
  // it and the webhook moves it to Verified or Verification failed.
  const setPayoutAccount = (raw: unknown): Promise<BillingResult> => {
    const token = bankToken.safeParse(raw)
    if (!token.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    if (!stripe) return Promise.resolve({ ok: false, reason: 'NOT_CONNECTED' })
    return read(async (tx): Promise<BillingResult> => {
      await lockBillingAccount(tx, partnerId)
      const account = await selectBillingAccount(tx, partnerId)
      let accountId = account?.stripe_account_id ?? null
      try {
        if (!accountId) {
          const country = (await selectCompany(tx, partnerId))?.country ?? null
          if (!country || !/^[A-Z]{2}$/.test(country)) return { ok: false, reason: 'NO_COUNTRY' }
          accountId = (await stripe.createAccount({ partnerId, country, email: null })).id
        }
        const bank = await stripe.addBankAccount(accountId, token.data)
        const at = now()
        await saveBillingAccount(tx, partnerId, { stripe_account_id: accountId, payout_bank: bank.bank_name ?? null, payout_last4: bank.last4, payout_status: payoutStatusOf(bank.status), payout_failure: null }, at)
        await activity.record(
          tx,
          entry({ action: billingAudit.setPayoutAccount, target: { type: 'partner', id: partnerId, label: caller.partner.name }, reason: null, changes: [{ field: 'payout_account_last4', before: account?.payout_last4 ?? null, after: bank.last4 }] }),
        )
        return { ok: true }
      } catch (error) {
        // The Connect account Stripe made is kept: its idempotency key makes the retry find it.
        if (accountId && accountId !== account?.stripe_account_id) await saveBillingAccount(tx, partnerId, { stripe_account_id: accountId }, now())
        return providerRefusal(error)
      }
    })
  }

  // §14.3: the card Stripe's hosted field turned into a payment method, for DripFunnel's invoices.
  const setPaymentMethod = (raw: unknown): Promise<BillingResult> => {
    const token = cardToken.safeParse(raw)
    if (!token.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    if (!stripe) return Promise.resolve({ ok: false, reason: 'NOT_CONNECTED' })
    return read(async (tx): Promise<BillingResult> => {
      await lockBillingAccount(tx, partnerId)
      const account = await selectBillingAccount(tx, partnerId)
      let customerId = account?.stripe_customer_id ?? null
      try {
        if (!customerId) customerId = (await stripe.createCustomer({ partnerId, name: caller.partner.name })).id
        const { card } = await stripe.attachCard(customerId, token.data)
        await saveBillingAccount(
          tx,
          partnerId,
          { stripe_customer_id: customerId, card_brand: card.brand, card_last4: card.last4, card_expires: new Date(Date.UTC(card.exp_year, card.exp_month - 1, 1)), card_status: 'on_file' },
          now(),
        )
        await activity.record(
          tx,
          entry({ action: billingAudit.setPaymentMethod, target: { type: 'partner', id: partnerId, label: caller.partner.name }, reason: null, changes: [{ field: 'card_last4', before: account?.card_last4 ?? null, after: card.last4 }] }),
        )
        return { ok: true }
      } catch (error) {
        if (customerId && customerId !== account?.stripe_customer_id) await saveBillingAccount(tx, partnerId, { stripe_customer_id: customerId }, now())
        return providerRefusal(error)
      }
    })
  }

  // §11.3 "Tax invoice (PDF)": Stripe's own link to the PDF, read fresh because it expires.
  const downloadInvoice = async (rawId: unknown): Promise<{ ok: true; url: string } | { ok: false; reason: BillingRefusal }> => {
    if (!id.safeParse(rawId).success) return { ok: false, reason: 'NOT_FOUND' }
    const invoice = await read((tx) => selectInvoice(tx, partnerId, String(rawId)))
    if (!invoice) return { ok: false, reason: 'NOT_FOUND' }
    if (!stripe) return { ok: false, reason: 'NOT_CONNECTED' }
    try {
      const url = (await stripe.invoice(invoice.stripe_invoice_id)).invoice_pdf ?? null
      if (!url || !/^https:\/\/([a-z0-9-]+\.)*stripe\.com\//.test(url)) return { ok: false, reason: 'NO_PDF' }
      return { ok: true, url }
    } catch (error) {
      const refused = providerRefusal(error)
      return refused.ok ? { ok: false, reason: 'NO_PDF' } : refused
    }
  }

  return { merchantPayments, payouts, nextPayout, partnerInvoices, billingSettings, payoutAccount, paymentMethod, setBillingMode, setPayoutAccount, setPaymentMethod, downloadInvoice }
}

export type PartnerBillingService = ReturnType<typeof createPartnerBillingService>
