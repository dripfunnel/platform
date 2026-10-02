import { GraphQLError } from 'graphql'
import {
  storeAudit,
  type JobPermissions,
  type Result,
  type StoreDnsRecord,
  type StoreDto,
  type StorePage,
  type StorePermissions,
  type StoreRowDto,
  type StoreState,
  type StoreUserDto,
} from '#saas/stores/index'
import { builder } from './builder'
import { compact, HistoryEntryType, iso, PageInfoType, permission, PermissionType, signedIn, type Permission } from './types'

// Stores on the Admin API (ui/admin/FIRST-RELEASE.md §5, §12; card #34). Thin: who may do
// what, and what the store's state means, arrives from saas/stores as data. No catalogue,
// order or customer field lives here (§5.2): staff reach those only by impersonating.

const Ref = builder.objectRef<{ id: string; name: string }>('Ref').implement({
  fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }),
})

const StoreOwner = builder.objectRef<StoreRowDto['owner']>('StoreOwner').implement({
  fields: (t) => ({ name: t.exposeString('name', { nullable: true }), email: t.exposeString('email', { nullable: true }) }),
})

const StorePlan = builder.objectRef<StoreRowDto['plan']>('StorePlan').implement({
  fields: (t) => ({ name: t.exposeString('name', { nullable: true }) }),
})

// One object with the facts of every status rather than a union: the client switches on `kind`.
const StoreStateType = builder.objectRef<StoreState>('StoreState').implement({
  fields: (t) => ({
    kind: t.exposeString('kind'),
    trialEndsAt: t.string({ nullable: true, resolve: (s) => (s.kind === 'trial' ? s.trialEndsAt.toISOString() : null) }),
    daysLeft: t.int({ nullable: true, resolve: (s) => (s.kind === 'trial' ? s.daysLeft : null) }),
    daysPastDue: t.int({ nullable: true, resolve: (s) => (s.kind === 'past_due' ? s.daysPastDue : null) }),
    reason: t.string({ nullable: true, resolve: (s) => (s.kind === 'suspended' ? s.reason : null) }),
    by: t.string({ nullable: true, resolve: (s) => (s.kind === 'suspended' ? s.by : null) }),
    previous: t.string({ nullable: true, resolve: (s) => (s.kind === 'suspended' ? s.previous : null) }),
    since: t.string({ nullable: true, resolve: (s) => (s.kind === 'suspended' || s.kind === 'cancelled' || s.kind === 'closed' ? s.since.toISOString() : null) }),
  }),
})

const StoreDomain = builder.objectRef<StoreRowDto['domain']>('StoreDomain').implement({
  fields: (t) => ({ host: t.exposeString('host'), custom: t.exposeBoolean('custom'), status: t.exposeString('status') }),
})

const StoreSetup = builder.objectRef<StoreRowDto['setup']>('StoreSetup').implement({
  fields: (t) => ({
    state: t.exposeString('state'),
    step: t.exposeString('step', { nullable: true }),
    steps: t.stringList({ resolve: (s) => s.steps }),
    attempts: t.exposeInt('attempts'),
  }),
})

const StoreRowType = builder.objectRef<StoreRowDto>('StoreRow').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    code: t.exposeString('code'),
    partner: t.field({ type: Ref, resolve: (s) => s.partner }),
    owner: t.field({ type: StoreOwner, resolve: (s) => s.owner }),
    plan: t.field({ type: StorePlan, resolve: (s) => s.plan }),
    state: t.field({ type: StoreStateType, resolve: (s) => s.state }),
    storefront: t.exposeString('storefront'),
    domain: t.field({ type: StoreDomain, resolve: (s) => s.domain }),
    setup: t.field({ type: StoreSetup, resolve: (s) => s.setup }),
    createdAt: t.string({ resolve: (s) => s.createdAt.toISOString() }),
  }),
})

const Counts = builder.objectRef<StoreDto['counts']>('StorePeopleCounts').implement({
  fields: (t) => ({ owners: t.exposeInt('owners'), managers: t.exposeInt('managers'), staff: t.exposeInt('staff'), suppliers: t.exposeInt('suppliers') }),
})

const Site = builder.objectRef<StoreDto['site']>('StoreSite').implement({
  fields: (t) => ({
    version: t.exposeString('version', { nullable: true }),
    lastBuildAt: t.string({ nullable: true, resolve: (s) => iso(s.lastBuildAt) }),
    lastPublishAt: t.string({ nullable: true, resolve: (s) => iso(s.lastPublishAt) }),
    previewHost: t.exposeString('previewHost', { nullable: true }),
    liveHost: t.exposeString('liveHost'),
  }),
})

const Provisioning = builder.objectRef<StoreDto['provisioning']>('StoreProvisioning').implement({
  fields: (t) => ({
    error: t.exposeString('error', { nullable: true }),
    // FIRST-RELEASE §7: the raw detail is for whoever may open Provisioning; others read null (#14).
    details: t.string({
      nullable: true,
      extensions: { access: { api: 'admin', scope: 'platform', permission: 'provisioning.read', target: 'none' } },
      resolve: (p) => p.details,
    }),
  }),
})

const DnsRecord = builder.objectRef<StoreDnsRecord>('StoreDnsRecord').implement({
  fields: (t) => ({
    kind: t.exposeString('kind'),
    host: t.exposeString('host'),
    record: t.exposeString('record', { nullable: true }),
    expected: t.exposeString('expected', { nullable: true }),
    found: t.exposeString('found', { nullable: true }),
    status: t.exposeString('status'),
  }),
})

const StoreUser = builder.objectRef<StoreUserDto>('StoreUser').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    email: t.exposeString('email'),
    role: t.exposeString('role'),
    supplier: t.exposeString('supplier', { nullable: true }),
    status: t.exposeString('status'),
    lastSignInAt: t.string({ nullable: true, resolve: (u) => iso(u.lastSignInAt) }),
    impersonate: t.field({ type: PermissionType, resolve: (u) => permission(u.impersonate) }),
  }),
})

const Note = builder.objectRef<StoreDto['notes'][number]>('StoreNote').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    by: t.exposeString('by'),
    at: t.string({ resolve: (n) => n.at.toISOString() }),
    text: t.exposeString('text'),
  }),
})

const permissionOf = (p: { allowed: true; emergency?: true } | { allowed: false; reason: string } | undefined): Permission | null =>
  p ? (p.allowed ? { allowed: true, reason: p.emergency ? 'EMERGENCY' : null, failingChecks: null } : permission(p)) : null

const JobActions = builder.objectRef<JobPermissions>('JobActions').implement({
  fields: (t) => ({
    retry: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf(a.retry) }),
    undo: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf(a.undo) }),
  }),
})

const Job = builder.objectRef<NonNullable<StoreDto['job']>>('StoreJob').implement({
  fields: (t) => ({ id: t.exposeID('id'), actions: t.field({ type: JobActions, resolve: (j) => j.actions }) }),
})

// An action absent is not offered in this state; present and refused is disabled with its
// reason. `reason: EMERGENCY` on an allowed suspend marks the Engineer on call's case (§5.3).
const StoreActions = builder.objectRef<StorePermissions>('StoreActions').implement({
  fields: (t) => ({
    suspend: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf(a.suspend) }),
    restore: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf(a.restore) }),
    extendTrial: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf(a.extendTrial) }),
    resendInvite: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf(a.resendInvite) }),
    addNote: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf(a.addNote) }),
  }),
})

const StoreType = builder.objectRef<StoreDto>('Store').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    code: t.exposeString('code'),
    partner: t.field({ type: Ref, resolve: (s) => s.partner }),
    owner: t.field({ type: StoreOwner, resolve: (s) => s.owner }),
    plan: t.field({ type: StorePlan, resolve: (s) => s.plan }),
    state: t.field({ type: StoreStateType, resolve: (s) => s.state }),
    storefront: t.exposeString('storefront'),
    domain: t.field({ type: StoreDomain, resolve: (s) => s.domain }),
    setup: t.field({ type: StoreSetup, resolve: (s) => s.setup }),
    createdAt: t.string({ resolve: (s) => s.createdAt.toISOString() }),
    country: t.exposeString('country', { nullable: true }),
    history: t.field({ type: [HistoryEntryType], resolve: (s) => s.history }),
    counts: t.field({ type: Counts, resolve: (s) => s.counts }),
    site: t.field({ type: Site, resolve: (s) => s.site }),
    provisioning: t.field({ type: Provisioning, resolve: (s) => s.provisioning }),
    records: t.field({ type: [DnsRecord], resolve: (s) => s.records }),
    users: t.field({ type: [StoreUser], resolve: (s) => s.users }),
    supportAccess: t.exposeBoolean('supportAccess'),
    notes: t.field({ type: [Note], resolve: (s) => s.notes }),
    job: t.field({ type: Job, nullable: true, resolve: (s) => s.job }),
    actions: t.field({ type: StoreActions, resolve: (s) => s.actions }),
  }),
})

const Page = builder.objectRef<StorePage>('StorePage').implement({
  fields: (t) => ({
    items: t.field({ type: [StoreRowType], resolve: (p) => p.items }),
    pageInfo: t.field({ type: PageInfoType, resolve: (p) => p.pageInfo }),
    partners: t.field({ type: [Ref], resolve: (p) => p.partners }),
  }),
})

const Filter = builder.inputType('StoreFilter', {
  fields: (t) => ({ partner: t.id(), status: t.string(), storefront: t.string(), setup: t.string(), created: t.string(), q: t.string() }),
})

interface Outcome {
  ok: boolean
  code: string | null
  status: string | null
  emergency: boolean | null
  trialEndsAt: string | null
  noteId: string | null
}

const OutcomeType = builder.objectRef<Outcome>('StoreMutationOutcome').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    code: t.exposeString('code', { nullable: true }),
    status: t.exposeString('status', { nullable: true }),
    emergency: t.exposeBoolean('emergency', { nullable: true }),
    trialEndsAt: t.exposeString('trialEndsAt', { nullable: true }),
    noteId: t.exposeID('noteId', { nullable: true }),
  }),
})

const outcome = (result: Result<Record<string, unknown>>): Outcome => ({
  ok: result.ok,
  code: result.ok ? null : result.code,
  status: result.ok && typeof result['status'] === 'string' ? result['status'] : null,
  emergency: result.ok && typeof result['emergency'] === 'boolean' ? result['emergency'] : null,
  trialEndsAt: result.ok && result['trialEndsAt'] instanceof Date ? result['trialEndsAt'].toISOString() : null,
  noteId: result.ok && typeof result['noteId'] === 'string' ? result['noteId'] : null,
})

const byId = ({ id }: { id: string }) => ({ storeId: id })

builder.queryFields((t) => ({
  stores: t.field({
    type: Page,
    args: { filter: t.arg({ type: Filter }), after: t.arg.string(), before: t.arg.string(), first: t.arg.int() },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'stores.read', target: 'none' } },
    resolve: async (_, args, ctx) => {
      const result = await signedIn(ctx.stores).list(compact(args.filter), { after: args.after, before: args.before, first: args.first })
      if (!result.ok) throw new GraphQLError('Bad request.', { extensions: { code: result.code } })
      return result.page
    },
  }),
  store: t.field({
    type: StoreType,
    nullable: true,
    args: { id: t.arg.id({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'stores.read', target: byId } },
    resolve: (_, args, ctx) => signedIn(ctx.stores).get(String(args.id)),
  }),
}))

builder.mutationFields((t) => ({
  suspendStore: t.field({
    type: OutcomeType,
    args: { id: t.arg.id({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'stores.suspend', target: byId, audit: storeAudit.suspendStore } },
    resolve: async (_, args, ctx) => outcome(await signedIn(ctx.stores).suspendStore(String(args.id), args.reason)),
  }),
  restoreStore: t.field({
    type: OutcomeType,
    args: { id: t.arg.id({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'stores.restore', target: byId, audit: storeAudit.restoreStore } },
    resolve: async (_, args, ctx) => outcome(await signedIn(ctx.stores).restoreStore(String(args.id), args.reason)),
  }),
  extendTrial: t.field({
    type: OutcomeType,
    args: { id: t.arg.id({ required: true }), trialEndsAt: t.arg.string({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'stores.trial.extend', target: byId, audit: storeAudit.extendTrial } },
    resolve: async (_, args, ctx) => outcome(await signedIn(ctx.stores).extendTrial(String(args.id), args.trialEndsAt)),
  }),
  resendStoreOwnerInvite: t.field({
    type: OutcomeType,
    args: { id: t.arg.id({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'stores.invite.resend', target: byId, audit: storeAudit.resendStoreOwnerInvite } },
    resolve: async (_, args, ctx) => outcome(await signedIn(ctx.stores).resendStoreOwnerInvite(String(args.id))),
  }),
  addStoreNote: t.field({
    type: OutcomeType,
    args: { id: t.arg.id({ required: true }), text: t.arg.string({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'stores.notes.write', target: byId, audit: storeAudit.addStoreNote } },
    resolve: async (_, args, ctx) => outcome(await signedIn(ctx.stores).addStoreNote(String(args.id), args.text)),
  }),
  recheckStoreDomain: t.field({
    type: OutcomeType,
    args: { id: t.arg.id({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'domains.recheck', target: byId, audit: storeAudit.recheckStoreDomain } },
    resolve: async (_, args, ctx) => outcome(await signedIn(ctx.stores).recheckStoreDomain(String(args.id))),
  }),
}))
