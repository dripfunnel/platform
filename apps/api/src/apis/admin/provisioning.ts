import { GraphQLError } from 'graphql'
import { jobAudit, type ProvisioningJobDto, type ProvisioningService } from '#saas/provisioning/index'
import { builder } from './builder'
import { iso, PageInfoType, PermissionType, signedIn } from './types'

// Provisioning on the Admin API (ui/admin/FIRST-RELEASE.md §7, §12; card #37). Retry and Undo
// answer NO_EXECUTOR until the signup Workflow exists (the Store strand's merchant-signup card).

type Page = NonNullable<Awaited<ReturnType<ProvisioningService['provisioningJobs']>>>
type Progress = NonNullable<Awaited<ReturnType<ProvisioningService['provisioningJob']>>>

const Named = builder.objectRef<{ id: string; name: string }>('ProvisioningPartner').implement({
  fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }),
})

const JobStore = builder.objectRef<ProvisioningJobDto['store']>('ProvisioningStore').implement({
  fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name'), code: t.exposeString('code') }),
})

const Owner = builder.objectRef<ProvisioningJobDto['owner']>('ProvisioningOwner').implement({
  fields: (t) => ({ name: t.exposeString('name', { nullable: true }), email: t.exposeString('email', { nullable: true }) }),
})

const permissionOf = (p: { allowed: boolean; reason?: string } | undefined) => (p ? { allowed: p.allowed, reason: p.reason ?? null, failingChecks: null } : null)

const Actions = builder.objectRef<ProvisioningJobDto['actions']>('ProvisioningJobActions').implement({
  fields: (t) => ({
    retry: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf(a.retry) }),
    undo: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf(a.undo) }),
  }),
})

const Job = builder.objectRef<ProvisioningJobDto>('ProvisioningJob').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    store: t.field({ type: JobStore, resolve: (j) => j.store }),
    partner: t.field({ type: Named, resolve: (j) => j.partner }),
    owner: t.field({ type: Owner, resolve: (j) => j.owner }),
    state: t.exposeString('state'),
    steps: t.exposeStringList('steps'),
    step: t.exposeString('step'),
    startedAt: t.string({ resolve: (j) => iso(j.startedAt) ?? '' }),
    attempts: t.exposeInt('attempts'),
    error: t.exposeString('error', { nullable: true }),
    details: t.exposeString('details', { nullable: true }),
    actions: t.field({ type: Actions, resolve: (j) => j.actions }),
  }),
})

const JobPage = builder.objectRef<Page>('ProvisioningJobPage').implement({
  fields: (t) => ({
    items: t.field({ type: [Job], resolve: (p) => p.items }),
    pageInfo: t.field({ type: PageInfoType, resolve: (p) => p.pageInfo }),
    partners: t.field({ type: [Named], resolve: (p) => p.partners }),
  }),
})

const ProgressType = builder.objectRef<Progress>('JobProgress').implement({
  fields: (t) => ({ id: t.exposeID('id'), state: t.exposeString('state'), step: t.exposeString('step') }),
})

const Result = builder.objectRef<{ ok: boolean; code: string }>('JobActionResult').implement({
  fields: (t) => ({ ok: t.exposeBoolean('ok'), code: t.exposeString('code', { nullable: true }) }),
})

const Filter = builder.inputType('ProvisioningFilter', {
  fields: (t) => ({ partner: t.id(), status: t.string(), step: t.string(), q: t.string() }),
})

const read = { api: 'admin', scope: 'platform', permission: 'provisioning.read', target: 'none' } as const
const present = (o: Record<string, unknown> | null | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== null && v !== undefined))

builder.queryFields((t) => ({
  provisioningJobs: t.field({
    type: JobPage,
    args: { filter: t.arg({ type: Filter }), after: t.arg.string(), before: t.arg.string(), first: t.arg.int() },
    extensions: { access: read },
    resolve: async (_, { filter, after, before, first }, ctx) => {
      const page = await signedIn(ctx.provisioning).provisioningJobs(present(filter), { after, before, first })
      if (!page) throw new GraphQLError('That filter or page link does not work.', { extensions: { code: 'INVALID_INPUT' } })
      return page
    },
  }),
  provisioningJob: t.field({ type: ProgressType, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: { access: read }, resolve: (_, { id }, ctx) => signedIn(ctx.provisioning).provisioningJob(String(id)) }),
}))

builder.mutationFields((t) => ({
  retryJob: t.field({
    type: Result,
    args: { id: t.arg.id({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'provisioning.retry', target: 'none', audit: jobAudit.retryJob } },
    resolve: (_, { id }, ctx) => signedIn(ctx.provisioning).retryJob(String(id)),
  }),
  undoJob: t.field({
    type: Result,
    args: { id: t.arg.id({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'provisioning.undo', target: 'none', audit: jobAudit.undoJob } },
    resolve: (_, { id, reason }, ctx) => signedIn(ctx.provisioning).undoJob(String(id), reason),
  }),
}))
