import { GraphQLError } from 'graphql'
import { partnerAudit, type PartnerDto, type PartnerManager, type PartnerPage, type PartnerPermissions, type PartnerRowDto, type Result, type SetupSessionDto } from '#saas/partners/index'
import { builder } from './builder'
import { compact, HistoryEntryType, iso, PageInfoType, permission, PermissionType, signedIn, type Permission } from './types'

// Partners on the Admin API (ui/admin/FIRST-RELEASE.md §4, §12; card #33). Thin: every
// decision, including who may do what, is saas/partners' and arrives here as data.

const PortalHost = builder.objectRef<PartnerRowDto['portalHost']>('PartnerPortalHost').implement({
  fields: (t) => ({ host: t.exposeString('host', { nullable: true }), status: t.exposeString('status', { nullable: true }) }),
})

const Setup = builder.objectRef<PartnerRowDto['setup']>('PartnerSetupProgress').implement({
  fields: (t) => ({ done: t.exposeInt('done'), total: t.exposeInt('total') }),
})

const Owner = builder.objectRef<PartnerRowDto['owner']>('PartnerOwner').implement({
  fields: (t) => ({
    name: t.exposeString('name', { nullable: true }),
    email: t.exposeString('email', { nullable: true }),
    invitation: t.exposeString('invitation', { nullable: true }),
    invitationSentAt: t.string({ nullable: true, resolve: (o) => iso(o.invitationSentAt) }),
  }),
})

const Checks = builder.objectRef<PartnerRowDto['checks']>('GoLiveChecks').implement({
  fields: (t) => ({
    portalHost: t.exposeBoolean('portalHost'),
    emailDomain: t.exposeBoolean('emailDomain'),
    pricedPlan: t.exposeBoolean('pricedPlan'),
    legalPages: t.exposeBoolean('legalPages'),
    testSignup: t.exposeBoolean('testSignup'),
  }),
})

const Approval = builder.objectRef<NonNullable<PartnerRowDto['approval']>>('PartnerApproval').implement({
  fields: (t) => ({
    setUpBy: t.exposeString('setUpBy', { nullable: true }),
    rule: t.exposeString('rule'),
    approvals: t.exposeInt('approvals'),
  }),
})

const PartnerRowType = builder.objectRef<PartnerRowDto>('PartnerRow').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    house: t.exposeBoolean('house'),
    kind: t.exposeString('kind', { nullable: true }),
    region: t.exposeString('region', { nullable: true }),
    state: t.exposeString('state'),
    stores: t.exposeInt('stores'),
    portalHost: t.field({ type: PortalHost, resolve: (p) => p.portalHost }),
    setup: t.field({ type: Setup, resolve: (p) => p.setup }),
    owner: t.field({ type: Owner, resolve: (p) => p.owner }),
    createdAt: t.string({ resolve: (p) => p.createdAt.toISOString() }),
    submittedAt: t.string({ nullable: true, resolve: (p) => iso(p.submittedAt) }),
    checks: t.field({ type: Checks, resolve: (p) => p.checks }),
    approval: t.field({ type: Approval, nullable: true, resolve: (p) => p.approval }),
  }),
})

const Contact = builder.objectRef<PartnerDto['contacts'][number]>('PartnerContact').implement({
  fields: (t) => ({ name: t.exposeString('name'), role: t.exposeString('role'), email: t.exposeString('email') }),
})

const DoneBy = builder.objectRef<{ name: string; org: string }>('SetupDoneBy').implement({
  fields: (t) => ({ name: t.exposeString('name'), org: t.exposeString('org') }),
})

const Checklist = builder.objectRef<PartnerDto['checklist'][number]>('PartnerChecklistItem').implement({
  fields: (t) => ({
    item: t.exposeString('item'),
    status: t.exposeString('status'),
    detail: t.exposeString('detail', { nullable: true }),
    by: t.field({ type: DoneBy, nullable: true, resolve: (i) => i.by }),
  }),
})

const Branding = builder.objectRef<PartnerDto['branding']>('PartnerBranding').implement({
  fields: (t) => ({
    productName: t.exposeString('productName', { nullable: true }),
    primaryColor: t.exposeString('primaryColor', { nullable: true }),
    accentColor: t.exposeString('accentColor', { nullable: true }),
    poweredBy: t.exposeString('poweredBy'),
  }),
})

const Domain = builder.objectRef<PartnerDto['domains'][number]>('PartnerDomain').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    kind: t.exposeString('kind'),
    host: t.exposeString('host'),
    status: t.exposeString('status'),
    record: t.exposeString('record'),
    expected: t.exposeString('expected'),
    found: t.exposeString('found', { nullable: true }),
    checkedAt: t.string({ nullable: true, resolve: (d) => iso(d.checkedAt) }),
  }),
})

const Plan = builder.objectRef<PartnerDto['plans'][number]>('PartnerPlan').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    status: t.exposeString('status'),
    maxProducts: t.exposeInt('maxProducts', { nullable: true }),
    maxStaff: t.exposeInt('maxStaff', { nullable: true }),
    stores: t.exposeInt('stores'),
  }),
})

const TeamMember = builder.objectRef<PartnerDto['team'][number]>('PartnerUser').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    email: t.exposeString('email'),
    role: t.exposeString('role'),
    status: t.exposeString('status'),
    lastSignInAt: t.string({ nullable: true, resolve: (u) => iso(u.lastSignInAt) }),
  }),
})

const SetupSession = builder.objectRef<SetupSessionDto>('PartnerSetupSession').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    staff: t.exposeString('staff'),
    reason: t.exposeString('reason'),
    ticket: t.exposeString('ticket', { nullable: true }),
    startedAt: t.string({ resolve: (s) => s.startedAt.toISOString() }),
    expiresAt: t.string({ resolve: (s) => s.expiresAt.toISOString() }),
    endedAt: t.string({ nullable: true, resolve: (s) => iso(s.endedAt) }),
    status: t.exposeString('status'),
    end: t.field({ type: PermissionType, resolve: (s) => permission(s.end) }),
  }),
})

const Manager = builder.objectRef<PartnerManager>('PartnerManager').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    email: t.exposeString('email'),
    since: t.string({ resolve: (m) => m.since.toISOString() }),
  }),
})

const permissionOf = (p: PartnerPermissions[keyof PartnerPermissions]): Permission | null => (p ? permission(p) : null)

// An action absent from the block is not offered in this state; one present and refused is
// disabled with its reason (FIRST-RELEASE §4.3, decided on #19).
const Actions = builder.objectRef<PartnerPermissions>('PartnerActions').implement({
  fields: (t) => ({
    approve: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf(a.approve) }),
    sendBack: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf(a.sendBack) }),
    pause: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf(a.pause) }),
    resume: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf(a.resume) }),
    setupSession: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf(a.setupSession) }),
    sendInvite: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf(a.sendInvite) }),
    resendInvite: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf(a.resendInvite) }),
  }),
})

const PartnerType = builder.objectRef<PartnerDto>('Partner').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    house: t.exposeBoolean('house'),
    kind: t.exposeString('kind', { nullable: true }),
    region: t.exposeString('region', { nullable: true }),
    country: t.exposeString('country', { nullable: true }),
    state: t.exposeString('state'),
    stores: t.exposeInt('stores'),
    portalHost: t.field({ type: PortalHost, resolve: (p) => p.portalHost }),
    setup: t.field({ type: Setup, resolve: (p) => p.setup }),
    owner: t.field({ type: Owner, resolve: (p) => p.owner }),
    createdAt: t.string({ resolve: (p) => p.createdAt.toISOString() }),
    submittedAt: t.string({ nullable: true, resolve: (p) => iso(p.submittedAt) }),
    checks: t.field({ type: Checks, resolve: (p) => p.checks }),
    approval: t.field({ type: Approval, nullable: true, resolve: (p) => p.approval }),
    contacts: t.field({ type: [Contact], resolve: (p) => p.contacts }),
    history: t.field({ type: [HistoryEntryType], resolve: (p) => p.history }),
    checklist: t.field({ type: [Checklist], resolve: (p) => p.checklist }),
    branding: t.field({ type: Branding, resolve: (p) => p.branding }),
    domains: t.field({ type: [Domain], resolve: (p) => p.domains }),
    plans: t.field({ type: [Plan], resolve: (p) => p.plans }),
    team: t.field({ type: [TeamMember], resolve: (p) => p.team }),
    // Who is onboarding a partner, and why, is for the roles ACCESS.md §5.4 names; others read null (#14).
    setupSessions: t.field({
      type: [SetupSession],
      nullable: true,
      extensions: { access: { api: 'admin', scope: 'platform', permission: 'setupSessions.read', target: 'none' } },
      resolve: (p) => p.setupSessions,
    }),
    managers: t.field({ type: [Manager], resolve: (p) => p.managers }),
    actions: t.field({ type: Actions, resolve: (p) => p.actions }),
  }),
})

const Page = builder.objectRef<PartnerPage>('PartnerPage').implement({
  fields: (t) => ({
    items: t.field({ type: [PartnerRowType], resolve: (p) => p.items }),
    pageInfo: t.field({ type: PageInfoType, resolve: (p) => p.pageInfo }),
    create: t.field({ type: PermissionType, resolve: (p) => permission(p.create) }),
  }),
})

const Filter = builder.inputType('PartnerFilter', {
  fields: (t) => ({ state: t.string(), setup: t.string(), q: t.string(), sort: t.string() }),
})

const CreatePartnerInput = builder.inputType('CreatePartnerInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    ownerEmail: t.string({ required: true }),
    ownerName: t.string(),
    country: t.string({ required: true }),
    kind: t.string(),
    region: t.string(),
    sendInvitation: t.boolean({ required: true }),
  }),
})

interface Outcome {
  ok: boolean
  code: string | null
  failingChecks: string[] | null
  state: string | null
  id: string | null
  approvals: number | null
}

/** A mutation's answer: done, or refused with a stable code the console words (decided on #19). */
const OutcomeType = builder.objectRef<Outcome>('PartnerMutationOutcome').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    code: t.exposeString('code', { nullable: true }),
    failingChecks: t.stringList({ nullable: true, resolve: (o) => o.failingChecks }),
    state: t.exposeString('state', { nullable: true }),
    id: t.exposeID('id', { nullable: true }),
    approvals: t.exposeInt('approvals', { nullable: true }),
  }),
})

const outcome = (result: Result<Record<string, unknown>>): Outcome => ({
  ok: result.ok,
  code: result.ok ? null : result.code,
  failingChecks: result.ok ? null : (result.failingChecks ?? null),
  state: result.ok && typeof result['state'] === 'string' ? result['state'] : null,
  id: result.ok && typeof result['id'] === 'string' ? result['id'] : null,
  approvals: result.ok && typeof result['approvals'] === 'number' ? result['approvals'] : null,
})

interface SetupSessionStart {
  ok: boolean
  code: string | null
  sessionId: string | null
  expiresAt: string | null
  /** The one-time handoff, only ever here (ACCESS.md §8.3). */
  handoff: string | null
}

const SetupSessionStartType = builder.objectRef<SetupSessionStart>('SetupSessionStart').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    code: t.exposeString('code', { nullable: true }),
    sessionId: t.exposeID('sessionId', { nullable: true }),
    expiresAt: t.exposeString('expiresAt', { nullable: true }),
    handoff: t.exposeString('handoff', { nullable: true }),
  }),
})

const byId = ({ id }: { id: string }) => ({ partnerId: id })

builder.queryFields((t) => ({
  partners: t.field({
    type: Page,
    args: { filter: t.arg({ type: Filter }), after: t.arg.string(), before: t.arg.string(), first: t.arg.int() },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'partners.read', target: 'none' } },
    resolve: async (_, args, ctx) => {
      const result = await signedIn(ctx.partners).list(compact(args.filter), { after: args.after, before: args.before, first: args.first })
      if (!result.ok) throw new GraphQLError('Bad request.', { extensions: { code: result.code } })
      return result.page
    },
  }),
  partner: t.field({
    type: PartnerType,
    nullable: true,
    args: { id: t.arg.id({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'partners.read', target: byId } },
    resolve: (_, args, ctx) => signedIn(ctx.partners).get(String(args.id)),
  }),
}))

builder.mutationType({})

builder.mutationFields((t) => ({
  createPartner: t.field({
    type: OutcomeType,
    args: { input: t.arg({ type: CreatePartnerInput, required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'partners.create', target: 'none', audit: partnerAudit.createPartner } },
    resolve: async (_, args, ctx) => outcome(await signedIn(ctx.partners).createPartner(compact(args.input))),
  }),
  approvePartner: t.field({
    type: OutcomeType,
    args: { id: t.arg.id({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'partners.approve', target: byId, audit: partnerAudit.approvePartner } },
    resolve: async (_, args, ctx) => outcome(await signedIn(ctx.partners).approvePartner(String(args.id), args.reason)),
  }),
  sendBackPartner: t.field({
    type: OutcomeType,
    args: { id: t.arg.id({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'partners.approve', target: byId, audit: partnerAudit.sendBackPartner } },
    resolve: async (_, args, ctx) => outcome(await signedIn(ctx.partners).sendBackPartner(String(args.id), args.reason)),
  }),
  pausePartner: t.field({
    type: OutcomeType,
    args: { id: t.arg.id({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'partners.pause', target: byId, audit: partnerAudit.pausePartner } },
    resolve: async (_, args, ctx) => outcome(await signedIn(ctx.partners).pausePartner(String(args.id), args.reason)),
  }),
  resumePartner: t.field({
    type: OutcomeType,
    args: { id: t.arg.id({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'partners.pause', target: byId, audit: partnerAudit.resumePartner } },
    resolve: async (_, args, ctx) => outcome(await signedIn(ctx.partners).resumePartner(String(args.id), args.reason)),
  }),
  sendPartnerOwnerInvite: t.field({
    type: OutcomeType,
    args: { id: t.arg.id({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'partners.invite', target: byId, audit: partnerAudit.sendPartnerOwnerInvite } },
    resolve: async (_, args, ctx) => outcome(await signedIn(ctx.partners).sendPartnerOwnerInvite(String(args.id))),
  }),
  resendPartnerOwnerInvite: t.field({
    type: OutcomeType,
    args: { id: t.arg.id({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'partners.invite.resend', target: byId, audit: partnerAudit.resendPartnerOwnerInvite } },
    resolve: async (_, args, ctx) => outcome(await signedIn(ctx.partners).resendPartnerOwnerInvite(String(args.id))),
  }),
  startPartnerSetupSession: t.field({
    type: SetupSessionStartType,
    args: { id: t.arg.id({ required: true }), reason: t.arg.string({ required: true }), ticket: t.arg.string() },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'partners.setup', target: byId, audit: partnerAudit.startPartnerSetupSession } },
    resolve: async (_, args, ctx) => {
      const result = await signedIn(ctx.partners).startSetupSession(String(args.id), args.reason, args.ticket ?? null)
      return result.ok
        ? { ok: true, code: null, sessionId: result.sessionId, expiresAt: result.expiresAt.toISOString(), handoff: result.handoff }
        : { ok: false, code: result.code, sessionId: null, expiresAt: null, handoff: null }
    },
  }),
  endStaffSession: t.field({
    type: OutcomeType,
    args: { id: t.arg.id({ required: true }) },
    // Any staff member may ask; whose session it is decides, in the service (ACCESS.md §8.2).
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'setupSessions.read', target: 'none', audit: partnerAudit.endStaffSession } },
    resolve: async (_, args, ctx) => outcome(await signedIn(ctx.partners).endStaffSession(String(args.id))),
  }),
  recheckDomain: t.field({
    type: OutcomeType,
    args: { id: t.arg.id({ required: true }), kind: t.arg.string({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'domains.recheck', target: byId, audit: partnerAudit.recheckDomain } },
    resolve: async (_, args, ctx) => outcome(await signedIn(ctx.partners).recheckDomain(String(args.id), args.kind)),
  }),
  assignPartnerManager: t.field({
    type: OutcomeType,
    args: { id: t.arg.id({ required: true }), staffId: t.arg.id({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'partners.assign', target: byId, audit: partnerAudit.assignPartnerManager } },
    resolve: async (_, args, ctx) => outcome(await signedIn(ctx.partners).assignPartnerManager(String(args.id), String(args.staffId), args.reason)),
  }),
  unassignPartnerManager: t.field({
    type: OutcomeType,
    args: { id: t.arg.id({ required: true }), staffId: t.arg.id({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'partners.assign', target: byId, audit: partnerAudit.unassignPartnerManager } },
    resolve: async (_, args, ctx) => outcome(await signedIn(ctx.partners).unassignPartnerManager(String(args.id), String(args.staffId), args.reason)),
  }),
}))

