import { smsAudit, type PartnerSmsService } from '#saas/partnerCredentials/index'
import { builder } from './builder'
import { signedIn } from './fields'

// Settings › Integrations, SMS on the Platform API (#1017; #1018 draws the panel). Thin: saas/partnerCredentials decides.
// A secret goes in once and comes back as its last four characters.
type Sms = Awaited<ReturnType<PartnerSmsService['accounts']>>
// Every SMS field is the partner's or a setup session's, never an impersonation's (ACCESS §8.1), the read included.
const access = { api: 'platform', scope: 'partner', permission: 'integrations.write', target: 'none', blockedFor: ['impersonation'] } as const

const AccountType = builder.objectRef<Sms['accounts'][number]>('PartnerSmsAccount').implement({
  fields: (t) => ({
    provider: t.exposeString('provider'),
    hint: t.exposeString('hint'),
    status: t.exposeString('status'),
    lastTestedAt: t.string({ nullable: true, resolve: (a) => a.lastTestedAt?.toISOString() ?? null }),
    templatesComplete: t.boolean({ nullable: true, resolve: (a) => a.templatesComplete }),
  }),
})

const SmsType = builder.objectRef<Sms>('PartnerSms').implement({
  fields: (t) => ({
    enabled: t.exposeBoolean('enabled'),
    accounts: t.field({ type: [AccountType], resolve: (s) => s.accounts }),
  }),
})

type Outcome = { ok: boolean; reason?: string; status?: string }
const OutcomeType = builder.objectRef<Outcome>('PartnerSmsResult').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    reason: t.string({ nullable: true, resolve: (o) => o.reason ?? null }),
    status: t.string({ nullable: true, resolve: (o) => o.status ?? null }),
  }),
})

const TemplateInput = builder.inputType('PartnerSmsTemplateInput', {
  fields: (t) => ({ message: t.string({ required: true }), templateId: t.string({ required: true }) }),
})

builder.queryFields((t) => ({
  smsAccounts: t.field({ type: SmsType, extensions: { access }, resolve: (_, __, ctx) => signedIn(ctx.sms).accounts() }),
}))

builder.mutationFields((t) => ({
  saveSmsAccount: t.field({
    type: OutcomeType,
    args: {
      provider: t.arg.string({ required: true }),
      authKey: t.arg.string(),
      templates: t.arg({ type: [TemplateInput] }),
      accountSid: t.arg.string(),
      authToken: t.arg.string(),
      messagingServiceSid: t.arg.string(),
    },
    extensions: { access: { ...access, audit: smsAudit.save } },
    // Only the arguments given reach the service, which refuses any its provider doesn't take.
    resolve: (_, args, ctx) => signedIn(ctx.sms).save(Object.fromEntries(Object.entries(args).filter(([, v]) => v !== null && v !== undefined))),
  }),
  testSmsAccount: t.field({
    type: OutcomeType,
    args: { provider: t.arg.string({ required: true }) },
    extensions: { access: { ...access, audit: smsAudit.test } },
    resolve: (_, { provider }, ctx) => signedIn(ctx.sms).test(provider),
  }),
  removeSmsAccount: t.field({
    type: OutcomeType,
    args: { provider: t.arg.string({ required: true }) },
    extensions: { access: { ...access, audit: smsAudit.remove } },
    resolve: (_, { provider }, ctx) => signedIn(ctx.sms).remove(provider),
  }),
  setSmsEnabled: t.field({
    type: OutcomeType,
    args: { enabled: t.arg.boolean({ required: true }) },
    extensions: { access: { ...access, audit: smsAudit.enabled } },
    resolve: (_, { enabled }, ctx) => signedIn(ctx.sms).setEnabled(enabled),
  }),
}))
