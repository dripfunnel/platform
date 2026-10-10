import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { StoreCaller } from '#auth/storeCaller'
import { euCountries } from '#core/countries'
import { encodeCursor } from '#core/cursor'
import { pageWith, type PageWindow } from '#core/paging'
import { withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import { selectStoreEntitlement } from '#db/scoped/entitlements'
import { countStoreProducts } from '#db/scoped/catalog'
import { countStaffSeats } from '#db/scoped/people'
import { countLiveSuppliers } from '#db/scoped/suppliers'
import { selectCurrentVersions } from '#db/scoped/partnerPlans'
import { planKeyDefs, UNLIMITED } from '#db/scoped/planKeys'
import { selectStoreAccount } from '#db/scoped/storeAccount'
import { selectStoreForUpdate } from '#db/scoped/stores'
import {
  applyPlan,
  bumpBillingRevision,
  claimBilling,
  clearScheduledChange,
  releaseBilling,
  saveCard,
  saveStripeCustomer,
  scheduleChange,
  selectBillingDetails,
  selectBillingSubscription,
  selectCataloguePlans,
  selectLivePlan,
  selectStoreInvoice,
  selectStoreInvoices,
  upsertBillingDetails,
  type BillingSubscriptionRow,
  type CataloguePlanRow,
} from '#db/scoped/storeBilling'
import { StripeRefused, StripeUnavailable, type StoreBillingStripe, type StripeApi, type StripeSubscription } from '#integrations/stripe/index'
import { taxIdOf } from '#engine/modules/storeInfo/index'
import { transitionStore } from '#saas/stores/index'
import { addInterval, offeredWays, quoteChange, type CurrentPlan, type Interval, type When } from './quote'

export { addInterval, offeredWays, quoteChange } from './quote'
export type { Interval, Quote, When } from './quote'
export { applyStoreSubscription, dunningLabel, suspendOverdueStores, suspendAfterDays } from './dunning'

// The store's Billing (FIRST-RELEASE §16, SAAS §7; card #329): the partner's plans, the plan change with its
// proration, the card that pays for the plan, the details on invoices, the invoices and this month's usage. The
// Owner's alone (`billing`); Stripe is called outside any transaction, under the store's billing claim.

export const storeBillingAudit = {
  changePlan: 'billing.plan_changed',
  scheduleChange: 'billing.change_scheduled',
  cancelChange: 'billing.change_cancelled',
  setPaymentMethod: 'billing.payment_method_set',
  saveBillingDetails: 'billing.details_saved',
} as const

export type StoreBillingRefusal =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'NOT_CONNECTED'
  | 'PROVIDER_UNAVAILABLE'
  | 'CARD_REFUSED'
  | 'PAYMENT_FAILED'
  | 'BILLED_BY_PARTNER'
  | 'NO_SUBSCRIPTION'
  | 'SAME_PLAN'
  | 'PLAN_NOT_LIVE'
  | 'NOT_PRICED'
  | 'AT_PERIOD_END_ONLY'
  | 'NO_CARD'
  | 'CHANGE_IN_PROGRESS'
  | 'CANCELLED'
  | 'NO_PDF'

export type StoreBillingResult<T> = { ok: true; value: T } | { ok: false; reason: StoreBillingRefusal }

const refused = (reason: StoreBillingRefusal): { ok: false; reason: StoreBillingRefusal } => ({ ok: false, reason })

/** How long a billing claim holds when its holder never lets go: well past Stripe's timeouts on every call it makes. */
const claimMs = 2 * 60_000

const cardToken = z.string().regex(/^pm_[A-Za-z0-9]{6,}$/)
const planChange = z.strictObject({ planId: z.guid(), interval: z.enum(['month', 'year']), when: z.enum(['now', 'period_end']) })

const text = (max: number) => z.string().trim().min(1).max(max)
const detailsInput = z.strictObject({
  legalName: text(200),
  email: z.email().max(254),
  address: z.strictObject({ line1: text(200), line2: text(200).nullish(), city: text(100), region: text(100).nullish(), postal: text(20), country: z.string().regex(/^[A-Z]{2}$/) }),
  taxId: z.string().max(30).nullish(),
})

/**
 * The tax number on invoices (SAAS §7.2: a GSTIN in India, a VAT number in the EU), read as Store info reads it;
 * `false` when it isn't one, or the country has no such number on DripFunnel's invoices.
 */
export const invoiceTaxIdOf = (raw: string | null | undefined, country: string): { tax_id: string; tax_id_kind: 'gstin' | 'vat' } | null | false => {
  if ((raw ?? '').trim() === '') return null
  if (country !== 'IN' && !euCountries.has(country)) return false
  const read = taxIdOf(country, raw ?? '')
  if (read?.kind === 'gst') return { tax_id: read.number, tax_id_kind: 'gstin' }
  if (read?.kind === 'vat') return { tax_id: read.number, tax_id_kind: 'vat' }
  return false
}

export interface StoreBillingDeps {
  sql: postgres.Sql
  caller: StoreCaller
  facts: RequestFacts
  activity: ActivityLog
  /** DripFunnel's platform Stripe account; null where its keys aren't set, and every Stripe write answers NOT_CONNECTED. */
  stripe: (StripeApi & StoreBillingStripe) | null
  now: () => Date
}

const money = (amount: number | bigint | string, currency: string) => ({ amount: String(amount), currency })

type Prices = { currency: string; monthly: number | null; yearly: number | null }[]
const priceOf = (prices: Prices, currency: string, interval: Interval): number | null => {
  const p = prices.find((x) => x.currency === currency)
  return (interval === 'year' ? p?.yearly : p?.monthly) ?? null
}
// Plans are ranked by their monthly price; one sold only yearly by a twelfth of it.
const rankOf = (prices: Prices, currency: string, fallback: number): number => {
  const p = prices.find((x) => x.currency === currency)
  return p?.monthly ?? (p?.yearly != null ? Math.round(p.yearly / 12) : fallback)
}

const paidOf = (sub: BillingSubscriptionRow) => sub.status !== 'trial' && sub.stripe_subscription_id !== null

const subscriptionDto = (s: BillingSubscriptionRow) => ({
  plan: { id: s.plan_id, name: s.plan_name },
  status: s.status,
  interval: s.interval,
  price: money(s.amount, s.currency),
  periodStart: s.period_start,
  periodEnd: s.period_end,
  trialEndsAt: s.trial_ends_at,
  cancelAt: s.cancel_at,
  scheduled: s.next_plan_id && s.change_at ? { plan: { id: s.next_plan_id, name: s.next_plan_name ?? '' }, interval: s.next_interval ?? s.interval, at: s.change_at } : null,
  card: s.payment_method_last4 ? { brand: s.payment_method_brand ?? '', last4: s.payment_method_last4, expires: s.payment_method_expires ? s.payment_method_expires.toISOString().slice(0, 7) : null } : null,
  // FIRST-RELEASE §16: the screen says who charges (SAAS §7.1).
  collectedBy: s.billing_mode === 'own' ? ('partner' as const) : ('dripfunnel' as const),
  partnerName: s.partner_name,
  asOf: s.synced_at,
})
export type BillingSubscriptionDto = ReturnType<typeof subscriptionDto>

const usageKeys = ['products', 'staff', 'suppliers', 'ai_prompts', 'publish_now'] as const

export const createStoreBillingService = ({ sql, caller, facts, activity, stripe, now }: StoreBillingDeps) => {
  const storeId = caller.store.id
  const partnerId = caller.context.partnerId
  const system = <T>(work: (tx: ScopedSql) => Promise<T>) => withSystemScope(sql, work)
  const inStore = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, caller.context, work)
  const subscriptionRow = () => system((tx) => selectBillingSubscription(tx, storeId))

  const entry = (action: string, changes: NonNullable<ActivityEntry['changes']>): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: caller.person.id,
    actorLabel: null,
    partnerId,
    storeId,
    sellerId: null,
    target: { type: 'store', id: storeId, label: caller.store.name },
    reason: null,
    changes,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const subscription = async (): Promise<BillingSubscriptionDto | null> => {
    const row = await subscriptionRow()
    return row ? subscriptionDto(row) : null
  }

  // The partner's Live plans priced in the store's billing currency, each with everything it includes (SAAS §6.1).
  const planCatalogue = () =>
    system(async (tx) => {
      const sub = await selectBillingSubscription(tx, storeId)
      if (!sub) return []
      const plans = await selectCataloguePlans(tx, partnerId)
      const versions = await selectCurrentVersions(tx, plans.map((p) => p.id))
      return plans.flatMap((p) => {
        const v = versions.get(p.id)
        const monthly = priceOf(v?.prices ?? [], sub.currency, 'month')
        const yearly = priceOf(v?.prices ?? [], sub.currency, 'year')
        if (monthly === null && yearly === null) return []
        const values = v?.entitlements ?? {}
        return [
          {
            id: p.id,
            name: p.name,
            description: p.description,
            current: p.id === sub.plan_id,
            monthly: monthly === null ? null : money(monthly, sub.currency),
            yearly: yearly === null ? null : money(yearly, sub.currency),
            values: planKeyDefs.flatMap((d) => {
              const value = (values as Record<string, boolean | number | undefined>)[d.key]
              if (value === undefined) return []
              const amount = typeof value === 'number' ? value : null
              return [{ key: d.key, kind: d.kind, enabled: typeof value === 'boolean' ? value : null, amount: amount === UNLIMITED ? null : amount, unlimited: amount === UNLIMITED }]
            }),
          },
        ]
      })
    })

  // This month's meters against the plan and its overrides; Unlimited has no cap and is never near (FIRST-RELEASE §16).
  const usage = () =>
    inStore(async (tx) => {
      const at = now()
      const month = `${at.toISOString().slice(0, 7)}-01`
      const stored = (await selectStoreAccount(tx, storeId)).usage
      const used: Record<(typeof usageKeys)[number], number> = {
        products: await countStoreProducts(tx),
        staff: await countStaffSeats(tx, storeId, null),
        suppliers: await countLiveSuppliers(tx, storeId),
        ...(Object.fromEntries(
          (['ai_prompts', 'publish_now'] as const).map((k) => {
            const u = stored.find((s) => s.key === k)
            return [k, u && u.period_start && u.period_start.toISOString().slice(0, 10) === month ? u.used : 0]
          }),
        ) as Record<'ai_prompts' | 'publish_now', number>),
      }
      const rows = []
      for (const key of usageKeys) {
        const { amount } = await selectStoreEntitlement(tx, storeId, key, at)
        const unlimited = (amount ?? 0) >= UNLIMITED
        rows.push({ key, used: used[key], limit: unlimited ? null : (amount ?? 0), unlimited, monthly: key === 'ai_prompts' || key === 'publish_now' })
      }
      return rows
    })

  const billingDetails = () => inStore((tx) => selectBillingDetails(tx, storeId))

  const invoices = (window: PageWindow) =>
    inStore(async (tx) => {
      const rows = await selectStoreInvoices(tx, storeId, { after: window.after ?? undefined, before: window.before ?? undefined }, window.limit)
      return pageWith(rows, window, (r) => encodeCursor({ occurredAt: r.issued_at, id: r.id }))
    })

  /** Stripe's answer as a refusal the screen words; anything else is a real error. */
  const providerRefusal = (error: unknown, refusal: StoreBillingRefusal): { ok: false; reason: StoreBillingRefusal } => {
    if (error instanceof StripeUnavailable) return refused('PROVIDER_UNAVAILABLE')
    if (error instanceof StripeRefused) return refused(refusal)
    throw error
  }

  /** Runs `work` holding the store's billing claim, so a second tab waits its turn instead of charging again. */
  const claimed = async <T>(work: () => Promise<StoreBillingResult<T>>): Promise<StoreBillingResult<T>> => {
    const at = now()
    const claim = await system((tx) => claimBilling(tx, storeId, at, new Date(at.getTime() + claimMs)))
    if (!claim) return refused('CHANGE_IN_PROGRESS')
    try {
      return await work()
    } finally {
      await system((tx) => releaseBilling(tx, storeId, claim))
    }
  }

  // The store's Stripe customer, committed before anything that makes Stripe send events about it (SAAS §7.2).
  const customerOf = async (api: StoreBillingStripe, sub: BillingSubscriptionRow): Promise<string> => {
    if (sub.stripe_customer_id) return sub.stripe_customer_id
    const details = await billingDetails()
    const created = await api.createStoreCustomer({ storeId, partnerId, name: details?.legal_name ?? caller.store.name, email: details?.email ?? caller.person.email })
    await system((tx) => saveStripeCustomer(tx, storeId, created.id))
    return created.id
  }

  // FIRST-RELEASE §16: the card from Stripe's hosted field, never a number. A past-due store's open invoice is tried
  // again with it at once, which is how the Owner pays while the store is read-only (SAAS §4.2).
  const setPaymentMethod = async (raw: unknown): Promise<StoreBillingResult<BillingSubscriptionDto>> => {
    const token = cardToken.safeParse(raw)
    if (!token.success) return refused('INVALID_INPUT')
    if (!stripe) return refused('NOT_CONNECTED')
    return claimed(async () => {
      const sub = await subscriptionRow()
      if (!sub) return refused('NO_SUBSCRIPTION')
      if (sub.billing_mode === 'own') return refused('BILLED_BY_PARTNER')
      let card
      try {
        const customer = await customerOf(stripe, sub)
        card = await stripe.attachCard(customer, token.data)
      } catch (error) {
        return providerRefusal(error, 'CARD_REFUSED')
      }
      const { brand, last4, exp_month, exp_year } = card.card
      await system(async (tx) => {
        await saveCard(tx, storeId, { brand, last4, expires: new Date(Date.UTC(exp_year, exp_month - 1, 1)) })
        await activity.record(tx, entry(storeBillingAudit.setPaymentMethod, [{ field: 'card_last4', before: sub.payment_method_last4, after: last4 }]))
      })
      if (sub.status === 'past_due' && sub.stripe_subscription_id) {
        try {
          const current = await stripe.subscription(sub.stripe_subscription_id)
          const open = current.latest_invoice ? await stripe.invoice(current.latest_invoice) : null
          // Stripe's answer reaches the store through the webhook, which lifts the read-only state when it's paid.
          if (open?.status === 'open') await stripe.payInvoice(open.id, `pay:${open.id}:${token.data}`)
        } catch (error) {
          if (!(error instanceof StripeRefused || error instanceof StripeUnavailable)) throw error
        }
      }
      const after = await subscriptionRow()
      return after ? { ok: true, value: subscriptionDto(after) } : refused('NO_SUBSCRIPTION')
    })
  }

  /** The current plan and the target, as the quote reads them; a refusal when the change isn't one this store can make. */
  const planned = async (raw: unknown): Promise<StoreBillingResult<{ sub: BillingSubscriptionRow; plan: CataloguePlanRow; current: CurrentPlan; amount: number; rank: number; interval: Interval; when: When }>> => {
    const input = planChange.safeParse(raw)
    if (!input.success) return refused('INVALID_INPUT')
    const { planId, interval, when } = input.data
    return system(async (tx) => {
      const sub = await selectBillingSubscription(tx, storeId)
      if (!sub) return refused('NO_SUBSCRIPTION')
      if (sub.billing_mode === 'own') return refused('BILLED_BY_PARTNER')
      if (sub.status === 'cancelled' || sub.cancel_at) return refused('CANCELLED')
      const plan = await selectLivePlan(tx, partnerId, planId)
      if (!plan) return refused('PLAN_NOT_LIVE')
      const versions = await selectCurrentVersions(tx, [plan.id, sub.plan_id])
      const prices = versions.get(plan.id)?.prices ?? []
      const amount = priceOf(prices, sub.currency, interval)
      if (amount === null) return refused('NOT_PRICED')
      const paid = paidOf(sub)
      if (paid && plan.id === sub.plan_id && interval === sub.interval && !sub.next_plan_id) return refused('SAME_PLAN')
      const currentRank = rankOf(versions.get(sub.plan_id)?.prices ?? [], sub.currency, sub.interval === 'year' ? Math.round(sub.amount / 12) : sub.amount)
      const current: CurrentPlan = { paid, amount: sub.amount, interval: sub.interval, rank: currentRank, periodStart: sub.period_start, periodEnd: sub.period_end }
      const rank = rankOf(prices, sub.currency, amount)
      if (!offeredWays(current, { amount, interval, rank }).includes(when)) return refused('AT_PERIOD_END_ONLY')
      return { ok: true, value: { sub, plan, current, amount, rank, interval, when } }
    })
  }

  // PortalBilling's confirmation: both amounts and the date, before anything is charged (SAAS §7.2).
  const quotePlanChange = async (raw: unknown) => {
    const p = await planned(raw)
    if (!p.ok) return p
    const { sub, current, amount, rank, interval, when } = p.value
    const q = quoteChange(current, { amount, interval, rank }, when, now())
    return { ok: true as const, value: { offered: q.offered, charge: money(q.charge, sub.currency), credit: money(q.credit, sub.currency), today: money(q.today, sub.currency), from: q.from, nextPrice: money(q.nextAmount, sub.currency) } }
  }

  const metadataOf = (plan: CataloguePlanRow, interval: Interval) => ({ store_id: storeId, partner_id: partnerId, plan_id: plan.id, plan_version: String(plan.version), interval })
  const periodOf = (s: StripeSubscription) => {
    const item = s.items.data[0]
    const start = s.current_period_start ?? item?.current_period_start
    const end = s.current_period_end ?? item?.current_period_end
    return start && end ? { periodStart: new Date(start * 1000), periodEnd: new Date(end * 1000) } : null
  }

  const changePlan = async (raw: unknown): Promise<StoreBillingResult<BillingSubscriptionDto>> =>
    claimed(async () => {
      const p = await planned(raw)
      if (!p.ok) return p
      const { sub, plan, amount, interval, when } = p.value
      // The same change from the same recorded state is the same request to Stripe, however often it is retried.
      const key = (kind: string) => `${kind}:${storeId}:${sub.billing_revision}:${plan.id}:${plan.version}:${interval}`
      const move = { planId: plan.id, planVersion: plan.version, interval, amount }
      const changes = [
        { field: 'plan', before: sub.plan_id, after: plan.id },
        { field: 'interval', before: sub.interval, after: interval },
        { field: 'when', before: null, after: when },
      ]
      const at = now()
      let applied: { subscriptionId: string | null; periodStart: Date; periodEnd: Date } | null = null
      let released = false
      // Asking for the plan it has, with a change scheduled, keeps it: the change is cancelled (SAAS §6.3).
      const keeps = paidOf(sub) && plan.id === sub.plan_id && interval === sub.interval
      if (!paidOf(sub) && amount === 0) {
        // A free plan out of the trial needs no card and nothing on Stripe (FIRST-RELEASE §16 "Move to Free").
        applied = { subscriptionId: null, periodStart: at, periodEnd: addInterval(at, interval) }
      } else {
        if (!stripe) return refused('NOT_CONNECTED')
        if (amount > 0 && !sub.payment_method_last4) return refused('NO_CARD')
        try {
          const price = { product: await stripe.ensurePlanProduct({ id: plan.id, name: plan.name }), currency: sub.currency, amount, interval }
          if (!paidOf(sub) || !sub.stripe_subscription_id) {
            const customer = await customerOf(stripe, sub)
            const made = await stripe.createSubscription({ customer, price, metadata: metadataOf(plan, interval) }, key('plan-start'))
            const period = periodOf(made)
            applied = { subscriptionId: made.id, periodStart: period?.periodStart ?? at, periodEnd: period?.periodEnd ?? addInterval(at, interval) }
          } else {
            const current = await stripe.subscription(sub.stripe_subscription_id)
            // A change already scheduled gives way to this one.
            if (current.schedule) {
              await stripe.releaseSchedule(current.schedule)
              released = true
            }
            if (keeps) {
              // Nothing more on Stripe: the release was the change.
            } else if (when === 'now') {
              const changed = await stripe.changeSubscription(current, { price, metadata: metadataOf(plan, interval) }, key('plan-change'))
              const period = periodOf(changed)
              applied = { subscriptionId: changed.id, periodStart: period?.periodStart ?? sub.period_start, periodEnd: period?.periodEnd ?? sub.period_end }
            } else {
              await stripe.scheduleChange(current, { price, metadata: metadataOf(plan, interval) }, key('plan-schedule'))
            }
          }
        } catch (error) {
          await system(async (tx) => {
            if (error instanceof StripeRefused) await bumpBillingRevision(tx, storeId)
            // Stripe has no scheduled change any more, so neither does the store: the change asked for replaced it.
            if (released && sub.next_plan_id) {
              await clearScheduledChange(tx, storeId)
              await activity.record(tx, entry(storeBillingAudit.cancelChange, [{ field: 'plan', before: sub.next_plan_id, after: sub.plan_id }]))
            }
          })
          return providerRefusal(error, 'PAYMENT_FAILED')
        }
      }
      await system(async (tx) => {
        if (applied) {
          await applyPlan(tx, storeId, { ...move, ...applied, activate: !paidOf(sub) })
          // Out of the trial the store is active too (SAAS §4.2: Active is a paid subscription, or a free plan).
          const store = paidOf(sub) ? null : await selectStoreForUpdate(tx, storeId)
          if (store?.status === 'trial') await transitionStore(tx, store, { to: 'active' }, at)
        } else if (keeps) await clearScheduledChange(tx, storeId)
        else await scheduleChange(tx, storeId, { ...move, at: sub.period_end })
        await activity.record(tx, entry(applied ? storeBillingAudit.changePlan : keeps ? storeBillingAudit.cancelChange : storeBillingAudit.scheduleChange, changes))
      })
      const after = await subscriptionRow()
      return after ? { ok: true, value: subscriptionDto(after) } : refused('NO_SUBSCRIPTION')
    })

  // SAAS §7.2: new invoices follow new details; issued ones keep the details they were issued with.
  const saveBillingDetails = async (raw: unknown): Promise<StoreBillingResult<NonNullable<Awaited<ReturnType<typeof billingDetails>>>>> => {
    const input = detailsInput.safeParse(raw)
    if (!input.success) return refused('INVALID_INPUT')
    const { legalName, email, address, taxId } = input.data
    const tax = invoiceTaxIdOf(taxId, address.country)
    if (tax === false) return refused('INVALID_INPUT')
    const sub = await subscriptionRow()
    if (!sub) return refused('NO_SUBSCRIPTION')
    const clean = Object.fromEntries(Object.entries(address).filter((e): e is [string, string] => typeof e[1] === 'string'))
    if (sub.stripe_customer_id) {
      if (!stripe) return refused('NOT_CONNECTED')
      try {
        await stripe.updateCustomer(sub.stripe_customer_id, {
          name: legalName,
          email,
          address: { line1: address.line1, line2: address.line2 ?? '', city: address.city, state: address.region ?? '', postal_code: address.postal, country: address.country },
        })
      } catch (error) {
        return providerRefusal(error, 'INVALID_INPUT')
      }
    }
    return inStore(async (tx) => {
      const before = await selectBillingDetails(tx, storeId)
      await upsertBillingDetails(tx, storeId, { legal_name: legalName, address: clean, email, tax_id: tax?.tax_id ?? null, tax_id_kind: tax?.tax_id_kind ?? null }, now())
      // The fields that changed, never their values (LOGGING §5, as store.info_saved).
      const changed = (['legal_name', 'email', 'address', 'tax_id'] as const).filter((f) => {
        const next = { legal_name: legalName, email, address: clean, tax_id: tax?.tax_id ?? null }[f]
        return JSON.stringify(before?.[f] ?? null) !== JSON.stringify(next)
      })
      await activity.record(tx, entry(storeBillingAudit.saveBillingDetails, changed.map((field) => ({ field, before: null, after: 'changed' }))))
      const saved = await selectBillingDetails(tx, storeId)
      return saved ? { ok: true as const, value: saved } : refused('NOT_FOUND')
    })
  }

  // Stripe's own link to the PDF, read fresh because it expires (as the partner's, saas/billing/partner.ts).
  const downloadInvoice = async (rawId: unknown): Promise<StoreBillingResult<string>> => {
    if (!z.guid().safeParse(rawId).success) return refused('NOT_FOUND')
    const invoice = await inStore((tx) => selectStoreInvoice(tx, storeId, String(rawId)))
    if (!invoice) return refused('NOT_FOUND')
    if (!stripe) return refused('NOT_CONNECTED')
    try {
      const url = (await stripe.invoice(invoice.stripe_invoice_id)).invoice_pdf ?? null
      if (!url || !/^https:\/\/([a-z0-9-]+\.)*stripe\.com\//.test(url)) return refused('NO_PDF')
      return { ok: true, value: url }
    } catch (error) {
      return providerRefusal(error, 'NO_PDF')
    }
  }

  return { subscription, planCatalogue, usage, billingDetails, invoices, quotePlanChange, changePlan, setPaymentMethod, saveBillingDetails, downloadInvoice }
}

export type StoreBillingService = ReturnType<typeof createStoreBillingService>
