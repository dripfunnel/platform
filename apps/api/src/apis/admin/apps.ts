import { GraphQLError } from 'graphql'
import { pageWindow, pageWith } from '#core/paging'
import { encodeCursor } from '#core/cursor'
import type { AppAdminRow } from '#db/scoped/apps'
import { appAudit, type AppRefusal, type AppResult } from '#saas/apps/index'
import { builder } from './builder'
import { PageInfoType, signedIn } from './types'

// The private-app registry on the Admin API (PLATFORM-PROMPT §5.5, DATA-MODEL §7.10): Super admin only (`apps.manage`).
// An app's signing secret is in the answer to its registration and nowhere else.

const pageSize = 25

const answered = <T>(result: AppResult<T>): T => {
  if (result.ok) return result.value
  const code: AppRefusal = result.reason
  throw new GraphQLError('That app can’t be saved.', { extensions: { code } })
}

const App = builder.objectRef<AppAdminRow>('RegisteredApp').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    developer: t.exposeString('developer'),
    siteUrl: t.exposeString('site_url'),
    webhookUrl: t.exposeString('webhook_url'),
    scopes: t.exposeStringList('scopes'),
    status: t.exposeString('status'),
    createdAt: t.string({ resolve: (a) => a.created_at.toISOString() }),
  }),
})
const AppPage = builder.objectRef<{ items: AppAdminRow[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('RegisteredAppPage').implement({
  fields: (t) => ({ items: t.field({ type: [App], resolve: (p) => p.items }), pageInfo: t.field({ type: PageInfoType, resolve: (p) => p.pageInfo }) }),
})
const Registered = builder.objectRef<{ id: string; secret: string }>('RegisteredAppSecret').implement({
  fields: (t) => ({ id: t.exposeID('id'), secret: t.exposeString('secret') }),
})

const manage = (audit?: string) => ({ access: { api: 'admin' as const, scope: 'platform' as const, permission: 'apps.manage' as const, target: 'none' as const, ...(audit ? { audit } : {}) } })

builder.queryFields((t) => ({
  registeredApps: t.field({
    type: AppPage,
    args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
    extensions: manage(),
    resolve: async (_, args, ctx) => {
      const window = pageWindow(args, pageSize)
      if (!window.ok) throw new GraphQLError('That page link does not work.', { extensions: { code: 'INVALID_INPUT' } })
      const page = pageWith(await signedIn(ctx.apps ?? null).list(window.window), window.window, (a) => encodeCursor({ occurredAt: a.created_at, id: a.id }))
      return { items: page.nodes, pageInfo: page.pageInfo }
    },
  }),
}))

builder.mutationFields((t) => ({
  registerApp: t.field({
    type: Registered,
    args: { name: t.arg.string({ required: true }), developer: t.arg.string({ required: true }), siteUrl: t.arg.string({ required: true }), webhookUrl: t.arg.string({ required: true }), scopes: t.arg.stringList({ required: true }) },
    extensions: manage(appAudit.registered),
    resolve: async (_, args, ctx) => answered(await signedIn(ctx.apps ?? null).register(args)),
  }),
  setAppStatus: t.field({
    type: 'Boolean',
    args: { id: t.arg.id({ required: true }), suspended: t.arg.boolean({ required: true }) },
    extensions: manage(appAudit.statusChanged),
    resolve: async (_, args, ctx) => answered(await signedIn(ctx.apps ?? null).setStatus(String(args.id), args.suspended ? 'suspended' : 'live')),
  }),
}))
