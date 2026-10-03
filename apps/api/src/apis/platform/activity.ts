import { GraphQLError } from 'graphql'
import { activityAudit, type PartnerActivityEntry, type PartnerActivityPage, type PartnerActivityService } from '#saas/partnerActivity/index'
import { unauthenticated } from '../graphql/scope'
import { builder } from './builder'

// The partner Activity log (ui/platform/FIRST-RELEASE.md §13; card #198). Thin:
// saas/partnerActivity reads within the log's own policy; the console words each entry.

const service = (activity: PartnerActivityService | null): PartnerActivityService => {
  if (!activity) throw unauthenticated()
  return activity
}

const invalid = () => new GraphQLError('That filter, person or page link does not work.', { extensions: { code: 'INVALID_INPUT' } })

type Change = PartnerActivityEntry['changes'][number]
type Target = NonNullable<PartnerActivityEntry['target']>
type Person = NonNullable<Awaited<ReturnType<PartnerActivityService['activityPeople']>>>[number]
type Job = NonNullable<Awaited<ReturnType<PartnerActivityService['exportJob']>>>

const ChangeType = builder.objectRef<Change>('ActivityChange').implement({
  fields: (t) => ({
    field: t.exposeString('field'),
    before: t.string({ nullable: true, resolve: (c) => (c.before === null || c.before === undefined ? null : String(c.before)) }),
    after: t.string({ nullable: true, resolve: (c) => (c.after === null || c.after === undefined ? null : String(c.after)) }),
  }),
})

const Actor = builder.objectRef<PartnerActivityEntry['actor']>('ActivityActor').implement({
  fields: (t) => ({ kind: t.exposeString('kind'), id: t.exposeString('id', { nullable: true }), label: t.exposeString('label') }),
})

const TargetType = builder.objectRef<Target>('ActivityTarget').implement({
  fields: (t) => ({ type: t.exposeString('type'), id: t.exposeString('id', { nullable: true }), label: t.exposeString('label', { nullable: true }) }),
})

const Entry = builder.objectRef<PartnerActivityEntry>('PartnerActivityEntry').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    at: t.string({ resolve: (e) => e.at.toISOString() }),
    category: t.exposeString('category'),
    action: t.exposeString('action'),
    result: t.exposeString('result'),
    actor: t.field({ type: Actor, resolve: (e) => e.actor }),
    onBehalfOf: t.exposeString('onBehalfOf', { nullable: true }),
    through: t.exposeString('through', { nullable: true }),
    storeId: t.exposeString('storeId', { nullable: true }),
    target: t.field({ type: TargetType, nullable: true, resolve: (e) => e.target }),
    changes: t.field({ type: [ChangeType], resolve: (e) => e.changes }),
    reason: t.exposeString('reason', { nullable: true }),
  }),
})

const PageInfoType = builder.objectRef<PartnerActivityPage['pageInfo']>('PartnerActivityPageInfo').implement({
  fields: (t) => ({
    hasNextPage: t.exposeBoolean('hasNextPage'),
    hasPreviousPage: t.exposeBoolean('hasPreviousPage'),
    startCursor: t.exposeString('startCursor', { nullable: true }),
    endCursor: t.exposeString('endCursor', { nullable: true }),
  }),
})

const Page = builder.objectRef<PartnerActivityPage>('PartnerActivityPage').implement({
  fields: (t) => ({ items: t.field({ type: [Entry], resolve: (p) => p.items }), pageInfo: t.field({ type: PageInfoType, resolve: (p) => p.pageInfo }) }),
})

const PersonType = builder.objectRef<Person>('ActivityPerson').implement({
  fields: (t) => ({ ref: t.exposeString('ref'), kind: t.exposeString('kind'), name: t.exposeString('name'), detail: t.exposeString('detail') }),
})

const JobType = builder.objectRef<Job>('ActivityExportJob').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    state: t.exposeString('state'),
    rows: t.exposeInt('rows', { nullable: true }),
    truncated: t.exposeBoolean('truncated'),
    csv: t.exposeString('csv', { nullable: true }),
    expiresAt: t.string({ nullable: true, resolve: (j) => j.expiresAt?.toISOString() ?? null }),
  }),
})

const ExportResult = builder.objectRef<{ ok: boolean; jobId?: string; reason?: string }>('ActivityExportResult').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    jobId: t.string({ nullable: true, resolve: (r) => r.jobId ?? null }),
    reason: t.string({ nullable: true, resolve: (r) => r.reason ?? null }),
  }),
})

const FilterInput = builder.inputType('PartnerActivityFilterInput', {
  fields: (t) => ({ who: t.string(), action: t.string(), result: t.string(), storeId: t.id(), date: t.string() }),
})

// GraphQL gives an absent optional field as null; the filter schema expects it absent.
const present = (o: Record<string, unknown> | null | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== null && v !== undefined))
const read = { api: 'platform', scope: 'partner', permission: 'partner.read', target: 'none' } as const

builder.queryFields((t) => ({
  activityLog: t.field({
    type: Page,
    args: { filter: t.arg({ type: FilterInput }), after: t.arg.string(), before: t.arg.string(), first: t.arg.int() },
    extensions: { access: read },
    resolve: async (_, { filter, after, before, first }, ctx) => (await service(ctx.activity).activityLog(present(filter), { after, before, first })) ?? Promise.reject(invalid()),
  }),
  personTimeline: t.field({
    type: Page,
    args: { person: t.arg.string({ required: true }), filter: t.arg({ type: FilterInput }), after: t.arg.string(), before: t.arg.string(), first: t.arg.int() },
    extensions: { access: read },
    resolve: async (_, { person, filter, after, before, first }, ctx) => (await service(ctx.activity).personTimeline(person, present(filter), { after, before, first })) ?? Promise.reject(invalid()),
  }),
  activityPeople: t.field({
    type: [PersonType],
    args: { query: t.arg.string({ required: true }) },
    extensions: { access: read },
    resolve: async (_, { query }, ctx) => (await service(ctx.activity).activityPeople(query)) ?? Promise.reject(invalid()),
  }),
  activityExport: t.field({
    type: JobType,
    nullable: true,
    args: { id: t.arg.id({ required: true }) },
    extensions: { access: read },
    resolve: (_, { id }, ctx) => service(ctx.activity).exportJob(String(id)),
  }),
}))

builder.mutationFields((t) => ({
  exportActivity: t.field({
    type: ExportResult,
    args: { filter: t.arg({ type: FilterInput }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'activity.export', target: 'none', audit: activityAudit.exportActivity } },
    resolve: (_, { filter }, ctx) => service(ctx.activity).exportActivity(present(filter)),
  }),
}))
