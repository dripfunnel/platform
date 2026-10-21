import { GraphQLError } from 'graphql'
import { machineScopes } from '#auth/apiKeys'
import { defaultApiLimits } from '#auth/machineCaller'
import { pageOf } from '#core/paging'
import type { ApiKeyRow } from '#db/scoped/apiKeys'
import { apiKeyAudit, apiKeyLifetimes, createApiKeysService, maxApiKeys, type ApiKeyRefusal, type ApiKeyResult } from '#saas/apiKeys/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'
import { storePage } from './refusals'

// Settings › Developers (FIRST-RELEASE §15, SetDev): the store's API keys, the Owner's (`settings`). The rules are
// saas/apiKeys's; this file authorises, calls and words the refusals.

const words: Record<ApiKeyRefusal, string> = {
  INVALID_INPUT: 'Give it a name you’ll recognise later, and choose when it expires.',
  INVALID_SCOPES: 'Tick at least one thing it can do, within what that supplier may do.',
  NOT_FOUND: 'That key or supplier is no longer here.',
  TOO_MANY_KEYS: `A store can have up to ${maxApiKeys} keys. Revoke one first.`,
}

const answered = <T>(result: ApiKeyResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
}

export const registerDevelopers = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)

  const Supplier = builder.objectRef<{ id: string; name: string }>('ApiKeySupplier').implement({
    fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }),
  })
  const ApiKey = builder.objectRef<ApiKeyRow>('ApiKey').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      // Enough to tell keys apart; the secret itself is never read back (ACCESS.md §5.6).
      prefix: t.exposeString('prefix'),
      scopes: t.exposeStringList('scopes'),
      // Null works for the whole store.
      supplier: t.field({ type: Supplier, nullable: true, resolve: (k) => (k.seller_id ? { id: k.seller_id, name: k.seller_name ?? '' } : null) }),
      createdByName: t.exposeString('created_by_name', { nullable: true }),
      // False once its creator left or stopped being an Owner: it keeps working (decided on #337).
      createdByHere: t.exposeBoolean('created_by_here'),
      createdAt: t.string({ resolve: (k) => k.created_at.toISOString() }),
      expiresAt: t.string({ nullable: true, resolve: (k) => k.expires_at?.toISOString() ?? null }),
      lastUsedAt: t.string({ nullable: true, resolve: (k) => k.last_used_at?.toISOString() ?? null }),
      // The secret it was rotated from works until then (ACCESS.md §5.6's day).
      previousWorksUntil: t.string({ nullable: true, resolve: (k) => k.previous_until?.toISOString() ?? null }),
    }),
  })
  const ApiKeyPage = builder.objectRef<{ nodes: ApiKeyRow[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('ApiKeyPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [ApiKey], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const Issued = builder.objectRef<{ id: string; secret: string; prefix: string }>('IssuedApiKey').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      prefix: t.exposeString('prefix'),
      // Here once, and in no other answer.
      secret: t.exposeString('secret'),
    }),
  })
  const Choices = builder.objectRef<Record<string, never>>('ApiKeyChoices').implement({
    fields: (t) => ({
      scopes: t.stringList({ resolve: () => [...machineScopes] }),
      expiresInDays: t.intList({ resolve: () => [...apiKeyLifetimes] }),
      maxKeys: t.int({ resolve: () => maxApiKeys }),
      requestsPerMinute: t.int({ resolve: () => defaultApiLimits.minute }),
      requestsPerMonth: t.int({ resolve: () => defaultApiLimits.month }),
    }),
  })

  const access = { api: 'store', scope: 'store', permission: 'settings', target: 'none' } as const
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    return createApiKeysService({ sql: ctx.sql, caller: actingCaller(ctx), activity: ctx.activity, facts: ctx.facts, now: ctx.now })
  }

  builder.queryFields((t) => ({
    apiKeys: t.field({
      type: ApiKeyPage,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access },
      resolve: async (_, args, ctx) => {
        const window = storePage(args)
        const rows = await service(ctx).list(window)
        return pageOf(rows, window, (r) => ({ occurredAt: r.created_at, id: r.id }))
      },
    }),
    apiKeyChoices: t.field({ type: Choices, extensions: { access }, resolve: () => ({}) }),
  }))

  builder.mutationFields((t) => ({
    createApiKey: t.field({
      type: Issued,
      args: { name: t.arg.string({ required: true }), scopes: t.arg.stringList({ required: true }), supplierId: t.arg.id(), expiresInDays: t.arg.int() },
      extensions: { access: { ...access, audit: apiKeyAudit.created, blockedFor: ['support'] } },
      resolve: async (_, args, ctx) =>
        answered(await service(ctx).create({ name: args.name, scopes: args.scopes, supplierId: args.supplierId ? String(args.supplierId) : null, expiresInDays: args.expiresInDays ?? null })),
    }),
    rotateApiKey: t.field({
      type: Issued,
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...access, audit: apiKeyAudit.rotated, blockedFor: ['support'] } },
      resolve: async (_, args, ctx) => answered(await service(ctx).rotate(String(args.id))),
    }),
    revokeApiKey: t.field({
      type: 'Boolean',
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...access, audit: apiKeyAudit.revoked } },
      resolve: async (_, args, ctx) => answered(await service(ctx).revoke(String(args.id))),
    }),
  }))
}
