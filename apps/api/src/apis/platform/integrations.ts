import { credentialAudit, type PartnerCredentialsService } from '#saas/partnerCredentials/index'
import { builder } from './builder'
import { partnerRead, signedIn } from './fields'

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
    lastTestedAt: t.string({ nullable: true, resolve: (k) => k.lastTestedAt?.toISOString() ?? null }),
  }),
})

type Outcome = { ok: boolean; reason?: string; id?: string; status?: string }
const OutcomeType = builder.objectRef<Outcome>('PartnerAiKeyResult').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    reason: t.string({ nullable: true, resolve: (o) => o.reason ?? null }),
    id: t.string({ nullable: true, resolve: (o) => o.id ?? null }),
    status: t.string({ nullable: true, resolve: (o) => o.status ?? null }),
  }),
})

builder.queryFields((t) => ({
  partnerAiKeys: t.field({ type: [AiKeyType], extensions: { access: partnerRead }, resolve: (_, __, ctx) => signedIn(ctx.credentials).aiKeys() }),
}))

builder.mutationFields((t) => ({
  addPartnerAiKey: t.field({
    type: OutcomeType,
    args: { provider: t.arg.string({ required: true }), name: t.arg.string({ required: true }), key: t.arg.string({ required: true }) },
    extensions: { access: { ...writes, audit: credentialAudit.addAiKey, blockedFor: ['impersonation'] } },
    resolve: (_, args, ctx) => signedIn(ctx.credentials).addAiKey(args),
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
