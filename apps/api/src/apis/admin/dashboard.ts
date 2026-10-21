import { GraphQLError } from 'graphql'
import type { AttentionReason, DashboardDto, NavBadgesDto, SearchDto } from '#saas/dashboard/index'
import { builder } from './builder'
import { signedIn } from './types'

// The Dashboard, the menu badges and the header search (ui/admin/FIRST-RELEASE.md §2, §3,
// §12; card #35). Read-only; every number arrives finished from saas/dashboard.

const Option = builder.objectRef<{ id: string; name: string }>('PartnerOption').implement({
  fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }),
})

const PartnersCard = builder.objectRef<DashboardDto['partners']>('DashboardPartners').implement({
  fields: (t) => ({ live: t.exposeInt('live'), awaiting: t.exposeInt('awaiting'), draft: t.exposeInt('draft'), paused: t.exposeInt('paused') }),
})

const Oldest = builder.objectRef<NonNullable<DashboardDto['awaiting']['oldest']>>('DashboardOldestAwaiting').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    submittedAt: t.string({ resolve: (o) => o.submittedAt.toISOString() }),
    waitingSeconds: t.exposeInt('waitingSeconds'),
  }),
})

const AwaitingCard = builder.objectRef<DashboardDto['awaiting']>('DashboardAwaiting').implement({
  fields: (t) => ({ count: t.exposeInt('count'), oldest: t.field({ type: Oldest, nullable: true, resolve: (a) => a.oldest }) }),
})

const NewByPartner = builder.objectRef<DashboardDto['stores']['newThisWeekByPartner'][number]>('DashboardNewStoresByPartner').implement({
  fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name'), count: t.exposeInt('count') }),
})

const StoresCard = builder.objectRef<DashboardDto['stores']>('DashboardStores').implement({
  fields: (t) => ({
    total: t.exposeInt('total'),
    newThisWeek: t.exposeInt('newThisWeek'),
    newThisWeekByPartner: t.field({ type: [NewByPartner], resolve: (s) => s.newThisWeekByPartner }),
  }),
})

// One object with the facts of every reason rather than a union: the client switches on `kind`.
const Reason = builder.objectRef<AttentionReason>('AttentionReason').implement({
  fields: (t) => ({
    kind: t.exposeString('kind'),
    daysPastDue: t.int({ nullable: true, resolve: (r) => (r.kind === 'pastDue' ? r.daysPastDue : null) }),
    reason: t.string({ nullable: true, resolve: (r) => (r.kind === 'suspended' ? r.reason : null) }),
    state: t.string({ nullable: true, resolve: (r) => (r.kind === 'setup' ? r.state : null) }),
    step: t.string({ nullable: true, resolve: (r) => (r.kind === 'setup' ? r.step : null) }),
    attempt: t.int({ nullable: true, resolve: (r) => (r.kind === 'setup' ? r.attempt : null) }),
  }),
})

const AttentionStore = builder.objectRef<DashboardDto['attention']['stores'][number]>('AttentionStore').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    partnerName: t.exposeString('partnerName'),
    reason: t.field({ type: Reason, resolve: (s) => s.reason }),
  }),
})

const AttentionCard = builder.objectRef<DashboardDto['attention']>('DashboardAttention').implement({
  fields: (t) => ({
    pastDue: t.exposeInt('pastDue'),
    suspended: t.exposeInt('suspended'),
    setupFailed: t.exposeInt('setupFailed'),
    setupStuck: t.exposeInt('setupStuck'),
    total: t.exposeInt('total'),
    stores: t.field({ type: [AttentionStore], resolve: (a) => a.stores }),
  }),
})

const SignupsCard = builder.objectRef<DashboardDto['signups']>('DashboardSignups').implement({
  fields: (t) => ({
    started: t.exposeInt('started'),
    completed: t.exposeInt('completed'),
    failed: t.exposeInt('failed'),
    medianSecondsToReady: t.exposeInt('medianSecondsToReady', { nullable: true }),
  }),
})

const Dashboard = builder.objectRef<DashboardDto>('Dashboard').implement({
  fields: (t) => ({
    partnerId: t.exposeID('partnerId', { nullable: true }),
    partnerOptions: t.field({ type: [Option], resolve: (d) => d.partnerOptions }),
    asOf: t.string({ resolve: (d) => d.asOf.toISOString() }),
    partners: t.field({ type: PartnersCard, resolve: (d) => d.partners }),
    awaiting: t.field({ type: AwaitingCard, resolve: (d) => d.awaiting }),
    stores: t.field({ type: StoresCard, resolve: (d) => d.stores }),
    attention: t.field({ type: AttentionCard, resolve: (d) => d.attention }),
    signups: t.field({ type: SignupsCard, resolve: (d) => d.signups }),
  }),
})

const NavBadges = builder.objectRef<NavBadgesDto>('NavBadges').implement({
  fields: (t) => ({
    partnersAwaitingApproval: t.exposeInt('partnersAwaitingApproval'),
    provisioningAttention: t.exposeInt('provisioningAttention'),
    openSessions: t.exposeInt('openSessions', { nullable: true }),
  }),
})

const PartnerMatch = builder.objectRef<SearchDto['partners'][number]>('PartnerMatch').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    state: t.exposeString('state'),
    host: t.exposeString('host', { nullable: true }),
    ownerEmail: t.exposeString('ownerEmail', { nullable: true }),
  }),
})

const StoreMatch = builder.objectRef<SearchDto['stores'][number]>('StoreMatch').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    code: t.exposeString('code'),
    status: t.exposeString('status'),
    partnerName: t.exposeString('partnerName'),
    ownerEmail: t.exposeString('ownerEmail', { nullable: true }),
    host: t.exposeString('host', { nullable: true }),
  }),
})

const SearchResult = builder.objectRef<SearchDto>('SearchResult').implement({
  fields: (t) => ({
    partners: t.field({ type: [PartnerMatch], resolve: (s) => s.partners }),
    stores: t.field({ type: [StoreMatch], resolve: (s) => s.stores }),
  }),
})

builder.queryFields((t) => ({
  dashboard: t.field({
    type: Dashboard,
    args: { partnerId: t.arg.id() },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'partners.read', target: 'none' } },
    resolve: (_, args, ctx) => signedIn(ctx.dashboard).dashboard(args.partnerId ? String(args.partnerId) : null),
  }),
  navBadges: t.field({
    type: NavBadges,
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'partners.read', target: 'none' } },
    resolve: (_, __, ctx) => signedIn(ctx.dashboard).navBadges(),
  }),
  search: t.field({
    type: SearchResult,
    args: { query: t.arg.string({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'partners.read', target: 'none' } },
    resolve: async (_, args, ctx) => {
      const result = await signedIn(ctx.dashboard).search(args.query)
      if (!result) throw new GraphQLError('Bad request.', { extensions: { code: 'INVALID_INPUT' } })
      return result
    },
  }),
}))
