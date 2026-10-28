import { GraphQLError } from 'graphql'
import type { StoreAppAssetsRow } from '#db/scoped/storeAppAssets'
import { planLimitFor } from '#saas/entitlements/index'
import { createStoreApps, storeAppsAudit, type StoreAppsRefusal, type StoreAppsResult } from '#saas/storeApps/index'
import type { BrandFileStore } from '#saas/partnerBranding/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'

// Settings › Mobile apps (SH 15; mobile-app/README.md §3): the Owner's (`settings`). The rules are saas/storeApps'; this file
// authorises, calls and words the refusals. The images go up by `POST /api/app-assets` (apis/store/appAssets.ts), the way a brand file does.

const words: Record<Exclude<StoreAppsRefusal['reason'], 'PLAN_LIMIT'>, string> = {
  FORBIDDEN: 'Only the store’s Owner can change this.',
  INVALID_INPUT: 'Something here isn’t valid. Check the name and the descriptions.',
  UNKNOWN_FILE: 'Upload that image again.',
  UNAVAILABLE: 'Images can’t be saved just now. Try again later.',
  TOO_LARGE: 'That image is over 512 KB.',
  UNSUPPORTED_TYPE: 'Use a PNG image.',
  UNSAFE_SVG: 'Use a PNG image.',
  NOT_PNG: 'Use a PNG image.',
  WRONG_DIMENSIONS: 'That image must be exactly 1024 × 1024 pixels.',
  HAS_TRANSPARENCY: 'The app icon can’t have a transparent background.',
}

/** The service for the acting store; `files` is the assets bucket, which only an upload needs. */
export const storeAppsFor = (ctx: StoreContext, files: BrandFileStore | null) => {
  if (!ctx.sql) throw forbidden()
  const sql = ctx.sql
  const caller = actingCaller(ctx)
  return createStoreApps({
    sql,
    context: caller.context,
    actor: { id: caller.person.id, partnerId: caller.person.partnerId },
    activity: ctx.activity,
    facts: ctx.facts,
    ownApps: async () => (await planLimitFor(sql, caller.context, { key: 'own_apps' }, ctx.now())) === null,
    files,
  })
}

/** A refusal as the GraphQL error the portal words by its code. */
export const appsRefusal = async (ctx: StoreContext, result: Exclude<StoreAppsResult<unknown>, { ok: true }>): Promise<GraphQLError> => {
  if (result.reason === 'PLAN_LIMIT' && ctx.sql) {
    const limit = await planLimitFor(ctx.sql, actingCaller(ctx).context, { key: 'own_apps' }, ctx.now())
    return new GraphQLError('Your plan doesn’t include your own apps.', { extensions: { code: 'PLAN_LIMIT', key: 'own_apps', limit: limit?.limit ?? null, unlockedBy: limit?.unlockedBy ?? null } })
  }
  return new GraphQLError(result.reason === 'PLAN_LIMIT' ? 'Your plan doesn’t include your own apps.' : words[result.reason], { extensions: { code: result.reason } })
}

export const registerStoreApps = (builder: StoreBuilder) => {
  const Assets = builder.objectRef<StoreAppAssetsRow>('MobileAppAssets').implement({
    fields: (t) => ({
      version: t.exposeInt('version'),
      // R2 keys the portal reads back through `GET /api/app-assets?key=` for its previews, never a URL.
      appIcon: t.exposeString('app_icon_key', { nullable: true }),
      appIconForeground: t.exposeString('app_icon_foreground_key', { nullable: true }),
      splash: t.exposeString('splash_key', { nullable: true }),
      appName: t.exposeString('app_name', { nullable: true }),
      shortDescription: t.exposeString('short_description', { nullable: true }),
      longDescription: t.exposeString('long_description', { nullable: true }),
      savedAt: t.string({ resolve: (row) => row.created_at.toISOString() }),
    }),
  })
  const MobileApps = builder.objectRef<{ available: boolean; current: StoreAppAssetsRow | null }>('MobileApps').implement({
    fields: (t) => ({
      // False for a plan without `own_apps`, which has no tab (SAAS §6.1).
      available: t.exposeBoolean('available'),
      current: t.field({ type: Assets, nullable: true, resolve: (apps) => apps.current }),
    }),
  })
  const Input = builder.inputType('MobileAppsInput', {
    fields: (t) => ({
      appIcon: t.string(),
      appIconForeground: t.string(),
      splash: t.string(),
      appName: t.string(),
      shortDescription: t.string(),
      longDescription: t.string(),
    }),
  })

  builder.queryFields((t) => ({
    mobileApps: t.field({
      type: MobileApps,
      extensions: { access: { api: 'store', scope: 'store', permission: 'settings', target: 'none' } },
      resolve: (_, __, ctx) => storeAppsFor(ctx, null).read(),
    }),
  }))

  builder.mutationFields((t) => ({
    saveMobileApps: t.field({
      type: Assets,
      args: { input: t.arg({ type: Input, required: true }) },
      extensions: { access: { api: 'store', scope: 'store', permission: 'settings', target: 'none', audit: storeAppsAudit.saved } },
      resolve: async (_, args, ctx) => {
        const result = await storeAppsFor(ctx, null).save(args.input)
        if (result.ok) return result.value
        throw await appsRefusal(ctx, result)
      },
    }),
  }))
}
