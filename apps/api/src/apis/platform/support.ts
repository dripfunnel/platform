import { GraphQLError } from 'graphql'
import { supportAudit, type PartnerSupportService, type SupportSessionDto, type SupportTargetDto, type Verdict } from '#saas/support/index'
import { builder } from './builder'
import { signedIn } from './fields'

// Support on the Platform API (ui/platform/FIRST-RELEASE.md §12, §16; card #202). Every field is
// the Support menu's, so every field needs `support.session` (ACCESS.md §5.3).

type Page<T> = { items: T[]; pageInfo: { hasNextPage: boolean; hasPreviousPage: boolean; startCursor: string | null; endCursor: string | null } }

const VerdictType = builder.objectRef<Verdict>('SupportVerdict').implement({
  fields: (t) => ({ allowed: t.exposeBoolean('allowed'), reason: t.exposeString('reason', { nullable: true }) }),
})

const Named = builder.objectRef<{ id: string; name: string }>('SupportNamed').implement({
  fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }),
})

const Colleague = builder.objectRef<NonNullable<SupportTargetDto['colleague']>>('SupportColleague').implement({
  fields: (t) => ({ name: t.exposeString('name'), minutesLeft: t.exposeInt('minutesLeft') }),
})

const Target = builder.objectRef<SupportTargetDto>('SupportTarget').implement({
  fields: (t) => ({
    membershipId: t.exposeID('membershipId'),
    userId: t.exposeID('userId'),
    name: t.exposeString('name'),
    email: t.exposeString('email'),
    type: t.exposeString('type'),
    store: t.field({ type: Named, resolve: (r) => r.store }),
    role: t.exposeString('role'),
    supplier: t.exposeString('supplier', { nullable: true }),
    lastSignInAt: t.string({ nullable: true, resolve: (r) => r.lastSignInAt?.toISOString() ?? null }),
    status: t.exposeString('status'),
    start: t.field({ type: VerdictType, resolve: (r) => r.start }),
    storeOwner: t.exposeString('storeOwner', { nullable: true }),
    colleague: t.field({ type: Colleague, nullable: true, resolve: (r) => r.colleague }),
    mySessionId: t.exposeID('mySessionId', { nullable: true }),
  }),
})

const SessionUser = builder.objectRef<SupportSessionDto['user']>('SupportSessionUser').implement({
  fields: (t) => ({ name: t.exposeString('name'), role: t.exposeString('role'), supplier: t.exposeString('supplier', { nullable: true }) }),
})

const Session = builder.objectRef<SupportSessionDto>('SupportSession').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    user: t.field({ type: SessionUser, resolve: (s) => s.user }),
    store: t.field({ type: Named, resolve: (s) => s.store }),
    agent: t.field({ type: Named, resolve: (s) => s.agent }),
    you: t.exposeBoolean('you'),
    reason: t.exposeString('reason'),
    ticket: t.exposeString('ticket', { nullable: true }),
    startedAt: t.string({ resolve: (s) => s.startedAt.toISOString() }),
    expiresAt: t.string({ resolve: (s) => s.expiresAt.toISOString() }),
    endedAt: t.string({ nullable: true, resolve: (s) => s.endedAt?.toISOString() ?? null }),
    endedBy: t.exposeString('endedBy', { nullable: true }),
    endedByName: t.exposeString('endedByName', { nullable: true }),
    end: t.field({ type: VerdictType, resolve: (s) => s.end }),
    return: t.field({ type: VerdictType, resolve: (s) => s.return }),
  }),
})

const PageInfoType = builder.objectRef<Page<unknown>['pageInfo']>('SupportPageInfo').implement({
  fields: (t) => ({
    hasNextPage: t.exposeBoolean('hasNextPage'),
    hasPreviousPage: t.exposeBoolean('hasPreviousPage'),
    startCursor: t.exposeString('startCursor', { nullable: true }),
    endCursor: t.exposeString('endCursor', { nullable: true }),
  }),
})

const TargetPage = builder.objectRef<Page<SupportTargetDto>>('SupportTargetPage').implement({
  fields: (t) => ({ items: t.field({ type: [Target], resolve: (p) => p.items }), pageInfo: t.field({ type: PageInfoType, resolve: (p) => p.pageInfo }) }),
})

const SessionPage = builder.objectRef<Page<SupportSessionDto>>('SupportSessionPage').implement({
  fields: (t) => ({ items: t.field({ type: [Session], resolve: (p) => p.items }), pageInfo: t.field({ type: PageInfoType, resolve: (p) => p.pageInfo }) }),
})

type ReauthOut = { ok: boolean; code?: string; proof?: string; expiresAt?: Date; triesLeft?: number; minutes?: number }
const Reauth = builder.objectRef<ReauthOut>('ReauthResult').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    reason: t.string({ nullable: true, resolve: (r) => r.code ?? null }),
    // The single-use proof startSupportSession takes; only ever in this answer.
    proof: t.string({ nullable: true, resolve: (r) => r.proof ?? null }),
    expiresAt: t.string({ nullable: true, resolve: (r) => r.expiresAt?.toISOString() ?? null }),
    triesLeft: t.int({ nullable: true, resolve: (r) => r.triesLeft ?? null }),
    lockedMinutes: t.int({ nullable: true, resolve: (r) => r.minutes ?? null }),
  }),
})

type Opened = { ok: boolean; reason?: string; sessionId?: string; expiresAt?: Date; link?: string }
const Open = builder.objectRef<Opened>('SupportSessionLink').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    reason: t.string({ nullable: true, resolve: (r) => r.reason ?? null }),
    sessionId: t.string({ nullable: true, resolve: (r) => r.sessionId ?? null }),
    expiresAt: t.string({ nullable: true, resolve: (r) => r.expiresAt?.toISOString() ?? null }),
    // ACCESS.md §8.3: the handoff lives only in this link, opened once in a new tab.
    link: t.string({ nullable: true, resolve: (r) => r.link ?? null }),
  }),
})

const Ended = builder.objectRef<{ ok: boolean; reason?: string }>('SupportSessionResult').implement({
  fields: (t) => ({ ok: t.exposeBoolean('ok'), reason: t.string({ nullable: true, resolve: (r) => r.reason ?? null }) }),
})

// A partner user's own access to a merchant, proved with their own second factor: no staff
// session uses it (ACCESS.md §8.1, §8.2; staff impersonate the store user instead).
const support = (audit?: string) => ({
  access: { api: 'platform' as const, scope: 'partner' as const, permission: 'support.session' as const, target: 'none' as const, blockedFor: ['impersonation', 'setup'] as const, ...(audit ? { audit } : {}) },
})
const badPage = () => new GraphQLError('That page link does not work.', { extensions: { code: 'INVALID_INPUT' } })
const service = (ctx: { support: PartnerSupportService | null }) => signedIn(ctx.support)

builder.queryFields((t) => ({
  supportTargets: t.field({
    type: TargetPage,
    args: { search: t.arg.string(), after: t.arg.string(), before: t.arg.string(), first: t.arg.int() },
    extensions: support(),
    resolve: async (_, { search, after, before, first }, ctx) => (await service(ctx).supportTargets(search ?? null, { after, before, first })) ?? Promise.reject(badPage()),
  }),
  supportSessions: t.field({
    type: SessionPage,
    args: { open: t.arg.boolean({ required: true }), after: t.arg.string(), before: t.arg.string(), first: t.arg.int() },
    extensions: support(),
    resolve: async (_, { open, after, before, first }, ctx) => (await service(ctx).supportSessions(open, { after, before, first })) ?? Promise.reject(badPage()),
  }),
  mySupportSession: t.field({ type: Session, nullable: true, extensions: support(), resolve: (_, __, ctx) => service(ctx).mySupportSession() }),
}))

builder.mutationFields((t) => ({
  reauthenticate: t.field({
    type: Reauth,
    args: { code: t.arg.string({ required: true }) },
    extensions: support('partner_user.reauthenticated'),
    resolve: (_, { code }, ctx) => service(ctx).reauthenticate(code),
  }),
  startSupportSession: t.field({
    type: Open,
    args: { membershipId: t.arg.id({ required: true }), reason: t.arg.string({ required: true }), ticket: t.arg.string(), proof: t.arg.string({ required: true }) },
    extensions: support(supportAudit.startSupportSession),
    resolve: (_, args, ctx) => service(ctx).startSupportSession({ membershipId: String(args.membershipId), reason: args.reason, ticket: args.ticket ?? null, proof: args.proof }),
  }),
  returnToSupportSession: t.field({
    type: Open,
    args: { id: t.arg.id({ required: true }) },
    extensions: support(supportAudit.returnToSupportSession),
    resolve: (_, { id }, ctx) => service(ctx).returnToSupportSession(String(id)),
  }),
  endSupportSession: t.field({
    type: Ended,
    args: { id: t.arg.id({ required: true }) },
    extensions: support(supportAudit.endSupportSession),
    resolve: (_, { id }, ctx) => service(ctx).endSupportSession(String(id)),
  }),
}))
