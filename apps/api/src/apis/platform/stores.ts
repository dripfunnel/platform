import { GraphQLError } from 'graphql'
import { storeAudit, storesExportAudit, type ActionPermission, type PartnerStoresService, type StoreDetailDto, type StorePageDto, type StoreRowDto, type StoreState } from '#saas/partnerStores/index'
import { builder } from './builder'
import { MoneyType } from './money'
import { CreatePermissionType } from './storeCreate'
import { exportResultType, partnerRead, present, signedIn } from './fields'

// Stores on the Platform API (ui/platform/FIRST-RELEASE.md §6; card #159). Thin: saas/partnerStores
// decides; account level only, so no type here reaches an order, a customer or a product.

const iso = (d: Date | null) => (d ? d.toISOString() : null)

const State = builder.objectRef<StoreState>('StoreState').implement({
  fields: (t) => ({
    kind: t.exposeString('kind'),
    trialEndsAt: t.string({ nullable: true, resolve: (s) => (s.kind === 'trial' ? iso(s.trialEndsAt) : null) }),
    daysLeft: t.int({ nullable: true, resolve: (s) => (s.kind === 'trial' ? s.daysLeft : null) }),
    daysPastDue: t.int({ nullable: true, resolve: (s) => (s.kind === 'pastdue' ? s.daysPastDue : null) }),
    reason: t.string({ nullable: true, resolve: (s) => (s.kind === 'suspended' ? s.reason : null) }),
    since: t.string({ nullable: true, resolve: (s) => (s.kind === 'cancelled' ? iso(s.since) : null) }),
  }),
})

const Permission = builder.objectRef<ActionPermission>('StoreActionPermission').implement({
  fields: (t) => ({ allowed: t.exposeBoolean('allowed'), reason: t.string({ nullable: true, resolve: (p) => (p.allowed ? null : p.reason) }) }),
})

const Named = builder.objectRef<{ id: string; name: string }>('StorePlanRef').implement({ fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }) })
const Owner = builder.objectRef<StoreRowDto['owner']>('StoreOwner').implement({
  fields: (t) => ({ name: t.exposeString('name', { nullable: true }), email: t.exposeString('email', { nullable: true }) }),
})
const Near = builder.objectRef<NonNullable<StoreRowDto['near']>>('StoreNearLimit').implement({ fields: (t) => ({ percent: t.exposeInt('percent'), limit: t.exposeString('limit') }) })
const Domain = builder.objectRef<NonNullable<StoreRowDto['domain']>>('StoreDomain').implement({
  fields: (t) => ({ host: t.exposeString('host'), custom: t.exposeBoolean('custom'), status: t.exposeString('status') }),
})

const StoreRowType = builder.objectRef<StoreRowDto>('PartnerStoreRow').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    code: t.exposeString('code'),
    owner: t.field({ type: Owner, resolve: (r) => r.owner }),
    plan: t.field({ type: Named, nullable: true, resolve: (r) => r.plan }),
    near: t.field({ type: Near, nullable: true, resolve: (r) => r.near }),
    state: t.field({ type: State, resolve: (r) => r.state }),
    storefront: t.exposeString('storefront'),
    domain: t.field({ type: Domain, nullable: true, resolve: (r) => r.domain }),
    createdAt: t.string({ resolve: (r) => r.createdAt.toISOString() }),
    billingStatus: t.exposeString('billingStatus', { nullable: true }),
  }),
})

const PageInfo = builder.objectRef<StorePageDto['pageInfo']>('StorePageInfo').implement({
  fields: (t) => ({
    hasNextPage: t.exposeBoolean('hasNextPage'),
    hasPreviousPage: t.exposeBoolean('hasPreviousPage'),
    startCursor: t.exposeString('startCursor', { nullable: true }),
    endCursor: t.exposeString('endCursor', { nullable: true }),
  }),
})

const StorePage = builder.objectRef<StorePageDto>('StorePage').implement({
  fields: (t) => ({
    items: t.field({ type: [StoreRowType], resolve: (p) => p.items }),
    pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }),
    plans: t.field({ type: [Named], resolve: (p) => p.plans }),
    billingMode: t.exposeString('billingMode'),
    createPermission: t.field({ type: CreatePermissionType, resolve: (p) => p.actions.create }),
    exportPermission: t.field({ type: Permission, resolve: (p) => p.actions.export }),
    billingStatusPermission: t.field({ type: Permission, nullable: true, resolve: (p) => p.actions.billingStatus }),
  }),
})

type Detail = StoreDetailDto
const People = builder.objectRef<Detail['people']>('StorePeopleCount').implement({ fields: (t) => ({ count: t.exposeInt('count'), suppliers: t.exposeInt('suppliers') }) })
const Contact = builder.objectRef<Detail['contacts'][number]>('StoreContact').implement({
  fields: (t) => ({ name: t.exposeString('name'), email: t.exposeString('email'), role: t.exposeString('role') }),
})
const Usage = builder.objectRef<Detail['usage'][number]>('StoreUsage').implement({
  fields: (t) => ({ limit: t.exposeString('limit'), used: t.exposeInt('used'), cap: t.exposeInt('cap', { nullable: true }), percent: t.exposeInt('percent', { nullable: true }), monthly: t.exposeBoolean('monthly') }),
})
const Override = builder.objectRef<Detail['overrides'][number]>('StoreOverride').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    limit: t.exposeString('limit'),
    amount: t.exposeInt('amount'),
    duration: t.exposeString('duration'),
    reason: t.exposeString('reason'),
    by: t.exposeString('by'),
    at: t.string({ resolve: (o) => o.at.toISOString() }),
  }),
})
const Billing = builder.objectRef<Detail['billing']>('StoreBilling').implement({
  fields: (t) => ({
    interval: t.exposeString('interval', { nullable: true }),
    nextChargeAt: t.string({ nullable: true, resolve: (b) => iso(b.nextChargeAt) }),
    cardLast4: t.exposeString('cardLast4', { nullable: true }),
    mode: t.exposeString('mode'),
    partnerName: t.exposeString('partnerName'),
  }),
})
const Site = builder.objectRef<Detail['site']>('StoreSite').implement({
  fields: (t) => ({ liveHost: t.exposeString('liveHost', { nullable: true }), previewHost: t.exposeString('previewHost', { nullable: true }), lastPublishAt: t.string({ nullable: true, resolve: (s) => iso(s.lastPublishAt) }) }),
})
const Record = builder.objectRef<Detail['records'][number]>('StoreDnsRecord').implement({
  fields: (t) => ({
    host: t.exposeString('host'),
    status: t.exposeString('status'),
    type: t.exposeString('type'),
    value: t.exposeString('value'),
    found: t.exposeString('found', { nullable: true }),
    since: t.string({ resolve: (r) => r.since.toISOString() }),
  }),
})
const Setup = builder.objectRef<Detail['setup']>('StoreSetup').implement({
  fields: (t) => ({ steps: t.exposeStringList('steps'), step: t.exposeString('step', { nullable: true }), state: t.exposeString('state'), error: t.exposeString('error', { nullable: true }) }),
})
const Extension = builder.objectRef<Detail['trialExtensions'][number]>('StoreTrialExtension').implement({
  fields: (t) => ({ days: t.exposeInt('days'), endsAt: t.string({ resolve: (e) => e.endsAt.toISOString() }) }),
})
const Person = builder.objectRef<Detail['support']['people'][number]>('StorePerson').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    email: t.exposeString('email'),
    role: t.exposeString('role'),
    supplier: t.exposeString('supplier', { nullable: true }),
    status: t.exposeString('status'),
    lastSignInAt: t.string({ nullable: true, resolve: (p) => iso(p.lastSignInAt) }),
  }),
})
const Support = builder.objectRef<Detail['support']>('StoreSupport').implement({
  fields: (t) => ({ allowed: t.exposeBoolean('allowed'), people: t.field({ type: [Person], resolve: (s) => s.people }) }),
})
const Entry = builder.objectRef<Detail['activity'][number]>('StoreActivityEntry').implement({
  fields: (t) => ({ id: t.exposeID('id'), at: t.string({ resolve: (e) => e.at.toISOString() }), who: t.exposeString('who', { nullable: true }), action: t.exposeString('action'), result: t.exposeString('result') }),
})
const Actions = builder.objectRef<Detail['actions']>('StoreActions').implement({
  fields: (t) => ({
    changePlan: t.field({ type: Permission, nullable: true, resolve: (a) => a.changePlan ?? null }),
    extendTrial: t.field({ type: Permission, nullable: true, resolve: (a) => a.extendTrial ?? null }),
    addOverride: t.field({ type: Permission, nullable: true, resolve: (a) => a.addOverride ?? null }),
    resendInvite: t.field({ type: Permission, nullable: true, resolve: (a) => a.resendInvite ?? null }),
    restore: t.field({ type: Permission, nullable: true, resolve: (a) => a.restore ?? null }),
    suspend: t.field({ type: Permission, nullable: true, resolve: (a) => a.suspend ?? null }),
    retryStep: t.field({ type: Permission, nullable: true, resolve: (a) => a.retryStep ?? null }),
  }),
})

const More = builder.objectRef<Detail['more']>('StoreDetailMore').implement({
  fields: (t) => ({ overrides: t.exposeBoolean('overrides'), trialExtensions: t.exposeBoolean('trialExtensions'), people: t.exposeBoolean('people'), activity: t.exposeBoolean('activity') }),
})

const StoreDetailType = builder.objectRef<Detail>('PartnerStore').implement({
  fields: (t) => ({
    row: t.field({ type: StoreRowType, resolve: (s) => s }),
    country: t.exposeString('country', { nullable: true }),
    price: t.field({ type: MoneyType, nullable: true, resolve: (s) => s.price }),
    people: t.field({ type: People, resolve: (s) => s.people }),
    contacts: t.field({ type: [Contact], resolve: (s) => s.contacts }),
    usage: t.field({ type: [Usage], resolve: (s) => s.usage }),
    overrides: t.field({ type: [Override], resolve: (s) => s.overrides }),
    billing: t.field({ type: Billing, resolve: (s) => s.billing }),
    site: t.field({ type: Site, resolve: (s) => s.site }),
    records: t.field({ type: [Record], resolve: (s) => s.records }),
    setup: t.field({ type: Setup, resolve: (s) => s.setup }),
    trialExtensions: t.field({ type: [Extension], resolve: (s) => s.trialExtensions }),
    support: t.field({ type: Support, resolve: (s) => s.support }),
    activity: t.field({ type: [Entry], resolve: (s) => s.activity }),
    more: t.field({ type: More, resolve: (s) => s.more }),
    actions: t.field({ type: Actions, resolve: (s) => s.actions }),
  }),
})

const FilterInput = builder.inputType('StoreFilterInput', {
  fields: (t) => ({ status: t.string(), plan: t.id(), created: t.string(), storefront: t.string(), near: t.string(), q: t.string() }),
})

type ExportJob = NonNullable<Awaited<ReturnType<PartnerStoresService['storesExport']>>>
const ExportJobType = builder.objectRef<ExportJob>('StoresExportJob').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    state: t.exposeString('state'),
    rows: t.exposeInt('rows', { nullable: true }),
    truncated: t.exposeBoolean('truncated'),
    csv: t.exposeString('csv', { nullable: true }),
    expiresAt: t.string({ nullable: true, resolve: (j) => j.expiresAt?.toISOString() ?? null }),
  }),
})

const BillingResult = builder.objectRef<{ ok: boolean; reason?: string }>('StoreBillingStatusResult').implement({
  fields: (t) => ({ ok: t.exposeBoolean('ok'), reason: t.string({ nullable: true, resolve: (r) => r.reason ?? null }) }),
})

const invalid = () => new GraphQLError('That filter or page link does not work.', { extensions: { code: 'INVALID_INPUT' } })
// GraphQL gives an absent optional field as null; the filter schema expects it absent.

builder.queryFields((t) => ({
  stores: t.field({
    type: StorePage,
    args: { filter: t.arg({ type: FilterInput }), after: t.arg.string(), before: t.arg.string(), first: t.arg.int() },
    extensions: { access: partnerRead },
    resolve: async (_, { filter, after, before, first }, ctx) => {
      const page = await signedIn(ctx.stores).stores(present(filter), { after: after ?? undefined, before: before ?? undefined, first: first ?? undefined })
      if (!page) throw invalid()
      return page
    },
  }),
  store: t.field({ type: StoreDetailType, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: { access: partnerRead }, resolve: (_, { id }, ctx) => signedIn(ctx.stores).store(String(id)) }),
  storesExport: t.field({ type: ExportJobType, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: { access: exportsAccess }, resolve: (_, { id }, ctx) => signedIn(ctx.stores).storesExport(String(id)) }),
}))

const exportsAccess = { api: 'platform', scope: 'partner', permission: 'exports', target: 'none' } as const

builder.mutationFields((t) => ({
  exportStores: t.field({
    type: exportResultType('StoresExportResult'),
    args: { filter: t.arg({ type: FilterInput }) },
    extensions: { access: { ...exportsAccess, audit: storesExportAudit } },
    resolve: async (_, { filter }, ctx) => {
      const result = await signedIn(ctx.stores).exportStores(present(filter))
      if (!result.ok) throw invalid()
      return result
    },
  }),
  setStoreBillingStatus: t.field({
    type: BillingResult,
    args: { id: t.arg.id({ required: true }), status: t.arg.string({ required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'stores.billingStatus', target: 'none', audit: storeAudit.setStoreBillingStatus } },
    resolve: (_, { id, status }, ctx) => signedIn(ctx.stores).setStoreBillingStatus(String(id), status),
  }),
}))
