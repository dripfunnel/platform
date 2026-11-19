import { whatsappAudit, type PartnerWhatsAppService } from '#saas/partnerCredentials/index'
import { builder } from './builder'
import { signedIn } from './fields'

// Settings › Integrations, WhatsApp on the Platform API (#1504; #1505 draws the panel). Thin: saas/partnerCredentials decides.
// The token goes in once and comes back as its last four characters.
type WhatsApp = Awaited<ReturnType<PartnerWhatsAppService['account']>>
type Account = NonNullable<WhatsApp['account']>
// Every WhatsApp field is the partner's or a setup session's, never an impersonation's (ACCESS §8.1), the read included.
const access = { api: 'platform', scope: 'partner', permission: 'integrations.write', target: 'none', blockedFor: ['impersonation'] } as const

const TemplateType = builder.objectRef<Account['templates'][number]>('PartnerWhatsAppTemplate').implement({
  fields: (t) => ({
    message: t.exposeString('message'),
    // Null where the partner uses no template for this message.
    name: t.string({ nullable: true, resolve: (m) => m.name }),
  }),
})

const AccountType = builder.objectRef<Account>('PartnerWhatsAppAccount').implement({
  fields: (t) => ({
    hint: t.exposeString('hint'),
    businessAccountId: t.string({ nullable: true, resolve: (a) => a.businessAccountId }),
    phoneNumberId: t.string({ nullable: true, resolve: (a) => a.phoneNumberId }),
    language: t.string({ nullable: true, resolve: (a) => a.language }),
    templates: t.field({ type: [TemplateType], resolve: (a) => a.templates }),
    status: t.exposeString('status'),
    lastTestedAt: t.string({ nullable: true, resolve: (a) => a.lastTestedAt?.toISOString() ?? null }),
  }),
})

const WhatsAppType = builder.objectRef<WhatsApp>('PartnerWhatsApp').implement({
  fields: (t) => ({
    enabled: t.exposeBoolean('enabled'),
    account: t.field({ type: AccountType, nullable: true, resolve: (w) => w.account }),
    // Whether DripFunnel's account is there for the partner (#1543): Admin enabled it and it can send codes; never its token.
    dripfunnel: t.exposeBoolean('dripfunnel'),
    // The partner's choice, `own` or `dripfunnel`; null leaves it to its own account, if it has one.
    choice: t.string({ nullable: true, resolve: (w) => w.choice }),
    // Whose account sends while WhatsApp is on, `own` or `dripfunnel`; null where none would.
    sender: t.string({ nullable: true, resolve: (w) => w.sender }),
  }),
})

type Outcome = { ok: boolean; reason?: string; status?: string; problem?: string; template?: string }
const OutcomeType = builder.objectRef<Outcome>('PartnerWhatsAppResult').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    reason: t.string({ nullable: true, resolve: (o) => o.reason ?? null }),
    status: t.string({ nullable: true, resolve: (o) => o.status ?? null }),
    // What Meta refused: token, phone_number, business_account or template (then `template` names its message).
    problem: t.string({ nullable: true, resolve: (o) => o.problem ?? null }),
    template: t.string({ nullable: true, resolve: (o) => o.template ?? null }),
  }),
})

const TemplateInput = builder.inputType('PartnerWhatsAppTemplateInput', {
  fields: (t) => ({ message: t.string({ required: true }), name: t.string({ required: true }) }),
})

builder.queryFields((t) => ({
  whatsAppAccount: t.field({ type: WhatsAppType, extensions: { access }, resolve: (_, __, ctx) => signedIn(ctx.whatsapp).account() }),
}))

builder.mutationFields((t) => ({
  saveWhatsAppAccount: t.field({
    type: OutcomeType,
    args: {
      accessToken: t.arg.string({ required: true }),
      businessAccountId: t.arg.string({ required: true }),
      phoneNumberId: t.arg.string({ required: true }),
      language: t.arg.string({ required: true }),
      templates: t.arg({ type: [TemplateInput], required: true }),
    },
    extensions: { access: { ...access, audit: whatsappAudit.save } },
    resolve: (_, args, ctx) => signedIn(ctx.whatsapp).save(args),
  }),
  testWhatsAppAccount: t.field({
    type: OutcomeType,
    extensions: { access: { ...access, audit: whatsappAudit.test } },
    resolve: (_, __, ctx) => signedIn(ctx.whatsapp).test(),
  }),
  removeWhatsAppAccount: t.field({
    type: OutcomeType,
    extensions: { access: { ...access, audit: whatsappAudit.remove } },
    resolve: (_, __, ctx) => signedIn(ctx.whatsapp).remove(),
  }),
  setWhatsAppEnabled: t.field({
    type: OutcomeType,
    args: { enabled: t.arg.boolean({ required: true }) },
    extensions: { access: { ...access, audit: whatsappAudit.enabled } },
    resolve: (_, { enabled }, ctx) => signedIn(ctx.whatsapp).setEnabled(enabled),
  }),
  setWhatsAppChoice: t.field({
    type: OutcomeType,
    args: { account: t.arg.string({ required: true }) },
    extensions: { access: { ...access, audit: whatsappAudit.chosen } },
    resolve: (_, { account }, ctx) => signedIn(ctx.whatsapp).setChoice(account),
  }),
}))
