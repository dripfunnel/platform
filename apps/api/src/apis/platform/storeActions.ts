import { storeActionAudit, type PartnerStoreActions, type StoreActionResult } from '#saas/partnerStores/index'
import type { Proration } from '#saas/partnerStores/index'
import { unauthenticated } from '../graphql/scope'
import { builder } from './builder'

// The store actions of FIRST-RELEASE §6.4 (card #160). Thin: saas/partnerStores/actions decides. A
// role without the permission is FORBIDDEN here; the block in `store(id)` names its code.

const service = (actions: PartnerStoreActions | null): PartnerStoreActions => {
  if (!actions) throw unauthenticated()
  return actions
}

type Result = StoreActionResult<{ trialEndsAt?: Date; overrideId?: string; proration?: Proration; currency?: string }>
type Option = { id: string; name: string; version: number; price: { amount: number; currency: string }; proration: Proration }

const ProrationType = builder.objectRef<{ proration: Proration; currency: string }>('StoreProration').implement({
  fields: (t) => ({
    kind: t.string({ resolve: (p) => p.proration.kind }),
    amount: t.int({ nullable: true, resolve: (p) => (p.proration.kind === 'none' ? null : p.proration.amount) }),
    currency: t.exposeString('currency'),
  }),
})

const ResultType = builder.objectRef<Result>('StoreActionResult').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    reason: t.string({ nullable: true, resolve: (r) => (r.ok ? null : r.reason) }),
    trialEndsAt: t.string({ nullable: true, resolve: (r) => (r.ok && r.trialEndsAt ? r.trialEndsAt.toISOString() : null) }),
    overrideId: t.string({ nullable: true, resolve: (r) => (r.ok ? (r.overrideId ?? null) : null) }),
    proration: t.field({ type: ProrationType, nullable: true, resolve: (r) => (r.ok && r.proration && r.currency ? { proration: r.proration, currency: r.currency } : null) }),
  }),
})

const OptionType = builder.objectRef<Option>('ChangePlanOption').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    amount: t.int({ resolve: (o) => o.price.amount }),
    currency: t.string({ resolve: (o) => o.price.currency }),
    proration: t.field({ type: ProrationType, resolve: (o) => ({ proration: o.proration, currency: o.price.currency }) }),
  }),
})

type Options = StoreActionResult<{ plans: Option[]; nextBillingAt: Date | null }>
const OptionsType = builder.objectRef<Options>('ChangePlanOptions').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    reason: t.string({ nullable: true, resolve: (r) => (r.ok ? null : r.reason) }),
    plans: t.field({ type: [OptionType], resolve: (r) => (r.ok ? r.plans : []) }),
    nextBillingAt: t.string({ nullable: true, resolve: (r) => (r.ok && r.nextBillingAt ? r.nextBillingAt.toISOString() : null) }),
  }),
})

builder.queryFields((t) => ({
  changePlanOptions: t.field({
    type: OptionsType,
    args: { storeId: t.arg.id({ required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'stores.plan', target: 'none' } },
    resolve: (_, { storeId }, ctx) => service(ctx.storeActions).changePlanOptions(String(storeId)),
  }),
}))

builder.mutationFields((t) => ({
  changeStorePlan: t.field({
    type: ResultType,
    args: { id: t.arg.id({ required: true }), planId: t.arg.id({ required: true }), when: t.arg.string({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'stores.plan', target: 'none', audit: storeActionAudit.changeStorePlan } },
    resolve: (_, { id, planId, when, reason }, ctx) => service(ctx.storeActions).changeStorePlan(String(id), { planId: String(planId), when, reason }),
  }),
  extendTrial: t.field({
    type: ResultType,
    args: { id: t.arg.id({ required: true }), days: t.arg.int({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'stores.trial', target: 'none', audit: storeActionAudit.extendTrial } },
    resolve: (_, { id, days, reason }, ctx) => service(ctx.storeActions).extendTrial(String(id), { days, reason }),
  }),
  addLimitOverride: t.field({
    type: ResultType,
    args: {
      id: t.arg.id({ required: true }),
      limit: t.arg.string({ required: true }),
      amount: t.arg.int({ required: true }),
      duration: t.arg.string({ required: true }),
      reason: t.arg.string({ required: true }),
    },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'stores.plan', target: 'none', audit: storeActionAudit.addLimitOverride } },
    resolve: (_, { id, ...input }, ctx) => service(ctx.storeActions).addLimitOverride(String(id), input),
  }),
  removeLimitOverride: t.field({
    type: ResultType,
    args: { id: t.arg.id({ required: true }), overrideId: t.arg.id({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'stores.plan', target: 'none', audit: storeActionAudit.removeLimitOverride } },
    resolve: (_, { id, overrideId, reason }, ctx) => service(ctx.storeActions).removeLimitOverride(String(id), { overrideId: String(overrideId), reason }),
  }),
  suspendStore: t.field({
    type: ResultType,
    args: { id: t.arg.id({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'stores.suspend', target: 'none', audit: storeActionAudit.suspendStore } },
    resolve: (_, { id, reason }, ctx) => service(ctx.storeActions).suspendStore(String(id), reason),
  }),
  restoreStore: t.field({
    type: ResultType,
    args: { id: t.arg.id({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'stores.suspend', target: 'none', audit: storeActionAudit.restoreStore } },
    resolve: (_, { id, reason }, ctx) => service(ctx.storeActions).restoreStore(String(id), reason),
  }),
  resendStoreOwnerInvite: t.field({
    type: ResultType,
    args: { id: t.arg.id({ required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'stores.invite.resend', target: 'none', audit: storeActionAudit.resendStoreOwnerInvite } },
    resolve: (_, { id }, ctx) => service(ctx.storeActions).resendStoreOwnerInvite(String(id)),
  }),
  retryProvisioningStep: t.field({
    type: ResultType,
    args: { id: t.arg.id({ required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'setup.retry', target: 'none', audit: storeActionAudit.retryProvisioningStep } },
    resolve: (_, { id }, ctx) => service(ctx.storeActions).retryProvisioningStep(String(id)),
  }),
}))
