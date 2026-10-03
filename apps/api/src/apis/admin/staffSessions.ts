import { GraphQLError } from 'graphql'
import { sessionAudit, type ImpersonationTargetDto, type StaffSessionDto, type StaffSessionsService } from '#saas/staffSessions/index'
import { builder } from './builder'
import { compact, iso, PageInfoType, PermissionType, signedIn } from './types'

// Staff sessions on the Admin API (ui/admin/FIRST-RELEASE.md §8, §12; ACCESS.md §8.1–§8.3;
// card #40). The handoff exists only in the link a start or a return answers: never on a
// session record, in a page or in a log. `endStaffSession` (partners.ts) ends either kind.

type TargetPage = NonNullable<Awaited<ReturnType<StaffSessionsService['impersonationTargets']>>>
type SessionPage = NonNullable<Awaited<ReturnType<StaffSessionsService['staffSessions']>>>
type Permission = { allowed: boolean; reason?: string }

const permissionOf = (p: Permission) => ({ allowed: p.allowed, reason: p.reason ?? null, failingChecks: null })

const Ref = builder.objectRef<{ id: string; name: string }>('StaffSessionRef').implement({
  fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }),
})

const Membership = builder.objectRef<ImpersonationTargetDto['memberships'][number]>('ImpersonationMembership').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    level: t.exposeString('level'),
    partner: t.field({ type: Ref, resolve: (m) => ({ id: m.partnerId, name: m.partnerName }) }),
    store: t.field({ type: Ref, nullable: true, resolve: (m) => (m.storeId && m.storeName ? { id: m.storeId, name: m.storeName } : null) }),
    role: t.exposeString('role'),
    supplier: t.string({ nullable: true, resolve: (m) => m.supplier ?? null }),
  }),
})

const Target = builder.objectRef<ImpersonationTargetDto>('ImpersonationTarget').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    email: t.exposeString('email'),
    kind: t.exposeString('kind'),
    memberships: t.field({ type: [Membership], resolve: (x) => x.memberships }),
    lastSignInAt: t.string({ nullable: true, resolve: (x) => iso(x.lastSignInAt) }),
    status: t.exposeString('status'),
    impersonate: t.field({ type: PermissionType, resolve: (x) => permissionOf(x.impersonate) }),
    openSession: t.exposeID('openSession', { nullable: true }),
  }),
})

const TargetPageType = builder.objectRef<TargetPage>('ImpersonationTargetPage').implement({
  fields: (t) => ({
    items: t.field({ type: [Target], resolve: (p) => p.items }),
    pageInfo: t.field({ type: PageInfoType, resolve: (p) => p.pageInfo }),
    partners: t.field({ type: [Ref], resolve: (p) => p.partners }),
  }),
})

const SessionMembership = builder.objectRef<NonNullable<StaffSessionDto['membership']>>('StaffSessionMembership').implement({
  fields: (t) => ({ role: t.exposeString('role'), supplier: t.exposeString('supplier', { nullable: true }) }),
})

const Actions = builder.objectRef<StaffSessionDto['actions']>('StaffSessionActions').implement({
  fields: (t) => ({
    end: t.field({ type: PermissionType, resolve: (a) => permissionOf(a.end) }),
    extend: t.field({ type: PermissionType, resolve: (a) => permissionOf(a.extend) }),
    return: t.field({ type: PermissionType, resolve: (a) => permissionOf(a.return) }),
  }),
})

const Session = builder.objectRef<StaffSessionDto>('StaffSession').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    kind: t.exposeString('kind'),
    staff: t.field({ type: Ref, resolve: (s) => s.staff }),
    target: t.field({ type: Ref, nullable: true, resolve: (s) => s.target }),
    membership: t.field({ type: SessionMembership, nullable: true, resolve: (s) => s.membership }),
    partner: t.field({ type: Ref, resolve: (s) => s.partner }),
    store: t.field({ type: Ref, nullable: true, resolve: (s) => s.store }),
    host: t.exposeString('host'),
    reason: t.exposeString('reason'),
    ticket: t.exposeString('ticket', { nullable: true }),
    startedAt: t.string({ resolve: (s) => s.startedAt.toISOString() }),
    expiresAt: t.string({ resolve: (s) => s.expiresAt.toISOString() }),
    endedAt: t.string({ nullable: true, resolve: (s) => iso(s.endedAt) }),
    extendedAt: t.string({ nullable: true, resolve: (s) => iso(s.extendedAt) }),
    outcome: t.exposeString('outcome'),
    mine: t.exposeBoolean('mine'),
    actions: t.field({ type: Actions, resolve: (s) => s.actions }),
  }),
})

const History = builder.objectRef<SessionPage['history']>('StaffSessionHistory').implement({
  fields: (t) => ({ items: t.field({ type: [Session], resolve: (h) => h.items }), pageInfo: t.field({ type: PageInfoType, resolve: (h) => h.pageInfo }) }),
})

const SessionPageType = builder.objectRef<SessionPage>('StaffSessionPage').implement({
  fields: (t) => ({
    open: t.field({ type: [Session], resolve: (p) => p.open }),
    history: t.field({ type: History, resolve: (p) => p.history }),
    partners: t.field({ type: [Ref], resolve: (p) => p.partners }),
  }),
})

type Lookup = Awaited<ReturnType<StaffSessionsService['staffSession']>>
const LookupType = builder.objectRef<Lookup>('StaffSessionLookup').implement({
  fields: (t) => ({ kind: t.exposeString('kind'), session: t.field({ type: Session, nullable: true, resolve: (l) => (l.kind === 'found' ? l.session : null) }) }),
})

type Opened = { ok: boolean; reason?: string; sessionId?: string | undefined; session?: StaffSessionDto; handoff?: string }
const Started = builder.objectRef<Opened>('StaffSessionStart').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    reason: t.string({ nullable: true, resolve: (r) => r.reason ?? null }),
    session: t.field({ type: Session, nullable: true, resolve: (r) => r.session ?? null }),
    // The one-time link that opens the portal (ACCESS.md §8.3); the open session's id on IMPERSONATION_ALREADY_OPEN.
    handoff: t.string({ nullable: true, resolve: (r) => r.handoff ?? null }),
    openSessionId: t.string({ nullable: true, resolve: (r) => r.sessionId ?? null }),
  }),
})

const Extended = builder.objectRef<{ ok: boolean; reason?: string; expiresAt?: Date }>('StaffSessionExtend').implement({
  fields: (t) => ({ ok: t.exposeBoolean('ok'), reason: t.string({ nullable: true, resolve: (r) => r.reason ?? null }), expiresAt: t.string({ nullable: true, resolve: (r) => iso(r.expiresAt ?? null) }) }),
})

const TargetFilter = builder.inputType('ImpersonationTargetFilter', {
  fields: (t) => ({ type: t.string(), partner: t.id(), store: t.id(), role: t.string(), status: t.string() }),
})
const SessionFilter = builder.inputType('StaffSessionFilter', {
  fields: (t) => ({ kind: t.string(), staff: t.id(), partner: t.id(), store: t.id(), date: t.string() }),
})

const impersonate = (audit?: string) => ({ access: { api: 'admin' as const, scope: 'platform' as const, permission: 'impersonate' as const, target: 'none' as const, ...(audit ? { audit } : {}) } })
const sessionsRead = { api: 'admin', scope: 'platform', permission: 'setupSessions.read', target: 'none' } as const
const invalid = () => new GraphQLError('That filter or page link does not work.', { extensions: { code: 'INVALID_INPUT' } })

builder.queryFields((t) => ({
  impersonationTargets: t.field({
    type: TargetPageType,
    // `search`: name or email, a variable in the request body, never a URL (§8).
    args: { filter: t.arg({ type: TargetFilter }), search: t.arg.string(), after: t.arg.string(), before: t.arg.string(), first: t.arg.int() },
    extensions: impersonate(),
    resolve: async (_, { filter, search, after, before, first }, ctx) => (await signedIn(ctx.staffSessions).impersonationTargets(compact(filter), search ?? null, { after, before, first })) ?? Promise.reject(invalid()),
  }),
  staffSessions: t.field({
    type: SessionPageType,
    args: { filter: t.arg({ type: SessionFilter }), after: t.arg.string(), before: t.arg.string(), first: t.arg.int() },
    extensions: { access: sessionsRead },
    resolve: async (_, { filter, after, before, first }, ctx) => (await signedIn(ctx.staffSessions).staffSessions(compact(filter), { after, before, first })) ?? Promise.reject(invalid()),
  }),
  staffSession: t.field({ type: LookupType, args: { id: t.arg.id({ required: true }) }, extensions: { access: sessionsRead }, resolve: (_, { id }, ctx) => signedIn(ctx.staffSessions).staffSession(String(id)) }),
  myStaffSessions: t.field({ type: [Session], extensions: { access: { api: 'admin', scope: 'session', permission: null, target: 'none' } }, resolve: (_, __, ctx) => signedIn(ctx.staffSessions).myStaffSessions() }),
}))

builder.mutationFields((t) => ({
  startImpersonation: t.field({
    type: Started,
    args: { targetId: t.arg.id({ required: true }), membershipId: t.arg.id({ required: true }), reason: t.arg.string({ required: true }), ticket: t.arg.string() },
    extensions: impersonate(sessionAudit.startImpersonation),
    resolve: (_, a, ctx) => signedIn(ctx.staffSessions).startImpersonation(String(a.targetId), String(a.membershipId), a.reason, a.ticket ?? null),
  }),
  extendImpersonation: t.field({ type: Extended, args: { id: t.arg.id({ required: true }) }, extensions: impersonate(sessionAudit.extendImpersonation), resolve: (_, { id }, ctx) => signedIn(ctx.staffSessions).extendSession(String(id)) }),
  returnToSession: t.field({ type: Started, args: { id: t.arg.id({ required: true }) }, extensions: { access: { ...sessionsRead, audit: sessionAudit.returnToSession } }, resolve: (_, { id }, ctx) => signedIn(ctx.staffSessions).returnToSession(String(id)) }),
}))
