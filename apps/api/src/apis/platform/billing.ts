import { GraphQLError } from 'graphql'
import { billingAudit, type PartnerBillingService } from '#saas/billing/index'
import { builder } from './builder'
import { signedIn } from './fields'
import { MoneyType } from './money'

// Billing on the Platform API (ui/platform/FIRST-RELEASE.md §11, §14.3; card #201). Thin:
// saas/billing decides. Every field is the caller's own partner's; the payout account and card
// arrive only as Stripe tokens and stay with the partner, never a staff session (ACCESS §8.1–8.2).

type Payments = NonNullable<Awaited<ReturnType<PartnerBillingService['merchantPayments']>>>
type Payouts = NonNullable<Awaited<ReturnType<PartnerBillingService['payouts']>>>
type Invoices = NonNullable<Awaited<ReturnType<PartnerBillingService['partnerInvoices']>>>
type Next = Awaited<ReturnType<PartnerBillingService['nextPayout']>>
type Settings = Awaited<ReturnType<PartnerBillingService['billingSettings']>>

const iso = (d: Date | null) => d?.toISOString() ?? null

const PageInfoType = builder.objectRef<Payments['pageInfo']>('BillingPageInfo').implement({
  fields: (t) => ({
    hasNextPage: t.exposeBoolean('hasNextPage'),
    hasPreviousPage: t.exposeBoolean('hasPreviousPage'),
    startCursor: t.exposeString('startCursor', { nullable: true }),
    endCursor: t.exposeString('endCursor', { nullable: true }),
  }),
})

const Payment = builder.objectRef<Payments['items'][number]>('MerchantPayment').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    at: t.string({ resolve: (p) => p.at.toISOString() }),
    storeId: t.exposeID('storeId'),
    storeName: t.exposeString('storeName'),
    kind: t.exposeString('kind'),
    amount: t.field({ type: MoneyType, resolve: (p) => p.amount }),
    status: t.exposeString('status'),
    // Stripe's own sentence about a failure, as the fact the console shows.
    note: t.exposeString('note', { nullable: true }),
    cardLast4: t.exposeString('cardLast4', { nullable: true }),
  }),
})

const Retrying = builder.objectRef<Payments['failed'][number]>('RetryingPayment').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    storeId: t.exposeID('storeId'),
    storeName: t.exposeString('storeName'),
    amount: t.field({ type: MoneyType, resolve: (p) => p.amount }),
    why: t.exposeString('why', { nullable: true }),
    cardLast4: t.exposeString('cardLast4', { nullable: true }),
    retryAt: t.string({ nullable: true, resolve: (p) => iso(p.retryAt) }),
    attempt: t.exposeInt('attempt'),
    attempts: t.exposeInt('attempts'),
  }),
})

const PaymentsPage = builder.objectRef<Payments>('MerchantPaymentsPage').implement({
  fields: (t) => ({
    failed: t.field({ type: [Retrying], resolve: (p) => p.failed }),
    failedMore: t.exposeBoolean('failedMore'),
    items: t.field({ type: [Payment], resolve: (p) => p.items }),
    pageInfo: t.field({ type: PageInfoType, resolve: (p) => p.pageInfo }),
  }),
})

const Adjustment = builder.objectRef<NonNullable<Payouts['items'][number]['adjustment']>>('PayoutAdjustment').implement({
  fields: (t) => ({ amount: t.field({ type: MoneyType, resolve: (a) => a.amount }), note: t.exposeString('note', { nullable: true }) }),
})

const Payout = builder.objectRef<Payouts['items'][number]>('PartnerPayout').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    month: t.exposeString('month'),
    collected: t.field({ type: MoneyType, resolve: (p) => p.collected }),
    fee: t.field({ type: MoneyType, resolve: (p) => p.fee }),
    adjustment: t.field({ type: Adjustment, nullable: true, resolve: (p) => p.adjustment }),
    payout: t.field({ type: MoneyType, resolve: (p) => p.payout }),
    paidOn: t.string({ nullable: true, resolve: (p) => iso(p.paidOn) }),
    status: t.exposeString('status'),
    toLast4: t.exposeString('toLast4', { nullable: true }),
  }),
})

const PayoutsPage = builder.objectRef<Payouts>('PartnerPayoutsPage').implement({
  fields: (t) => ({ items: t.field({ type: [Payout], resolve: (p) => p.items }), pageInfo: t.field({ type: PageInfoType, resolve: (p) => p.pageInfo }) }),
})

const NextPayoutType = builder.objectRef<Next>('NextPayout').implement({
  fields: (t) => ({
    state: t.exposeString('state'),
    date: t.string({ nullable: true, resolve: (n) => (n.state === 'scheduled' ? n.date : null) }),
    soFar: t.field({ type: MoneyType, nullable: true, resolve: (n) => (n.state === 'scheduled' ? n.soFar : null) }),
    toLast4: t.string({ nullable: true, resolve: (n) => (n.state === 'scheduled' ? n.toLast4 : null) }),
  }),
})

const Invoice = builder.objectRef<Invoices['items'][number]>('PartnerInvoice').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    number: t.exposeString('number', { nullable: true }),
    at: t.string({ resolve: (i) => i.at.toISOString() }),
    what: t.exposeString('what'),
    amount: t.field({ type: MoneyType, resolve: (i) => i.amount }),
    status: t.exposeString('status'),
  }),
})

const InvoicesPage = builder.objectRef<Invoices>('PartnerInvoicesPage').implement({
  fields: (t) => ({ items: t.field({ type: [Invoice], resolve: (p) => p.items }), pageInfo: t.field({ type: PageInfoType, resolve: (p) => p.pageInfo }) }),
})

const PayoutAccountType = builder.objectRef<Settings['payoutAccount']>('PayoutAccount').implement({
  fields: (t) => ({
    bank: t.exposeString('bank', { nullable: true }),
    // Only the last four digits ever leave the API (§14.3).
    last4: t.exposeString('last4', { nullable: true }),
    status: t.exposeString('status'),
    failure: t.exposeString('failure', { nullable: true }),
  }),
})

const PaymentMethodType = builder.objectRef<Awaited<ReturnType<PartnerBillingService['paymentMethod']>>>('PaymentMethod').implement({
  fields: (t) => ({
    brand: t.exposeString('brand', { nullable: true }),
    last4: t.exposeString('last4', { nullable: true }),
    expires: t.exposeString('expires', { nullable: true }),
    status: t.exposeString('status'),
  }),
})

const SettingsType = builder.objectRef<Settings>('BillingSettings').implement({
  fields: (t) => ({
    mode: t.exposeString('mode'),
    payoutAccount: t.field({ type: PayoutAccountType, resolve: (s) => s.payoutAccount }),
    asOf: t.string({ nullable: true, resolve: (s) => iso(s.asOf) }),
    staleSince: t.string({ nullable: true, resolve: (s) => iso(s.staleSince) }),
  }),
})

const Result = builder.objectRef<{ ok: boolean; reason?: string }>('BillingResult').implement({
  fields: (t) => ({ ok: t.exposeBoolean('ok'), reason: t.string({ nullable: true, resolve: (r) => r.reason ?? null }) }),
})

const InvoiceLink = builder.objectRef<{ ok: boolean; reason?: string; url?: string }>('InvoiceLink').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    reason: t.string({ nullable: true, resolve: (r) => r.reason ?? null }),
    url: t.string({ nullable: true, resolve: (r) => r.url ?? null }),
  }),
})

const billingRead = { api: 'platform', scope: 'partner', permission: 'billing.read', target: 'none' } as const
const pageArgs = (t: Parameters<Parameters<typeof builder.queryFields>[0]>[0]) => ({ after: t.arg.string(), before: t.arg.string(), first: t.arg.int() })

const page = <T>(found: T | null): T => {
  if (!found) throw new GraphQLError('That page link does not work.', { extensions: { code: 'INVALID_INPUT' } })
  return found
}

builder.queryFields((t) => ({
  merchantPayments: t.field({ type: PaymentsPage, args: pageArgs(t), extensions: { access: billingRead }, resolve: async (_, args, ctx) => page(await signedIn(ctx.billing).merchantPayments(args)) }),
  payouts: t.field({ type: PayoutsPage, args: pageArgs(t), extensions: { access: billingRead }, resolve: async (_, args, ctx) => page(await signedIn(ctx.billing).payouts(args)) }),
  nextPayout: t.field({ type: NextPayoutType, extensions: { access: billingRead }, resolve: (_, __, ctx) => signedIn(ctx.billing).nextPayout() }),
  partnerInvoices: t.field({ type: InvoicesPage, args: pageArgs(t), extensions: { access: billingRead }, resolve: async (_, args, ctx) => page(await signedIn(ctx.billing).partnerInvoices(args)) }),
  billingSettings: t.field({ type: SettingsType, extensions: { access: billingRead }, resolve: (_, __, ctx) => signedIn(ctx.billing).billingSettings() }),
  payoutAccount: t.field({ type: PayoutAccountType, extensions: { access: billingRead }, resolve: (_, __, ctx) => signedIn(ctx.billing).payoutAccount() }),
  paymentMethod: t.field({ type: PaymentMethodType, extensions: { access: billingRead }, resolve: (_, __, ctx) => signedIn(ctx.billing).paymentMethod() }),
  // A fresh link to Stripe's PDF; reading it changes nothing, so it is a query.
  downloadInvoice: t.field({ type: InvoiceLink, args: { id: t.arg.id({ required: true }) }, extensions: { access: billingRead }, resolve: (_, { id }, ctx) => signedIn(ctx.billing).downloadInvoice(String(id)) }),
}))

// ACCESS §8.1, §8.2: payment and payout details stay with the partner, never a staff session.
const moneyDetails = (permission: 'payout.write' | 'card.write', audit: string) => ({
  access: { api: 'platform' as const, scope: 'partner' as const, permission, target: 'none' as const, audit, blockedFor: ['impersonation' as const, 'setup' as const] },
})

builder.mutationFields((t) => ({
  setBillingMode: t.field({
    type: Result,
    args: { mode: t.arg.string({ required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'billing.write', target: 'none', audit: billingAudit.setBillingMode } },
    resolve: (_, { mode }, ctx) => signedIn(ctx.billing).setBillingMode(mode),
  }),
  setPayoutAccount: t.field({ type: Result, args: { token: t.arg.string({ required: true }) }, extensions: moneyDetails('payout.write', billingAudit.setPayoutAccount), resolve: (_, { token }, ctx) => signedIn(ctx.billing).setPayoutAccount(token) }),
  setPaymentMethod: t.field({ type: Result, args: { token: t.arg.string({ required: true }) }, extensions: moneyDetails('card.write', billingAudit.setPaymentMethod), resolve: (_, { token }, ctx) => signedIn(ctx.billing).setPaymentMethod(token) }),
}))
