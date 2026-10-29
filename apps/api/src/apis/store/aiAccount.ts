import { GraphQLError } from 'graphql'
import { checkAnthropicKey, type KeyCheck } from '#integrations/ai/index'
import { openaiChat } from '#integrations/ai/index'
import { aiProviders, type AiProvider } from '#db/schema/saas'
import { createStoreAiService, storeAiAudit, type StoreAiAccountRow, type StoreAiRefusal, type StoreAiResult } from '#saas/storeAiAccount/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'

// Storefront › AI (card #950): the store's own AI account and the switch. The Owner's (`settings`), as API keys are.
const words: Record<StoreAiRefusal, string> = {
  INVALID_INPUT: 'That key doesn’t look like the provider’s. Check it and try again.',
  KEY_REJECTED: 'The provider rejected that key.',
  PROVIDER_UNAVAILABLE: 'The provider didn’t answer. Nothing was saved. Try again.',
  NOT_CONFIGURED: 'Keys can’t be stored here yet: the encryption key isn’t set.',
  NOT_FOUND: 'There is no AI account to change.',
  OAUTH_UNAVAILABLE: 'Signing in with this provider isn’t available. Use an API key instead.',
  OAUTH_EXPIRED: 'That sign-in has expired or was already used. Sign in again.',
}

const checkKey = async (provider: AiProvider, key: string): Promise<KeyCheck> => (provider === 'anthropic' ? checkAnthropicKey(key) : openaiChat(key).validateCredentials())

const answered = <T extends object>(result: StoreAiResult<T>): { ok: true } & T => {
  if (result.ok) return result
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
}

export const registerAiAccount = (builder: StoreBuilder) => {
  const Account = builder.objectRef<StoreAiAccountRow>('StoreAiAccount').implement({
    fields: (t) => ({
      provider: t.exposeString('provider'),
      keyPrefix: t.exposeString('key_prefix'),
      status: t.exposeString('status'),
      lastTestedAt: t.string({ nullable: true, resolve: (a) => a.last_tested_at?.toISOString() ?? null }),
      useWhenPlanUsed: t.exposeBoolean('use_when_plan_used'),
      fallbackAuthorized: t.exposeBoolean('fallback_authorized'),
      authType: t.exposeString('auth_type'),
      accountLabel: t.string({ nullable: true, resolve: (a) => a.account_label }),
      connectedBy: t.exposeString('connected_by'),
    }),
  })
  const SignIn = builder.objectRef<{ provider: string; availability: { available: boolean; reason?: string } }>('StoreAiSignIn').implement({
    fields: (t) => ({
      provider: t.exposeString('provider'),
      available: t.boolean({ resolve: (p) => p.availability.available }),
      reason: t.string({ nullable: true, resolve: (p) => p.availability.reason ?? null }),
    }),
  })
  const Tested = builder.objectRef<{ status: string }>('StoreAiTest').implement({ fields: (t) => ({ status: t.exposeString('status') }) })
  const access = { api: 'store', scope: 'store', permission: 'settings', target: 'none' } as const
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    return createStoreAiService({ sql: ctx.sql, caller: actingCaller(ctx), facts: ctx.facts, activity: ctx.activity, secrets: ctx.secrets ?? null, checkKey: ctx.checkAiKey ?? checkKey, oauth: ctx.aiOauth ?? null, now: ctx.now })
  }
  builder.queryFields((t) => ({
    storeAiAccount: t.field({ type: Account, nullable: true, extensions: { access }, resolve: (_, __, ctx) => service(ctx).account() }),
    storeAiSignIn: t.field({ type: [SignIn], extensions: { access }, resolve: (_, __, ctx) => service(ctx).providers() }),
  }))
  builder.mutationFields((t) => ({
    connectStoreAiAccount: t.field({
      type: 'Boolean',
      args: { provider: t.arg.string({ required: true }), key: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: storeAiAudit.connected, whileReadOnly: true, blockedFor: ['support'] } },
      resolve: async (_, args, ctx) => answered(await service(ctx).connect(args)).ok,
    }),
    beginStoreAiOauth: t.string({
      args: { provider: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: storeAiAudit.oauthStarted, whileReadOnly: true, blockedFor: ['support'] } },
      resolve: async (_, { provider }, ctx) => {
        if (!aiProviders.includes(provider as AiProvider)) throw new GraphQLError(words.INVALID_INPUT, { extensions: { code: 'INVALID_INPUT' } })
        return answered(await service(ctx).beginOauth(provider as AiProvider)).url
      },
    }),
    finishStoreAiOauth: t.field({
      type: 'Boolean',
      args: { response: t.arg.string({ required: true }) },
      extensions: { access: { ...access, audit: storeAiAudit.connected, whileReadOnly: true, blockedFor: ['support'] } },
      resolve: async (_, { response }, ctx) => answered(await service(ctx).finishOauth(response)).ok,
    }),
    testStoreAiAccount: t.field({
      type: Tested,
      extensions: { access: { ...access, audit: storeAiAudit.tested, blockedFor: ['support'] } },
      resolve: async (_, __, ctx) => answered(await service(ctx).test()),
    }),
    setStoreAiSwitch: t.field({
      type: 'Boolean',
      args: { on: t.arg.boolean({ required: true }) },
      extensions: { access: { ...access, audit: storeAiAudit.switched, blockedFor: ['support'] } },
      resolve: async (_, { on }, ctx) => answered(await service(ctx).setSwitch(on)).ok,
    }),
    setStoreAiFallback: t.field({
      type: 'Boolean',
      args: { on: t.arg.boolean({ required: true }) },
      extensions: { access: { ...access, audit: storeAiAudit.fallback, blockedFor: ['support'] } },
      resolve: async (_, { on }, ctx) => answered(await service(ctx).setFallback(on)).ok,
    }),
    removeStoreAiAccount: t.field({
      type: 'Boolean',
      extensions: { access: { ...access, audit: storeAiAudit.removed, blockedFor: ['support'] } },
      resolve: async (_, __, ctx) => answered(await service(ctx).remove()).ok,
    }),
  }))
}
