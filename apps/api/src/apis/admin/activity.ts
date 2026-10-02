import { GraphQLError } from 'graphql'
import type { RecordedChange } from '#core/redaction'
import type { ActivityRow } from '#db/schema/activity'
import type { ActivityPage } from '#saas/activity/index'
import { builder } from './builder'
import { PageInfoType } from './types'

// The activity log as the admin console reads it (LOGGING.md §6: staff see every entry, IP
// and user agent included). #38 adds the person timeline, the people search and the export.

const Change = builder.objectRef<RecordedChange>('ActivityChange').implement({
  fields: (t) => ({
    field: t.exposeString('field'),
    before: t.exposeString('before', { nullable: true }),
    after: t.exposeString('after', { nullable: true }),
    redacted: t.exposeBoolean('redacted'),
  }),
})

const Agent = builder.objectRef<{ kind: string; id: string; label: string | null }>('ActivityAgent').implement({
  fields: (t) => ({
    kind: t.exposeString('kind'),
    id: t.exposeID('id'),
    label: t.exposeString('label', { nullable: true }),
  }),
})

const Access = builder.objectRef<{ kind: string; id: string }>('ActivityAccess').implement({
  fields: (t) => ({ kind: t.exposeString('kind'), id: t.exposeID('id') }),
})

const Target = builder.objectRef<{ type: string; id: string; label: string | null }>('ActivityTarget').implement({
  fields: (t) => ({
    type: t.exposeString('type'),
    id: t.exposeID('id'),
    label: t.exposeString('label', { nullable: true }),
  }),
})

const Entry = builder.objectRef<ActivityRow>('ActivityEntry').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    occurredAt: t.string({ resolve: (row) => row.occurred_at.toISOString() }),
    category: t.exposeString('category'),
    action: t.exposeString('action'),
    result: t.exposeString('result'),
    actorKind: t.exposeString('actor_kind'),
    actorId: t.exposeString('actor_id', { nullable: true }),
    actorLabel: t.exposeString('actor_label', { nullable: true }),
    onBehalfOf: t.field({
      type: Agent,
      nullable: true,
      resolve: (row) =>
        row.on_behalf_of_kind && row.on_behalf_of_id
          ? { kind: row.on_behalf_of_kind, id: row.on_behalf_of_id, label: row.on_behalf_of_label }
          : null,
    }),
    access: t.field({
      type: Access,
      nullable: true,
      resolve: (row) => (row.access_kind && row.access_ref ? { kind: row.access_kind, id: row.access_ref } : null),
    }),
    partnerId: t.exposeID('partner_id', { nullable: true }),
    storeId: t.exposeID('store_id', { nullable: true }),
    sellerId: t.exposeID('seller_id', { nullable: true }),
    customerId: t.exposeID('customer_id', { nullable: true }),
    target: t.field({
      type: Target,
      nullable: true,
      resolve: (row) => (row.target_type && row.target_id ? { type: row.target_type, id: row.target_id, label: row.target_label } : null),
    }),
    changes: t.field({ type: [Change], resolve: (row) => row.changes }),
    reason: t.exposeString('reason', { nullable: true }),
    api: t.exposeString('api', { nullable: true }),
    host: t.exposeString('host', { nullable: true }),
    requestId: t.exposeString('request_id', { nullable: true }),
    ip: t.exposeString('ip', { nullable: true }),
    userAgent: t.exposeString('user_agent', { nullable: true }),
    visibility: t.exposeString('visibility'),
  }),
})

const Page = builder.objectRef<ActivityPage>('ActivityPage').implement({
  fields: (t) => ({
    items: t.field({ type: [Entry], resolve: (page) => page.items }),
    pageInfo: t.field({ type: PageInfoType, resolve: (page) => page.pageInfo }),
  }),
})

const Filter = builder.inputType('ActivityFilter', {
  fields: (t) => ({
    actorKind: t.string(),
    actorId: t.string(),
    targetType: t.string(),
    targetId: t.string(),
    partnerId: t.id(),
    storeId: t.id(),
    action: t.string(),
    from: t.string(),
    to: t.string(),
  }),
})

// Dropped undefined, so the zod schema's `.strict()` sees only what the client sent.
const compact = (input: Record<string, unknown> | null | undefined) =>
  Object.fromEntries(Object.entries(input ?? {}).filter(([, value]) => value !== undefined && value !== null))

builder.queryFields((t) => ({
  activityLog: t.field({
    type: Page,
    args: {
      filter: t.arg({ type: Filter }),
      after: t.arg.string(),
      before: t.arg.string(),
      first: t.arg.int(),
    },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'activity.read', target: 'none' } },
    resolve: async (_, args, ctx) => {
      const result = await ctx.activity(compact(args.filter), { after: args.after, before: args.before, first: args.first })
      if (!result.ok) throw new GraphQLError('Bad request.', { extensions: { code: result.code } })
      return result.page
    },
  }),
}))
