import { GraphQLError } from 'graphql'
import type { Page } from '#core/paging'
import type { BillingDetailsRow, StoreInvoiceRow } from '#db/scoped/storeBilling'
import { createStoreBillingService, storeBillingAudit, type BillingSubscriptionDto, type StoreBillingRefusal, type StoreBillingResult } from '#saas/storeBilling/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { moneyType, pageInfoType, type StoreBuilder } from './builder'
import { storePage } from './refusals'

// Billing (FIRST-RELEASE §16, PortalBilling; SAAS §7): the Owner's (`billing`). Paying (the card) works while the
// store is read-only, since that is how a past-due store pays (SAAS §4.2); every other change waits as all writes do.

const words: Record<StoreBillingRefusal, string> = {
  INVALID_INPUT: 'Something here isn’t valid.',
  NOT_FOUND: 'That is no longer here.',
  NOT_CONNECTED: 'Billing isn’t set up yet. Try again later.',
  PROVIDER_UNAVAILABLE: 'We couldn’t reach our payment provider. Nothing was charged; try again in a minute.',
  CARD_REFUSED: 'That card was refused. Try another card.',
  PAYMENT_FAILED: 'The payment didn’t go through, so your plan stays as it is. Check your card and try again.',
  BILLED_BY_PARTNER: 'Your provider bills you directly. Ask them to change your plan.',
  NO_SUBSCRIPTION: 'Your store has no plan yet.',
  SAME_PLAN: 'You’re already on this plan.',
  PLAN_NOT_LIVE: 'That plan isn’t offered any more.',
  NOT_PRICED: 'That plan has no price in your currency for that period.',
  AT_PERIOD_END_ONLY: 'A smaller plan or a shorter period starts when this period ends.',
  NO_CARD: 'Add the card that pays for your plan first.',
  CHANGE_IN_PROGRESS: 'Another change to your plan is going through. Try again in a minute.',
  CANCELLED: 'Your store is closing, so its plan can’t change.',
  NO_PDF: 'That invoice’s PDF isn’t available.',
}

const answered = <T>(result: StoreBillingResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
}

export const registerBilling = (builder: StoreBuilder) => {
  const Money = moneyType(builder)
  const PageInfo = pageInfoType(builder)

  const service = (ctx: StoreContext, write = false) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    // The plan and its card are the Owner's own act: never a support session's or an impersonation's (ACCESS §5.1, §8).
    if (write && caller.context.caller.kind !== 'person') throw forbidden()
    return createStoreBillingService({ sql: ctx.sql, caller, facts: ctx.facts, activity: ctx.activity, stripe: ctx.billing ?? null, now: ctx.now })
  }

  const Interval = builder.enumType('BillingInterval', { values: { MONTH: { value: 'month' }, YEAR: { value: 'year' } } as const })
  const When = builder.enumType('PlanChangeWhen', { values: { NOW: { value: 'now' }, PERIOD_END: { value: 'period_end' } } as const })
  const Named = builder.objectRef<{ id: string; name: string }>('BillingPlanName').implement({ fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }) })
  const Scheduled = builder.objectRef<NonNullable<BillingSubscriptionDto['scheduled']>>('ScheduledPlanChange').implement({
    fields: (t) => ({ plan: t.field({ type: Named, resolve: (s) => s.plan }), interval: t.field({ type: Interval, resolve: (s) => s.interval }), at: t.string({ resolve: (s) => s.at.toISOString() }) }),
  })
  const Card = builder.objectRef<NonNullable<BillingSubscriptionDto['card']>>('BillingCard').implement({
    // Stripe's brand and last 4 only (SAAS §7.2); `expires` is YYYY-MM.
    fields: (t) => ({ brand: t.exposeString('brand'), last4: t.exposeString('last4'), expires: t.exposeString('expires', { nullable: true }) }),
  })
  const Subscription = builder.objectRef<BillingSubscriptionDto>('BillingSubscription').implement({
    fields: (t) => ({
      plan: t.field({ type: Named, resolve: (s) => s.plan }),
      // trial, active, past_due or cancelled
      status: t.exposeString('status'),
      interval: t.field({ type: Interval, resolve: (s) => s.interval }),
      price: t.field({ type: Money, resolve: (s) => s.price }),
      periodStart: t.string({ resolve: (s) => s.periodStart.toISOString() }),
      periodEnd: t.string({ resolve: (s) => s.periodEnd.toISOString() }),
      trialEndsAt: t.string({ nullable: true, resolve: (s) => s.trialEndsAt?.toISOString() ?? null }),
      cancelAt: t.string({ nullable: true, resolve: (s) => s.cancelAt?.toISOString() ?? null }),
      scheduled: t.field({ type: Scheduled, nullable: true, resolve: (s) => s.scheduled }),
      card: t.field({ type: Card, nullable: true, resolve: (s) => s.card }),
      // dripfunnel (on the partner's behalf) or partner: who charges, which the screen says (SAAS §7.1).
      collectedBy: t.exposeString('collectedBy'),
      partnerName: t.exposeString('partnerName'),
      // When Stripe last told us anything: the status may be minutes behind it (SAAS §7.2).
      asOf: t.string({ nullable: true, resolve: (s) => s.asOf?.toISOString() ?? null }),
    }),
  })

  type PlanDto = Awaited<ReturnType<ReturnType<typeof createStoreBillingService>['planCatalogue']>>[number]
  const PlanValue = builder.objectRef<PlanDto['values'][number]>('BillingPlanValue').implement({
    fields: (t) => ({
      key: t.exposeString('key'),
      // switch, amount or choice (SAAS §6.1)
      kind: t.exposeString('kind'),
      enabled: t.exposeBoolean('enabled', { nullable: true }),
      // Null for a switch, or when unlimited; a choice is its index.
      amount: t.exposeInt('amount', { nullable: true }),
      unlimited: t.exposeBoolean('unlimited'),
    }),
  })
  const Plan = builder.objectRef<PlanDto>('BillingPlan').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      description: t.exposeString('description', { nullable: true }),
      current: t.exposeBoolean('current'),
      monthly: t.field({ type: Money, nullable: true, resolve: (p) => p.monthly }),
      yearly: t.field({ type: Money, nullable: true, resolve: (p) => p.yearly }),
      values: t.field({ type: [PlanValue], resolve: (p) => p.values }),
    }),
  })

  type UsageDto = Awaited<ReturnType<ReturnType<typeof createStoreBillingService>['usage']>>[number]
  const Usage = builder.objectRef<UsageDto>('BillingUsage').implement({
    fields: (t) => ({
      // products, staff, suppliers, ai_prompts or publish_now
      key: t.exposeString('key'),
      used: t.exposeInt('used'),
      // Null when unlimited, which is never near a limit (FIRST-RELEASE §16).
      limit: t.exposeInt('limit', { nullable: true }),
      unlimited: t.exposeBoolean('unlimited'),
      // Counted this month, from the 1st (UTC).
      monthly: t.exposeBoolean('monthly'),
    }),
  })

  type QuoteDto = Extract<Awaited<ReturnType<ReturnType<typeof createStoreBillingService>['quotePlanChange']>>, { ok: true }>['value']
  const Quote = builder.objectRef<QuoteDto>('PlanChangeQuote').implement({
    fields: (t) => ({
      offered: t.field({ type: [When], resolve: (q) => [...q.offered] }),
      // The new plan for the days left, the unused part of the old, and what is charged today.
      charge: t.field({ type: Money, resolve: (q) => q.charge }),
      credit: t.field({ type: Money, resolve: (q) => q.credit }),
      today: t.field({ type: Money, resolve: (q) => q.today }),
      from: t.string({ resolve: (q) => q.from.toISOString() }),
      nextPrice: t.field({ type: Money, resolve: (q) => q.nextPrice }),
    }),
  })

  const Address = builder.objectRef<Record<string, string>>('BillingAddress').implement({
    fields: (t) => ({
      line1: t.string({ resolve: (a) => a['line1'] ?? '' }),
      line2: t.string({ nullable: true, resolve: (a) => a['line2'] ?? null }),
      city: t.string({ resolve: (a) => a['city'] ?? '' }),
      region: t.string({ nullable: true, resolve: (a) => a['region'] ?? null }),
      postal: t.string({ resolve: (a) => a['postal'] ?? '' }),
      country: t.string({ resolve: (a) => a['country'] ?? '' }),
    }),
  })
  const Details = builder.objectRef<BillingDetailsRow>('BillingDetails').implement({
    fields: (t) => ({
      legalName: t.exposeString('legal_name'),
      email: t.exposeString('email'),
      address: t.field({ type: Address, resolve: (d) => d.address }),
      taxId: t.exposeString('tax_id', { nullable: true }),
      // gstin or vat
      taxIdKind: t.exposeString('tax_id_kind', { nullable: true }),
    }),
  })
  const AddressInput = builder.inputType('BillingAddressInput', {
    fields: (t) => ({ line1: t.string({ required: true }), line2: t.string(), city: t.string({ required: true }), region: t.string(), postal: t.string({ required: true }), country: t.string({ required: true }) }),
  })
  const DetailsInput = builder.inputType('BillingDetailsInput', {
    fields: (t) => ({ legalName: t.string({ required: true }), email: t.string({ required: true }), address: t.field({ type: AddressInput, required: true }), taxId: t.string() }),
  })

  const Line = builder.objectRef<StoreInvoiceRow['lines'][number]>('InvoiceLine').implement({
    fields: (t) => ({
      label: t.exposeString('label'),
      // Minor units; a credit is below zero.
      amount: t.exposeString('amount'),
      // plan, proration_charge or proration_credit
      kind: t.exposeString('kind'),
      periodStart: t.exposeString('period_start', { nullable: true }),
      periodEnd: t.exposeString('period_end', { nullable: true }),
    }),
  })
  const Invoice = builder.objectRef<StoreInvoiceRow>('StoreInvoice').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      number: t.exposeString('number', { nullable: true }),
      // subscription or proration
      kind: t.exposeString('kind'),
      // paid, open, void or refunded
      status: t.exposeString('status'),
      amount: t.field({ type: Money, resolve: (i) => ({ amount: i.amount, currency: i.currency }) }),
      tax: t.field({ type: Money, resolve: (i) => ({ amount: i.tax_amount, currency: i.currency }) }),
      issuedAt: t.string({ resolve: (i) => i.issued_at.toISOString() }),
      paidAt: t.string({ nullable: true, resolve: (i) => i.paid_at?.toISOString() ?? null }),
      lines: t.field({ type: [Line], resolve: (i) => i.lines }),
    }),
  })
  const InvoicePage = builder.objectRef<Page<StoreInvoiceRow>>('StoreInvoicePage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Invoice], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })

  const read = { api: 'store', scope: 'store', permission: 'billing', target: 'none' } as const

  builder.queryFields((t) => ({
    subscription: t.field({ type: Subscription, nullable: true, extensions: { access: read }, resolve: (_, __, ctx) => service(ctx).subscription() }),
    planCatalogue: t.field({ type: [Plan], extensions: { access: read }, resolve: (_, __, ctx) => service(ctx).planCatalogue() }),
    usage: t.field({ type: [Usage], extensions: { access: read }, resolve: (_, __, ctx) => service(ctx).usage() }),
    billingDetails: t.field({ type: Details, nullable: true, extensions: { access: read }, resolve: (_, __, ctx) => service(ctx).billingDetails() }),
    invoices: t.field({
      type: InvoicePage,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: read },
      resolve: (_, args, ctx) => service(ctx).invoices(storePage(args)),
    }),
    // A short-lived link to Stripe's PDF, read fresh: a read, as the partner's is (platform.graphql).
    downloadInvoice: t.string({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: read },
      resolve: async (_, { id }, ctx) => answered(await service(ctx).downloadInvoice(String(id))),
    }),
    planChangeQuote: t.field({
      type: Quote,
      args: { planId: t.arg.id({ required: true }), interval: t.arg({ type: Interval, required: true }), when: t.arg({ type: When, required: true }) },
      extensions: { access: read },
      resolve: async (_, args, ctx) => answered(await service(ctx).quotePlanChange({ planId: String(args.planId), interval: args.interval, when: args.when })),
    }),
  }))

  builder.mutationFields((t) => ({
    changePlan: t.field({
      type: Subscription,
      args: { planId: t.arg.id({ required: true }), interval: t.arg({ type: Interval, required: true }), when: t.arg({ type: When, required: true }) },
      extensions: { access: { ...read, audit: storeBillingAudit.changePlan } },
      resolve: async (_, args, ctx) => answered(await service(ctx, true).changePlan({ planId: String(args.planId), interval: args.interval, when: args.when })),
    }),
    // The token from Stripe's hosted card field (`pm_…`); a card number is refused before anything reads it.
    setPaymentMethod: t.field({
      type: Subscription,
      args: { token: t.arg.string({ required: true }) },
      extensions: { access: { ...read, whileReadOnly: true, audit: storeBillingAudit.setPaymentMethod } },
      resolve: async (_, { token }, ctx) => answered(await service(ctx, true).setPaymentMethod(token)),
    }),
    saveBillingDetails: t.field({
      type: Details,
      args: { input: t.arg({ type: DetailsInput, required: true }) },
      extensions: { access: { ...read, audit: storeBillingAudit.saveBillingDetails } },
      resolve: async (_, { input }, ctx) => answered(await service(ctx, true).saveBillingDetails(input)),
    }),
  }))
}
