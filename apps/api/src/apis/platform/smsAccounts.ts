import { credentialAudit, type PartnerCredentialsService } from '#saas/partnerCredentials/index'
import { builder } from './builder'
import { present, signedIn } from './fields'
import { writes } from './integrations'

// Settings › Integrations, the partner's own SMS accounts (card #1017; the screen is #1018). Thin: saas/partnerCredentials
// decides. A secret goes in once and comes back as its last four characters; saving, testing and removing are an Owner's or
// Admin's, and never an impersonation's (ACCESS.md §8.1).
type SmsAccount = Awaited<ReturnType<PartnerCredentialsService['smsAccounts']>>[number]

const SmsAccountType = builder.objectRef<SmsAccount>('PartnerSmsAccount').implement({
  fields: (t) => ({
    provider: t.exposeString('provider'),
    hint: t.exposeString('hint'),
    status: t.exposeString('status'),
    lastTestedAt: t.string({ nullable: true, resolve: (a) => a.lastTestedAt?.toISOString() ?? null }),
    // MSG91 only: whether all seven message kinds have a template id. Null for Twilio, which has none.
    templatesComplete: t.boolean({ nullable: true, resolve: (a) => a.templatesComplete }),
  }),
})

type Outcome = { ok: boolean; reason?: string; status?: string }
const OutcomeType = builder.objectRef<Outcome>('PartnerSmsAccountResult').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    reason: t.string({ nullable: true, resolve: (o) => o.reason ?? null }),
    status: t.string({ nullable: true, resolve: (o) => o.status ?? null }),
  }),
})

const TemplateInput = builder.inputType('PartnerSmsTemplateInput', {
  fields: (t) => ({ message: t.string({ required: true }), templateId: t.string({ required: true }) }),
})

const AccountInput = builder.inputType('PartnerSmsAccountInput', {
  fields: (t) => ({
    provider: t.string({ required: true }),
    authKey: t.string(),
    templates: t.field({ type: [TemplateInput] }),
    accountSid: t.string(),
    authToken: t.string(),
    messagingServiceSid: t.string(),
  }),
})

builder.queryFields((t) => ({
  smsAccounts: t.field({ type: [SmsAccountType], extensions: { access: writes }, resolve: (_, __, ctx) => signedIn(ctx.credentials).smsAccounts() }),
}))

builder.mutationFields((t) => ({
  saveSmsAccount: t.field({
    type: OutcomeType,
    args: { input: t.arg({ type: AccountInput, required: true }) },
    extensions: { access: { ...writes, audit: credentialAudit.saveSmsAccount, blockedFor: ['impersonation'] } },
    resolve: (_, { input }, ctx) => signedIn(ctx.credentials).saveSmsAccount(present({ ...input, templates: input.templates?.map((entry) => present(entry)) })),
  }),
  testSmsAccount: t.field({
    type: OutcomeType,
    args: { provider: t.arg.string({ required: true }) },
    extensions: { access: { ...writes, audit: credentialAudit.testSmsAccount, blockedFor: ['impersonation'] } },
    resolve: (_, { provider }, ctx) => signedIn(ctx.credentials).testSmsAccount(provider),
  }),
  removeSmsAccount: t.field({
    type: OutcomeType,
    args: { provider: t.arg.string({ required: true }) },
    extensions: { access: { ...writes, audit: credentialAudit.removeSmsAccount, blockedFor: ['impersonation'] } },
    resolve: (_, { provider }, ctx) => signedIn(ctx.credentials).removeSmsAccount(provider),
  }),
}))
