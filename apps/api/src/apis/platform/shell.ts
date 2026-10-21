import { submitAudit, type NavBadges, type Onboarding, type OnboardingItem, type PartnerStateFacts, type StaffSessionNotice, type StoreSearchRow, type SubmitResult } from '#saas/partnerConsole/index'
import { builder } from './builder'
import { signedIn } from './fields'

// The shell and Home until Live on the Platform API (ui/platform/FIRST-RELEASE.md §2, §4; card
// #158). Thin: saas/partnerConsole decides, and the scope is always the session's partner.

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)
const partnerRead = { api: 'platform', scope: 'partner', permission: 'partner.read', target: 'none' } as const

const SetupSession = builder.objectRef<NonNullable<PartnerStateFacts['setupSession']>>('SetupSessionNotice').implement({
  fields: (t) => ({ staffName: t.exposeString('staffName'), endsAt: t.string({ resolve: (s) => s.endsAt.toISOString() }) }),
})

const StaffSessionNoticeType = builder.objectRef<StaffSessionNotice>('StaffSessionNotice').implement({
  fields: (t) => ({
    kind: t.exposeString('kind'),
    staffName: t.exposeString('staffName'),
    actingAs: t.exposeString('actingAs', { nullable: true }),
    endsAt: t.string({ resolve: (s) => s.endsAt.toISOString() }),
  }),
})

const PartnerStateType = builder.objectRef<PartnerStateFacts>('PartnerState').implement({
  fields: (t) => ({
    state: t.exposeString('state'),
    sentBackReason: t.exposeString('sentBackReason', { nullable: true }),
    pausedAt: t.string({ nullable: true, resolve: (s) => iso(s.pausedAt) }),
    pauseReason: t.exposeString('pauseReason', { nullable: true }),
    storeCount: t.exposeInt('storeCount'),
    brokenHosts: t.exposeStringList('brokenHosts'),
    setupSession: t.field({ type: SetupSession, nullable: true, resolve: (s) => s.setupSession }),
    billingMode: t.exposeString('billingMode'),
  }),
})

const NavBadgesType = builder.objectRef<NavBadges>('NavBadges').implement({
  fields: (t) => ({
    storesAttention: t.exposeInt('storesAttention'),
    brandingSetupLeft: t.exposeInt('brandingSetupLeft'),
    domainsWaiting: t.exposeInt('domainsWaiting'),
    billingFailedPayments: t.exposeInt('billingFailedPayments'),
    supportOpenSessions: t.exposeInt('supportOpenSessions'),
  }),
})

const StoreMatch = builder.objectRef<StoreSearchRow>('StoreSearchMatch').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    code: t.exposeString('code'),
    status: t.exposeString('status'),
    domain: t.exposeString('domain', { nullable: true }),
    ownerEmail: t.exposeString('owner_email', { nullable: true }),
  }),
})

const Item = builder.objectRef<OnboardingItem>('OnboardingItem').implement({
  fields: (t) => ({
    key: t.exposeString('key'),
    status: t.exposeString('status'),
    detail: t.exposeString('detail', { nullable: true }),
    doneBy: t.exposeString('doneBy', { nullable: true }),
    to: t.exposeString('to'),
  }),
})

const Checks = builder.objectRef<Onboarding['checks']>('GoLiveChecks').implement({
  fields: (t) => ({
    portalHost: t.exposeBoolean('portalHost'),
    emailDomain: t.exposeBoolean('emailDomain'),
    pricedPlan: t.exposeBoolean('pricedPlan'),
    legalPages: t.exposeBoolean('legalPages'),
  }),
})

const Fix = builder.objectRef<Onboarding['fixes'][number]>('OnboardingFix').implement({
  fields: (t) => ({ item: t.exposeString('item'), to: t.exposeString('to') }),
})

const Permission = builder.objectRef<Onboarding['canSubmit']>('ActionPermission').implement({
  fields: (t) => ({ allowed: t.exposeBoolean('allowed'), reason: t.string({ nullable: true, resolve: (p) => (p.allowed ? null : p.reason) }) }),
})

const OnboardingType = builder.objectRef<Onboarding>('Onboarding').implement({
  fields: (t) => ({
    items: t.field({ type: [Item], resolve: (o) => o.items }),
    checks: t.field({ type: Checks, resolve: (o) => o.checks }),
    fallbackSenderAccepted: t.exposeBoolean('fallbackSenderAccepted'),
    submittedAt: t.string({ nullable: true, resolve: (o) => iso(o.submittedAt) }),
    submittedBy: t.exposeString('submittedBy', { nullable: true }),
    sentBackReason: t.exposeString('sentBackReason', { nullable: true }),
    fixes: t.field({ type: [Fix], resolve: (o) => o.fixes }),
    canSubmit: t.field({ type: Permission, resolve: (o) => o.canSubmit }),
  }),
})

const SubmitResultType = builder.objectRef<SubmitResult>('SubmitForApprovalResult').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    code: t.string({ nullable: true, resolve: (r) => (r.ok ? null : r.code) }),
    check: t.string({ nullable: true, resolve: (r) => (!r.ok && r.code === 'GO_LIVE_CHECK_FAILED' ? r.check : null) }),
    submittedAt: t.string({ nullable: true, resolve: (r) => (r.ok ? r.submittedAt.toISOString() : null) }),
  }),
})

builder.queryFields((t) => ({
  partnerState: t.field({ type: PartnerStateType, extensions: { access: partnerRead }, resolve: (_, __, ctx) => signedIn(ctx.console).partnerState() }),
  // Every signed-in user of the partner sees it, read every 15 seconds and on focus (ACCESS.md §8.3).
  staffSessionNotice: t.field({
    type: StaffSessionNoticeType,
    nullable: true,
    extensions: { access: { api: 'platform', scope: 'session', permission: null } },
    resolve: (_, __, ctx) => signedIn(ctx.console).staffSessionNotice(),
  }),
  navBadges: t.field({ type: NavBadgesType, extensions: { access: partnerRead }, resolve: (_, __, ctx) => signedIn(ctx.console).navBadges() }),
  search: t.field({
    type: [StoreMatch],
    args: { query: t.arg.string({ required: true }) },
    extensions: { access: partnerRead },
    resolve: (_, { query }, ctx) => signedIn(ctx.console).search(query),
  }),
  onboarding: t.field({ type: OnboardingType, nullable: true, extensions: { access: partnerRead }, resolve: (_, __, ctx) => signedIn(ctx.console).onboarding() }),
}))

builder.mutationType({})

builder.mutationFields((t) => ({
  submitForApproval: t.field({
    type: SubmitResultType,
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'onboarding.submit', target: 'none', audit: submitAudit } },
    resolve: (_, __, ctx) => signedIn(ctx.console).submitForApproval(),
  }),
}))
