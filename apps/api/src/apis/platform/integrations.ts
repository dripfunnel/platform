import { credentialAudit, type PartnerCredentialsService } from '#saas/partnerCredentials/index'
import { aiProviders, type AiProvider } from '#db/schema/saas'
import { builder } from './builder'
import { signedIn } from './fields'

// Settings › Integrations on the Platform API (ui/platform/FIRST-RELEASE.md §14.5; card #275). Thin:
// saas/partnerCredentials decides. A key goes in once and comes back as its first and last characters.
type AiKey = Awaited<ReturnType<PartnerCredentialsService['aiKeys']>>[number]
const writes = { api: 'platform', scope: 'partner', permission: 'integrations.write', target: 'none' } as const

const AiKeyType = builder.objectRef<AiKey>('PartnerAiKey').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    provider: t.exposeString('provider'),
    name: t.exposeString('name'),
    keyPrefix: t.exposeString('keyPrefix'),
    status: t.exposeString('status'),
    isDefault: t.exposeBoolean('isDefault'),
    authType: t.exposeString('authType'),
    accountLabel: t.string({ nullable: true, resolve: (k) => k.accountLabel }),
    lastTestedAt: t.string({ nullable: true, resolve: (k) => k.lastTestedAt?.toISOString() ?? null }),
  }),
})

type Outcome = { ok: boolean; reason?: string; id?: string; status?: string; url?: string }
const OutcomeType = builder.objectRef<Outcome>('PartnerAiKeyResult').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    reason: t.string({ nullable: true, resolve: (o) => o.reason ?? null }),
    id: t.string({ nullable: true, resolve: (o) => o.id ?? null }),
    status: t.string({ nullable: true, resolve: (o) => o.status ?? null }),
    url: t.string({ nullable: true, resolve: (o) => o.url ?? null }),
  }),
})

type SignIn = Awaited<ReturnType<PartnerCredentialsService['providers']>>[number]
const SignInType = builder.objectRef<SignIn>('PartnerAiSignIn').implement({
  fields: (t) => ({
    provider: t.exposeString('provider'),
    available: t.boolean({ resolve: (p) => p.availability.available }),
    reason: t.string({ nullable: true, resolve: (p) => (p.availability.available ? null : p.availability.reason) }),
  }),
})

builder.queryFields((t) => ({
  partnerAiKeys: t.field({ type: [AiKeyType], extensions: { access: writes }, resolve: (_, __, ctx) => signedIn(ctx.credentials).aiKeys() }),
  partnerAiSignIn: t.field({ type: [SignInType], extensions: { access: writes }, resolve: (_, __, ctx) => signedIn(ctx.credentials).providers() }),
}))

builder.mutationFields((t) => ({
  addPartnerAiKey: t.field({
    type: OutcomeType,
    args: { provider: t.arg.string({ required: true }), name: t.arg.string({ required: true }), key: t.arg.string({ required: true }) },
    extensions: { access: { ...writes, audit: credentialAudit.addAiKey, blockedFor: ['impersonation'] } },
    resolve: (_, args, ctx) => signedIn(ctx.credentials).addAiKey(args),
  }),
  beginPartnerAiOauth: t.field({
    type: OutcomeType,
    args: { provider: t.arg.string({ required: true }), id: t.arg.id() },
    extensions: { access: { ...writes, audit: credentialAudit.oauthStarted, blockedFor: ['impersonation'] } },
    resolve: (_, { provider, id }, ctx) => (aiProviders.includes(provider as AiProvider) ? signedIn(ctx.credentials).beginOauth(provider as AiProvider, id ? String(id) : null) : { ok: false, reason: 'INVALID_INPUT' }),
  }),
  finishPartnerAiOauth: t.field({
    type: OutcomeType,
    args: { response: t.arg.string({ required: true }) },
    extensions: { access: { ...writes, audit: credentialAudit.addAiKey, blockedFor: ['impersonation'] } },
    resolve: (_, { response }, ctx) => signedIn(ctx.credentials).finishOauth(response),
  }),
  testPartnerAiKey: t.field({
    type: OutcomeType,
    args: { id: t.arg.id({ required: true }) },
    extensions: { access: { ...writes, audit: credentialAudit.testAiKey } },
    resolve: (_, { id }, ctx) => signedIn(ctx.credentials).testAiKey(String(id)),
  }),
  setDefaultPartnerAiKey: t.field({
    type: OutcomeType,
    args: { id: t.arg.id({ required: true }) },
    extensions: { access: { ...writes, audit: credentialAudit.setDefaultAiKey, blockedFor: ['impersonation'] } },
    resolve: (_, { id }, ctx) => signedIn(ctx.credentials).setDefaultAiKey(String(id)),
  }),
  removePartnerAiKey: t.field({
    type: OutcomeType,
    args: { id: t.arg.id({ required: true }) },
    extensions: { access: { ...writes, audit: credentialAudit.removeAiKey, blockedFor: ['impersonation'] } },
    resolve: (_, { id }, ctx) => signedIn(ctx.credentials).removeAiKey(String(id)),
  }),
}))
