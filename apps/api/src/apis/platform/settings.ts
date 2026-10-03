import { GraphQLError } from 'graphql'
import { teamAudit, type PartnerTeamService, type TeamMemberDto } from '#saas/partnerTeam/index'
import { unauthenticated } from '../graphql/scope'
import { builder } from './builder'
import { MoneyType } from './money'

// Settings on the Platform API (ui/platform/FIRST-RELEASE.md §14; card #199). Thin:
// saas/partnerTeam decides; payout account and payment method are #201's.

const service = (team: PartnerTeamService | null): PartnerTeamService => {
  if (!team) throw unauthenticated()
  return team
}

type Company = NonNullable<Awaited<ReturnType<PartnerTeamService['partnerCompany']>>>
type Contract = NonNullable<Company['contract']>
type TeamPage = NonNullable<Awaited<ReturnType<PartnerTeamService['team']>>>

const Contact = builder.objectRef<NonNullable<Company['mainContact']>>('PartnerContact').implement({
  fields: (t) => ({ name: t.exposeString('name'), email: t.exposeString('email') }),
})

const Fee = builder.objectRef<Contract['fees'][number]>('PartnerPlanFee').implement({
  fields: (t) => ({ plan: t.exposeString('plan'), fee: t.field({ type: MoneyType, resolve: (f) => ({ amount: f.amount, currency: f.currency }) }) }),
})

const ContractType = builder.objectRef<Contract>('PartnerContractTerms').implement({
  fields: (t) => ({
    feeCurrency: t.exposeString('feeCurrency'),
    poweredByRemovable: t.exposeBoolean('poweredByRemovable'),
    poweredByNote: t.exposeString('poweredByNote', { nullable: true }),
    fees: t.field({ type: [Fee], resolve: (c) => c.fees }),
    moreFees: t.exposeBoolean('moreFees'),
  }),
})

const CompanyType = builder.objectRef<Company>('PartnerCompany').implement({
  fields: (t) => ({
    name: t.exposeString('name'),
    country: t.exposeString('country', { nullable: true }),
    region: t.exposeString('region', { nullable: true }),
    kind: t.exposeString('kind', { nullable: true }),
    mainContact: t.field({ type: Contact, nullable: true, resolve: (c) => c.mainContact }),
    billingContact: t.field({ type: Contact, nullable: true, resolve: (c) => c.billingContact }),
    contract: t.field({ type: ContractType, nullable: true, resolve: (c) => c.contract }),
    secondFactorRequired: t.exposeBoolean('secondFactorRequired'),
  }),
})

const Invitation = builder.objectRef<NonNullable<TeamMemberDto['invitation']>>('TeamInvitationState').implement({
  fields: (t) => ({ sentAt: t.string({ nullable: true, resolve: (i) => i.sentAt?.toISOString() ?? null }), expired: t.exposeBoolean('expired') }),
})

const Member = builder.objectRef<TeamMemberDto>('TeamMember').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    email: t.exposeString('email'),
    role: t.exposeString('role'),
    you: t.exposeBoolean('you'),
    status: t.exposeString('status'),
    lastSignInAt: t.string({ nullable: true, resolve: (m) => m.lastSignInAt?.toISOString() ?? null }),
    invitation: t.field({ type: Invitation, nullable: true, resolve: (m) => m.invitation }),
    secondFactor: t.exposeBoolean('secondFactor'),
  }),
})

const PageInfoType = builder.objectRef<TeamPage['pageInfo']>('TeamPageInfo').implement({
  fields: (t) => ({
    hasNextPage: t.exposeBoolean('hasNextPage'),
    hasPreviousPage: t.exposeBoolean('hasPreviousPage'),
    startCursor: t.exposeString('startCursor', { nullable: true }),
    endCursor: t.exposeString('endCursor', { nullable: true }),
  }),
})

const TeamPageType = builder.objectRef<TeamPage>('TeamPage').implement({
  fields: (t) => ({ items: t.field({ type: [Member], resolve: (p) => p.items }), pageInfo: t.field({ type: PageInfoType, resolve: (p) => p.pageInfo }) }),
})

const Result = builder.objectRef<{ ok: boolean; reason?: string }>('TeamResult').implement({
  fields: (t) => ({ ok: t.exposeBoolean('ok'), reason: t.string({ nullable: true, resolve: (r) => r.reason ?? null }) }),
})

const read = { api: 'platform', scope: 'partner', permission: 'partner.read', target: 'none' } as const

builder.queryFields((t) => ({
  partnerCompany: t.field({ type: CompanyType, nullable: true, extensions: { access: read }, resolve: (_, __, ctx) => service(ctx.team).partnerCompany() }),
  team: t.field({
    type: TeamPageType,
    args: { after: t.arg.string(), before: t.arg.string(), first: t.arg.int() },
    extensions: { access: read },
    resolve: async (_, { after, before, first }, ctx) => {
      const page = await service(ctx.team).team({ after, before, first })
      if (!page) throw new GraphQLError('That page link does not work.', { extensions: { code: 'INVALID_INPUT' } })
      return page
    },
  }),
}))

const manage = (audit: string) => ({ access: { api: 'platform' as const, scope: 'partner' as const, permission: 'team.manage' as const, target: 'none' as const, audit } })

builder.mutationFields((t) => ({
  inviteTeamMember: t.field({
    type: Result,
    args: { name: t.arg.string({ required: true }), email: t.arg.string({ required: true }), role: t.arg.string({ required: true }) },
    extensions: manage(teamAudit.inviteTeamMember),
    resolve: (_, args, ctx) => service(ctx.team).inviteTeamMember(args),
  }),
  resendTeamInvite: t.field({ type: Result, args: { id: t.arg.id({ required: true }) }, extensions: manage(teamAudit.resendTeamInvite), resolve: (_, { id }, ctx) => service(ctx.team).resendTeamInvite(String(id)) }),
  revokeTeamInvite: t.field({ type: Result, args: { id: t.arg.id({ required: true }) }, extensions: manage(teamAudit.revokeTeamInvite), resolve: (_, { id }, ctx) => service(ctx.team).revokeTeamInvite(String(id)) }),
  changeTeamRole: t.field({
    type: Result,
    args: { id: t.arg.id({ required: true }), role: t.arg.string({ required: true }) },
    extensions: manage(teamAudit.changeTeamRole),
    resolve: (_, { id, role }, ctx) => service(ctx.team).changeTeamRole(String(id), role),
  }),
  removeTeamMember: t.field({ type: Result, args: { id: t.arg.id({ required: true }) }, extensions: manage(teamAudit.removeTeamMember), resolve: (_, { id }, ctx) => service(ctx.team).removeTeamMember(String(id)) }),
  transferOwnership: t.field({
    type: Result,
    args: { toUserId: t.arg.id({ required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'team.transfer', target: 'none', audit: teamAudit.transferOwnership } },
    resolve: (_, { toUserId }, ctx) => service(ctx.team).transferOwnership(String(toUserId)),
  }),
  setSecondFactorPolicy: t.field({
    type: Result,
    args: { required: t.arg.boolean({ required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'security.manage', target: 'none', audit: teamAudit.setSecondFactorPolicy } },
    resolve: (_, { required }, ctx) => service(ctx.team).setSecondFactorPolicy(required),
  }),
}))
