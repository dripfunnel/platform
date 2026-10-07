import { GraphQLError } from 'graphql'
import { planKeyDefs, type Entitlements } from '#db/scoped/planKeys'
import { planAudit, type Margin, type PlanEditorDto, type PlanPrice, type PlanRowDto, type PlansPage, type Result, type RowEntitlements } from '#saas/partnerPlans/index'
import { builder } from './builder'
import { MoneyType } from './money'
import { partnerRead, signedIn } from './fields'

// Plans on the Platform API (ui/platform/FIRST-RELEASE.md §7; card #161). Thin: saas/partnerPlans
// decides, and the scope is always the session's partner.


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

// One entry per catalogue key (db/scoped/planKeys.ts): a switch's `enabled`, otherwise its `amount`.
interface EntitlementEntry {
  key: string
  enabled: boolean | null
  amount: number | null
}
const entriesOf = (e: Entitlements): EntitlementEntry[] =>
  planKeyDefs.map((d) => (d.kind === 'switch' ? { key: d.key, enabled: e[d.key], amount: null } : { key: d.key, enabled: null, amount: e[d.key] }))
const EntitlementType = builder.objectRef<EntitlementEntry>('PlanEntitlement').implement({
  fields: (t) => ({
    key: t.exposeString('key'),
    enabled: t.exposeBoolean('enabled', { nullable: true }),
    amount: t.exposeInt('amount', { nullable: true }),
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
    entitlements: t.field({ type: [EntitlementType], resolve: (p) => entriesOf(p.entitlements) }),
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

const CeilingType = builder.objectRef<{ key: string; amount: number | null }>('PlanCeiling').implement({
  fields: (t) => ({ key: t.exposeString('key'), amount: t.exposeInt('amount', { nullable: true }) }),
})
const Powered = builder.objectRef<PlanEditorDto['powered']>('PoweredByRule').implement({
  fields: (t) => ({ allowed: t.exposeBoolean('allowed'), note: t.exposeString('note', { nullable: true }) }),
})

const Target = builder.objectRef<{ id: string; name: string }>('RetireTarget').implement({ fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }) })

const EditorType = builder.objectRef<PlanEditorDto>('PlanEditor').implement({
  fields: (t) => ({
    plan: t.field({ type: PlanType, nullable: true, resolve: (e) => e.plan }),
    ceilings: t.field({ type: [CeilingType], resolve: (e) => Object.entries(e.ceilings).map(([key, amount]) => ({ key, amount: amount ?? null })) }),
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
const EntitlementInput = builder.inputType('PlanEntitlementInput', {
  fields: (t) => ({ key: t.string({ required: true }), enabled: t.boolean(), amount: t.int() }),
})
const PlanInputType = builder.inputType('PlanInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    description: t.string({ required: true }),
    trialDays: t.int({ required: true }),
    prices: t.field({ type: [PriceInput], required: true }),
    entitlements: t.field({ type: [EntitlementInput], required: true }),
  }),
})
const RetireInputType = builder.inputType('RetirePlanInput', {
  fields: (t) => ({ keep: t.boolean({ required: true }), moveTo: t.id(), on: t.string() }),
})

const write = (audit: string, permission: 'plans.write' | 'plans.price' = 'plans.write') => ({ api: 'platform', scope: 'partner', permission, target: 'none', audit }) as const
// GraphQL gives absent optional fields as null; the service's zod schemas expect them absent.
const strip = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined))

builder.queryFields((t) => ({
  plans: t.field({
    type: PlansPageType,
    args: { after: t.arg.string(), first: t.arg.int() },
    extensions: { access: partnerRead },
    resolve: async (_, { after, first }, ctx) => {
      const page = await signedIn(ctx.plans).plans(after ?? null, first ?? 25)
      if (!page) throw new GraphQLError('That page link does not work.', { extensions: { code: 'INVALID_INPUT' } })
      return page
    },
  }),
  planEditor: t.field({
    type: EditorType,
    nullable: true,
    args: { id: t.arg.id() },
    extensions: { access: partnerRead },
    resolve: (_, { id }, ctx) => signedIn(ctx.plans).planEditor(id === null || id === undefined ? null : String(id)),
  }),
  quotePlanPrices: t.field({
    type: [PriceType],
    args: { id: t.arg.id(), prices: t.arg({ type: [PriceInput], required: true }) },
    extensions: { access: partnerRead },
    resolve: async (_, { id, prices }, ctx) => {
      const quote = await signedIn(ctx.plans).quotePlanPrices(
        id === null || id === undefined ? null : String(id),
        prices.map((p) => ({ currency: p.currency, monthly: p.monthly ?? null, yearly: p.yearly ?? null })),
      )
      if (!quote) throw new GraphQLError('Those prices cannot be quoted.', { extensions: { code: 'INVALID_INPUT' } })
      return quote
    },
  }),
}))

// The input's list becomes the record the service validates (zod refuses an unknown or missing key).
const inputOf = <I extends { prices: { currency: string; monthly?: { amount: number; currency: string } | null | undefined; yearly?: { amount: number; currency: string } | null | undefined }[]; entitlements: { key: string; enabled?: boolean | null | undefined; amount?: number | null | undefined }[] }>(input: I) => ({
  ...input,
  prices: input.prices.map((p) => ({ currency: p.currency, monthly: p.monthly ?? null, yearly: p.yearly ?? null })),
  entitlements: Object.fromEntries(input.entitlements.map((e) => [e.key, e.enabled ?? e.amount])) as unknown as Entitlements,
})

builder.mutationFields((t) => ({
  createPlan: t.field({
    type: ResultType,
    args: { input: t.arg({ type: PlanInputType, required: true }) },
    extensions: { access: write(planAudit.createPlan) },
    resolve: (_, { input }, ctx) => signedIn(ctx.plans).createPlan(inputOf(input)),
  }),
  // Finance holds plans.price only; the service lets it change prices and nothing else.
  updatePlan: t.field({
    type: ResultType,
    args: { id: t.arg.id({ required: true }), input: t.arg({ type: PlanInputType, required: true }), applyTo: t.arg.string() },
    extensions: { access: write(planAudit.updatePlan, 'plans.price') },
    resolve: (_, { id, input, applyTo }, ctx) =>
      signedIn(ctx.plans).updatePlan(
        String(id),
        inputOf(input),
        applyTo === 'new' || applyTo === 'renewal' ? applyTo : null,
      ),
  }),
  makePlanLive: t.field({
    type: ResultType,
    args: { id: t.arg.id({ required: true }) },
    extensions: { access: write(planAudit.makePlanLive) },
    resolve: (_, { id }, ctx) => signedIn(ctx.plans).makePlanLive(String(id)),
  }),
  retirePlan: t.field({
    type: ResultType,
    args: { id: t.arg.id({ required: true }), input: t.arg({ type: RetireInputType, required: true }) },
    extensions: { access: write(planAudit.retirePlan) },
    resolve: (_, { id, input }, ctx) => signedIn(ctx.plans).retirePlan(String(id), strip(input)),
  }),
}))
