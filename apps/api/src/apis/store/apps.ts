import { GraphQLError } from 'graphql'
import { pageOf, type Page } from '#core/paging'
import type { AppRow, GrantRow } from '#db/scoped/apps'
import { appAudit, createStoreAppsService, type AppRefusal, type AppResult } from '#saas/apps/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'
import { storePage } from './refusals'

// Settings › Apps (FIRST-RELEASE §15, SetDev mode=apps): private apps, the Owner's (`settings`), opened on their own site.

const words: Record<AppRefusal, string> = {
  INVALID_INPUT: 'Something here isn’t valid.',
  INVALID_SCOPES: 'Those aren’t things an app can be given.',
  BAD_URL: 'Use an address that starts with https://.',
  PRIVATE_ADDRESS: 'That address points inside a private network.',
  UNAVAILABLE: 'Apps can’t be installed just now. Try again later.',
  NOT_FOUND: 'That app isn’t available.',
  SCOPES_CHANGED: 'This app now asks for different access. Look again before installing.',
  ALREADY_INSTALLED: 'This app is already installed.',
}

const answered = <T>(result: AppResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
}

export const registerApps = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)
  const Installable = builder.objectRef<AppRow>('InstallableApp').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      developer: t.exposeString('developer'),
      siteUrl: t.exposeString('site_url'),
      // What the consent screen says it may do; `installApp` takes them back as the Owner saw them.
      scopes: t.exposeStringList('scopes'),
    }),
  })
  const Installed = builder.objectRef<GrantRow>('InstalledApp').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      appId: t.exposeID('app_id'),
      name: t.exposeString('app_name'),
      developer: t.exposeString('developer'),
      // "Open app" goes here; nothing of the app runs in the portal (decided on #337).
      siteUrl: t.exposeString('site_url'),
      scopes: t.exposeStringList('scopes'),
      // True while DripFunnel has the app suspended: its access is paused.
      suspended: t.boolean({ resolve: (g) => g.app_status !== 'live' }),
      installedByName: t.exposeString('installed_by_name', { nullable: true }),
      installedAt: t.string({ resolve: (g) => g.installed_at.toISOString() }),
      lastUsedAt: t.string({ nullable: true, resolve: (g) => g.last_used_at?.toISOString() ?? null }),
      // waiting | sent | failed: whether the app was told its token. Failed, the Owner removes it and installs again.
      connection: t.string({ resolve: (g) => (g.token_sent_at ? 'sent' : g.token_failed_at ? 'failed' : 'waiting') }),
    }),
  })
  const InstalledPage = builder.objectRef<Page<GrantRow>>('InstalledAppPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Installed], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })

  const access = { api: 'store', scope: 'store', permission: 'settings', target: 'none' } as const
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    return createStoreAppsService({ sql: ctx.sql, caller: actingCaller(ctx), activity: ctx.activity, facts: ctx.facts, secrets: ctx.secrets ?? null, now: ctx.now })
  }

  builder.queryFields((t) => ({
    installableApp: t.field({ type: Installable, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: { access }, resolve: (_, args, ctx) => service(ctx).installable(String(args.id)) }),
    apps: t.field({
      type: InstalledPage,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access },
      resolve: async (_, args, ctx) => {
        const window = storePage(args)
        return pageOf(await service(ctx).list(window), window, (g) => ({ occurredAt: g.installed_at, id: g.id }))
      },
    }),
  }))

  builder.mutationFields((t) => ({
    installApp: t.field({
      type: 'ID',
      args: { appId: t.arg.id({ required: true }), scopes: t.arg.stringList({ required: true }) },
      extensions: { access: { ...access, audit: appAudit.installed, blockedFor: ['support'] } },
      resolve: async (_, args, ctx) => answered(await service(ctx).install(String(args.appId), args.scopes)),
    }),
    uninstallApp: t.field({
      type: 'Boolean',
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...access, audit: appAudit.uninstalled } },
      resolve: async (_, args, ctx) => answered(await service(ctx).uninstall(String(args.id))),
    }),
  }))
}
