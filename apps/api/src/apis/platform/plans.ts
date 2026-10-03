import { GraphQLError } from 'graphql'
import { unauthenticated } from '../graphql/scope'
import { planAudit, type Margin, type Money, type PartnerPlansService, type PlanEditorDto, type PlanPrice, type PlanRowDto, type PlansPage, type Result, type RowEntitlements } from '#saas/partnerPlans/index'
import { builder } from './builder'

// Plans on the Platform API (ui/platform/FIRST-RELEASE.md §7; card #161). Thin: saas/partnerPlans
// decides, and the scope is always the session's partner.

const service = (plans: PartnerPlansService | null): PartnerPlansService => {
  if (!plans) throw unauthenticated()
  return plans
}

const MoneyType = builder.objectRef<Money>('Money').implement({
  fields: (t) => ({ amount: t.exposeInt('amount'), currency: t.exposeString('currency') }),
})

const MarginType = builder.objectRef<Margin>('PlanMargin').implement({
  fields: (t) => ({
    kind: t.exposeString('kind'),
    amount: t.field({ type: MoneyType, nullable: true, resolve: (m) => (m.kind === 'keep' || m.kind === 'loss' ? m.amount : null) }),
    of: t.field({ type: MoneyType, nullable: true, resolve: (m) => (m.kind === 'keep' ? m.of : null) }),
  }),
})

const PriceType = builder.objectRef<PlanPrice>('PlanPrice').implement({
  fields: (t) => ({
    currency: t.exposeString('currency'),
    monthly: t.field({ type: MoneyType, nullable: true, resolve: (p) => p.monthly }),
    yearly: t.field({ type: MoneyType, nullable: true, resolve: (p) => p.yearly }),
    fee: t.field({ type: MoneyType, nullable: true, resolve: (p) => p.fee }),
    converted: t.exposeBoolean('converted'),
    margin: t.field({ type: MarginType, resolve: (p) => p.margin }),
  }),
})

const EntitlementsType = builder.objectRef<RowEntitlements>('PlanEntitlements').implement({
  fields: (t) => ({
    domain: t.exposeBoolean('domain'),
    offers: t.exposeBoolean('offers'),
    suppliersOn: t.exposeBoolean('suppliersOn'),
    powered: t.exposeBoolean('powered'),
    aplus: t.exposeBoolean('aplus'),
    size: t.exposeBoolean('size'),
    products: t.exposeInt('products'),
    staff: t.exposeInt('staff'),
    suppliers: t.exposeInt('suppliers'),
    languages: t.exposeInt('languages'),
    currencies: t.exposeInt('currencies'),
    publish: t.exposeInt('publish'),
    ai: t.exposeInt('ai'),
  }),
})

const PlanRowType = builder.objectRef<PlanRowDto>('PlanRow').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    description: t.exposeString('description'),
    status: t.exposeString('status'),
    trialDays: t.exposeInt('trialDays'),
    prices: t.field({ type: [PriceType], resolve: (p) => p.prices }),
    stores: t.exposeInt('stores'),
  }),
})

// The editor's plan: a row with its values (FIRST-RELEASE §7.2).
const PlanType = builder.objectRef<PlanRowDto & { entitlements: RowEntitlements }>('Plan').implement({
  fields: (t) => ({
    row: t.field({ type: PlanRowType, resolve: (p) => p }),
    entitlements: t.field({ type: EntitlementsType, resolve: (p) => p.entitlements }),
  }),
})

const PermissionType = builder.objectRef<{ allowed: boolean; reason?: string }>('PlanPermission').implement({
  fields: (t) => ({ allowed: t.exposeBoolean('allowed'), reason: t.string({ nullable: true, resolve: (p) => p.reason ?? null }) }),
})

const PageInfoType = builder.objectRef<PlansPage['pageInfo']>('PlansPageInfo').implement({
  fields: (t) => ({ hasNextPage: t.exposeBoolean('hasNextPage'), endCursor: t.exposeString('endCursor', { nullable: true }) }),
})

const PlansPageType = builder.objectRef<PlansPage>('PlansPage').implement({
  fields: (t) => ({
    items: t.field({ type: [PlanRowType], resolve: (p) => p.items }),
    pageInfo: t.field({ type: PageInfoType, resolve: (p) => p.pageInfo }),
    chargedBy: t.exposeString('chargedBy'),
    create: t.field({ type: PermissionType, resolve: (p) => p.actions.create }),
  }),
})

const Ceilings = builder.objectRef<PlanEditorDto['ceilings']>('PlanCeilings').implement({
  fields: (t) => ({
    products: t.exposeInt('products', { nullable: true }),
    staff: t.exposeInt('staff', { nullable: true }),
    suppliers: t.exposeInt('suppliers', { nullable: true }),
    languages: t.exposeInt('languages', { nullable: true }),
    currencies: t.exposeInt('currencies', { nullable: true }),
    publish: t.exposeInt('publish', { nullable: true }),
    ai: t.exposeInt('ai', { nullable: true }),
  }),
})

const Powered = builder.objectRef<PlanEditorDto['powered']>('PoweredByRule').implement({
  fields: (t) => ({ allowed: t.exposeBoolean('allowed'), note: t.exposeString('note', { nullable: true }) }),
})

const Target = builder.objectRef<{ id: string; name: string }>('RetireTarget').implement({ fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }) })

const EditorType = builder.objectRef<PlanEditorDto>('PlanEditor').implement({
  fields: (t) => ({
    plan: t.field({ type: PlanType, nullable: true, resolve: (e) => e.plan }),
    ceilings: t.field({ type: Ceilings, resolve: (e) => e.ceilings }),
    powered: t.field({ type: Powered, resolve: (e) => e.powered }),
    currencies: t.exposeStringList('currencies'),
    trials: t.exposeIntList('trials'),
    chargedBy: t.exposeString('chargedBy'),
    edit: t.field({ type: PermissionType, resolve: (e) => e.permission.edit }),
    price: t.field({ type: PermissionType, resolve: (e) => e.permission.price }),
    retireTargets: t.field({ type: [Target], resolve: (e) => e.retireTargets }),
    retireDates: t.stringList({ resolve: (e) => e.retireDates.map((d) => d.toISOString()) }),
  }),
})

const ResultType = builder.objectRef<Result>('PlanResult').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    id: t.string({ nullable: true, resolve: (r) => (r.ok ? r.id : null) }),
    reason: t.string({ nullable: true, resolve: (r) => (r.ok ? null : r.reason) }),
    row: t.string({ nullable: true, resolve: (r) => (r.ok ? null : (r.row ?? null)) }),
    currency: t.string({ nullable: true, resolve: (r) => (r.ok ? null : (r.currency ?? null)) }),
  }),
})

const MoneyInput = builder.inputType('MoneyInput', { fields: (t) => ({ amount: t.int({ required: true }), currency: t.string({ required: true }) }) })
const PriceInput = builder.inputType('PlanPriceInput', {
  fields: (t) => ({ currency: t.string({ required: true }), monthly: t.field({ type: MoneyInput }), yearly: t.field({ type: MoneyInput }) }),
})
const EntitlementsInput = builder.inputType('PlanEntitlementsInput', {
  fields: (t) => ({
    domain: t.boolean({ required: true }),
    offers: t.boolean({ required: true }),
    suppliersOn: t.boolean({ required: true }),
    powered: t.boolean({ required: true }),
    aplus: t.boolean({ required: true }),
    size: t.boolean({ required: true }),
    products: t.int({ required: true }),
    staff: t.int({ required: true }),
    suppliers: t.int({ required: true }),
    languages: t.int({ required: true }),
    currencies: t.int({ required: true }),
    publish: t.int({ required: true }),
    ai: t.int({ required: true }),
  }),
})
const PlanInputType = builder.inputType('PlanInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    description: t.string({ required: true }),
    trialDays: t.int({ required: true }),
    prices: t.field({ type: [PriceInput], required: true }),
    entitlements: t.field({ type: EntitlementsInput, required: true }),
  }),
})
const RetireInputType = builder.inputType('RetirePlanInput', {
  fields: (t) => ({ keep: t.boolean({ required: true }), moveTo: t.id(), on: t.string() }),
})

const read = { api: 'platform', scope: 'partner', permission: 'partner.read', target: 'none' } as const
const write = (audit: string, permission: 'plans.write' | 'plans.price' = 'plans.write') => ({ api: 'platform', scope: 'partner', permission, target: 'none', audit }) as const
// GraphQL gives absent optional fields as null; the service's zod schemas expect them absent.
const strip = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined))

builder.queryFields((t) => ({
  plans: t.field({
    type: PlansPageType,
    args: { after: t.arg.string(), first: t.arg.int() },
    extensions: { access: read },
    resolve: async (_, { after, first }, ctx) => {
      const page = await service(ctx.plans).plans(after ?? null, first ?? 25)
      if (!page) throw new GraphQLError('That page link does not work.', { extensions: { code: 'INVALID_INPUT' } })
      return page
    },
  }),
  planEditor: t.field({
    type: EditorType,
    nullable: true,
    args: { id: t.arg.id() },
    extensions: { access: read },
    resolve: (_, { id }, ctx) => service(ctx.plans).planEditor(id === null || id === undefined ? null : String(id)),
  }),
  quotePlanPrices: t.field({
    type: [PriceType],
    args: { id: t.arg.id(), prices: t.arg({ type: [PriceInput], required: true }) },
    extensions: { access: read },
    resolve: (_, { id, prices }, ctx) =>
      service(ctx.plans).quotePlanPrices(
        id === null || id === undefined ? null : String(id),
        prices.map((p) => ({ currency: p.currency, monthly: p.monthly ?? null, yearly: p.yearly ?? null })),
      ),
  }),
}))

builder.mutationFields((t) => ({
  createPlan: t.field({
    type: ResultType,
    args: { input: t.arg({ type: PlanInputType, required: true }) },
    extensions: { access: write(planAudit.createPlan) },
    resolve: (_, { input }, ctx) => service(ctx.plans).createPlan({ ...input, prices: input.prices.map((p) => ({ currency: p.currency, monthly: p.monthly ?? null, yearly: p.yearly ?? null })) }),
  }),
  // Finance holds plans.price only; the service lets it change prices and nothing else.
  updatePlan: t.field({
    type: ResultType,
    args: { id: t.arg.id({ required: true }), input: t.arg({ type: PlanInputType, required: true }), applyTo: t.arg.string() },
    extensions: { access: write(planAudit.updatePlan, 'plans.price') },
    resolve: (_, { id, input, applyTo }, ctx) =>
      service(ctx.plans).updatePlan(
        String(id),
        { ...input, prices: input.prices.map((p) => ({ currency: p.currency, monthly: p.monthly ?? null, yearly: p.yearly ?? null })) },
        applyTo === 'new' || applyTo === 'renewal' ? applyTo : null,
      ),
  }),
  makePlanLive: t.field({
    type: ResultType,
    args: { id: t.arg.id({ required: true }) },
    extensions: { access: write(planAudit.makePlanLive) },
    resolve: (_, { id }, ctx) => service(ctx.plans).makePlanLive(String(id)),
  }),
  retirePlan: t.field({
    type: ResultType,
    args: { id: t.arg.id({ required: true }), input: t.arg({ type: RetireInputType, required: true }) },
    extensions: { access: write(planAudit.retirePlan) },
    resolve: (_, { id, input }, ctx) => service(ctx.plans).retirePlan(String(id), strip(input)),
  }),
}))
