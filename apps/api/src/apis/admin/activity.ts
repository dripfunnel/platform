import { GraphQLError } from 'graphql'
import type { RecordedChange } from '#core/redaction'
import { staffActivityAudit, type StaffActivityEntry, type StaffActivityService } from '#saas/staffActivity/index'
import { builder } from './builder'
import { compact, iso, PageInfoType, PermissionType, signedIn } from './types'

// The activity log as the admin console reads it (ui/admin/FIRST-RELEASE.md §9, LOGGING.md §6:
// staff see every entry, IP and user agent included; card #38). Read-only: no mutation edits or
// deletes an entry. The partner, store and customer tabs are `activityLog` with a filter.

type Page = NonNullable<Awaited<ReturnType<StaffActivityService['activityLog']>>>
type Timeline = NonNullable<Awaited<ReturnType<StaffActivityService['personTimeline']>>>
type Person = NonNullable<Awaited<ReturnType<StaffActivityService['activityPerson']>>>
type Match = NonNullable<Awaited<ReturnType<StaffActivityService['activityPeople']>>>[number]
type Job = NonNullable<Awaited<ReturnType<StaffActivityService['activityExport']>>>

const Change = builder.objectRef<RecordedChange>('ActivityChange').implement({
  fields: (t) => ({
    field: t.exposeString('field'),
    before: t.exposeString('before', { nullable: true }),
    after: t.exposeString('after', { nullable: true }),
    redacted: t.exposeBoolean('redacted'),
  }),
})

const Actor = builder.objectRef<StaffActivityEntry['actor']>('ActivityActor').implement({
  fields: (t) => ({ kind: t.exposeString('kind'), id: t.exposeID('id', { nullable: true }), label: t.exposeString('label') }),
})

const Agent = builder.objectRef<NonNullable<StaffActivityEntry['onBehalfOf']>>('ActivityAgent').implement({
  fields: (t) => ({ id: t.exposeID('id'), label: t.exposeString('label') }),
})

const Access = builder.objectRef<NonNullable<StaffActivityEntry['access']>>('ActivityAccess').implement({
  fields: (t) => ({ kind: t.exposeString('kind'), id: t.exposeID('id') }),
})

const Named = builder.objectRef<{ id: string; name: string }>('ActivityNamed').implement({
  fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }),
})

const Target = builder.objectRef<NonNullable<StaffActivityEntry['target']>>('ActivityTarget').implement({
  fields: (t) => ({ type: t.exposeString('type'), id: t.exposeID('id'), label: t.exposeString('label') }),
})

const Entry = builder.objectRef<StaffActivityEntry>('ActivityEntry').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    occurredAt: t.string({ resolve: (e) => e.occurredAt.toISOString() }),
    action: t.exposeString('action'),
    level: t.exposeString('level'),
    result: t.exposeString('result'),
    actor: t.field({ type: Actor, resolve: (e) => e.actor }),
    onBehalfOf: t.field({ type: Agent, nullable: true, resolve: (e) => e.onBehalfOf }),
    access: t.field({ type: Access, nullable: true, resolve: (e) => e.access }),
    partner: t.field({ type: Named, nullable: true, resolve: (e) => e.partner }),
    store: t.field({ type: Named, nullable: true, resolve: (e) => e.store }),
    target: t.field({ type: Target, nullable: true, resolve: (e) => e.target }),
    changes: t.field({ type: [Change], resolve: (e) => e.changes }),
    reason: t.exposeString('reason', { nullable: true }),
    requestId: t.exposeString('requestId'),
    ip: t.exposeString('ip', { nullable: true }),
    userAgent: t.exposeString('userAgent', { nullable: true }),
  }),
})

const StoreOption = builder.objectRef<Page['stores'][number]>('ActivityStoreOption').implement({
  fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name'), partnerId: t.exposeID('partnerId') }),
})

const PageType = builder.objectRef<Page>('ActivityPage').implement({
  fields: (t) => ({
    items: t.field({ type: [Entry], resolve: (p) => p.items }),
    pageInfo: t.field({ type: PageInfoType, resolve: (p) => p.pageInfo }),
    export: t.field({ type: PermissionType, resolve: (p) => ({ allowed: p.export.allowed, reason: p.export.allowed ? null : p.export.reason, failingChecks: null }) }),
    partners: t.field({ type: [Named], resolve: (p) => p.partners }),
    stores: t.field({ type: [StoreOption], resolve: (p) => p.stores }),
  }),
})

const TimelineType = builder.objectRef<Timeline>('ActivityTimeline').implement({
  fields: (t) => ({ items: t.field({ type: [Entry], resolve: (p) => p.items }), pageInfo: t.field({ type: PageInfoType, resolve: (p) => p.pageInfo }) }),
})

const MatchType = builder.objectRef<Match>('ActivityPersonMatch').implement({
  fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name'), email: t.exposeString('email'), kind: t.exposeString('kind'), where: t.exposeString('where') }),
})

const Membership = builder.objectRef<Person['memberships'][number]>('ActivityMembership').implement({
  fields: (t) => ({ where: t.exposeString('where'), role: t.exposeString('role') }),
})

const PersonType = builder.objectRef<Person>('ActivityPerson').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    email: t.exposeString('email'),
    kind: t.exposeString('kind'),
    where: t.exposeString('where'),
    memberships: t.field({ type: [Membership], resolve: (p) => p.memberships }),
    sameEmailAccounts: t.exposeInt('sameEmailAccounts'),
  }),
})

const JobType = builder.objectRef<Job>('ActivityExportJob').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    state: t.exposeString('state'),
    entries: t.exposeInt('entries', { nullable: true }),
    // No R2 bucket is bound yet (THIRD-PARTY-ACCESS §2.1), so the file comes inline until it is.
    csv: t.exposeString('csv', { nullable: true }),
    expiresAt: t.string({ nullable: true, resolve: (j) => iso(j.expiresAt) }),
  }),
})

const ExportResult = builder.objectRef<{ ok: boolean; jobId?: string; reason?: string }>('ActivityExportResult').implement({
  fields: (t) => ({ ok: t.exposeBoolean('ok'), jobId: t.string({ nullable: true, resolve: (r) => r.jobId ?? null }), reason: t.string({ nullable: true, resolve: (r) => r.reason ?? null }) }),
})

const Filter = builder.inputType('ActivityFilter', {
  fields: (t) => ({
    person: t.string(),
    actor: t.string(),
    level: t.string(),
    action: t.string(),
    result: t.string(),
    partner: t.id(),
    store: t.id(),
    customer: t.id(),
    target: t.string(),
    date: t.string(),
    from: t.string(),
    to: t.string(),
    ip: t.string(),
    imp: t.id(),
    su: t.id(),
  }),
})

const read = { api: 'admin', scope: 'platform', permission: 'activity.read', target: 'none' } as const
const invalid = () => new GraphQLError('That filter or page link does not work.', { extensions: { code: 'INVALID_INPUT' } })

builder.queryFields((t) => ({
  activityLog: t.field({
    type: PageType,
    args: { filter: t.arg({ type: Filter }), after: t.arg.string(), before: t.arg.string(), first: t.arg.int() },
    extensions: { access: read },
    resolve: async (_, { filter, after, before, first }, ctx) => (await signedIn(ctx.staffActivity).activityLog(compact(filter), { after, before, first })) ?? Promise.reject(invalid()),
  }),
  personTimeline: t.field({
    type: TimelineType,
    args: { person: t.arg.string({ required: true }), filter: t.arg({ type: Filter }), after: t.arg.string(), before: t.arg.string(), first: t.arg.int() },
    extensions: { access: read },
    resolve: async (_, { person, filter, after, before, first }, ctx) => (await signedIn(ctx.staffActivity).personTimeline(person, compact(filter), { after, before, first })) ?? Promise.reject(invalid()),
  }),
  activityPeople: t.field({
    type: [MatchType],
    args: { query: t.arg.string({ required: true }) },
    extensions: { access: read },
    resolve: async (_, { query }, ctx) => (await signedIn(ctx.staffActivity).activityPeople(query)) ?? Promise.reject(invalid()),
  }),
  activityPerson: t.field({ type: PersonType, nullable: true, args: { person: t.arg.string({ required: true }) }, extensions: { access: read }, resolve: (_, { person }, ctx) => signedIn(ctx.staffActivity).activityPerson(person) }),
  activityExport: t.field({
    type: JobType,
    nullable: true,
    args: { id: t.arg.id({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'activity.export', target: 'none' } },
    resolve: (_, { id }, ctx) => signedIn(ctx.staffActivity).activityExport(String(id)),
  }),
}))

builder.mutationFields((t) => ({
  exportActivity: t.field({
    type: ExportResult,
    args: { filter: t.arg({ type: Filter }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'activity.export', target: 'none', audit: staffActivityAudit.exportActivity } },
    resolve: (_, { filter }, ctx) => signedIn(ctx.staffActivity).exportActivity(compact(filter)),
  }),
}))
