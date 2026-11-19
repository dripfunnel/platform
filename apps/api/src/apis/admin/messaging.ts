import { GraphQLError } from 'graphql'
import type { MapsKeyResult } from '#saas/partnerCredentials/index'
import { platformMessagingAudit, type MessagingResult, type PlatformMessagingService } from '#saas/platformMessaging/index'
import { builder } from './builder'
import { compact, iso, signedIn } from './types'

// DripFunnel's own SMS, WhatsApp and Google Maps key on the Admin API (#1543, #1612; #1544 and #1613 draw the screens). Thin: saas/platformMessaging decides.
// Every role reads the status; Super admin alone changes an account; Super admin and Partner manager switch it per partner.
// A secret goes in once and comes back as its last four characters.

type Sms = Awaited<ReturnType<PlatformMessagingService['smsAccounts']>>
type WhatsApp = Awaited<ReturnType<PlatformMessagingService['whatsAppAccount']>>
type WhatsAppAccount = NonNullable<WhatsApp['account']>
type Maps = Awaited<ReturnType<PlatformMessagingService['mapsKey']>>
type Switches = NonNullable<Awaited<ReturnType<PlatformMessagingService['partnerSwitches']>>>

const read = { access: { api: 'admin' as const, scope: 'platform' as const, permission: 'messaging.read' as const, target: 'none' as const } }
const manage = (audit: string) => ({ access: { api: 'admin' as const, scope: 'platform' as const, permission: 'messaging.manage' as const, target: 'none' as const, audit } })
const byPartner = ({ partnerId }: { partnerId: string | number }) => ({ partnerId: String(partnerId) })

const SmsAccountType = builder.objectRef<Sms['accounts'][number]>('PlatformSmsAccount').implement({
  fields: (t) => ({
    provider: t.exposeString('provider'),
    hint: t.exposeString('hint'),
    status: t.exposeString('status'),
    lastTestedAt: t.string({ nullable: true, resolve: (a) => iso(a.lastTestedAt) }),
    templatesComplete: t.boolean({ nullable: true, resolve: (a) => a.templatesComplete }),
  }),
})

const SmsRouteType = builder.objectRef<Sms['routes'][number]>('PlatformSmsRoute').implement({
  fields: (t) => ({
    route: t.exposeString('route'),
    // DripFunnel's choice; null leaves the route to the first of its providers it holds an account for.
    provider: t.string({ nullable: true, resolve: (r) => r.provider }),
    // The account that sends the route's texts for partners using DripFunnel's, if one does.
    serving: t.string({ nullable: true, resolve: (r) => r.serving }),
  }),
})

const SmsType = builder.objectRef<Sms>('PlatformSms').implement({
  fields: (t) => ({
    routes: t.field({ type: [SmsRouteType], resolve: (s) => s.routes }),
    accounts: t.field({ type: [SmsAccountType], resolve: (s) => s.accounts }),
  }),
})

const TemplateType = builder.objectRef<WhatsAppAccount['templates'][number]>('PlatformWhatsAppTemplate').implement({
  fields: (t) => ({ message: t.exposeString('message'), name: t.string({ nullable: true, resolve: (m) => m.name }) }),
})

const WhatsAppAccountType = builder.objectRef<WhatsAppAccount>('PlatformWhatsAppAccount').implement({
  fields: (t) => ({
    hint: t.exposeString('hint'),
    businessAccountId: t.string({ nullable: true, resolve: (a) => a.businessAccountId }),
    phoneNumberId: t.string({ nullable: true, resolve: (a) => a.phoneNumberId }),
    language: t.string({ nullable: true, resolve: (a) => a.language }),
    templates: t.field({ type: [TemplateType], resolve: (a) => a.templates }),
    status: t.exposeString('status'),
    lastTestedAt: t.string({ nullable: true, resolve: (a) => iso(a.lastTestedAt) }),
  }),
})

const WhatsAppType = builder.objectRef<WhatsApp>('PlatformWhatsApp').implement({
  fields: (t) => ({
    enabled: t.exposeBoolean('enabled'),
    account: t.field({ type: WhatsAppAccountType, nullable: true, resolve: (w) => w.account }),
  }),
})

const OutcomeType = builder.objectRef<MessagingResult>('PlatformMessagingResult').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    reason: t.string({ nullable: true, resolve: (o) => (o.ok ? null : o.reason) }),
    status: t.string({ nullable: true, resolve: (o) => (o.ok ? (o.status ?? null) : null) }),
    // What Meta refused: token, phone_number, business_account or template (then `template` names its message).
    problem: t.string({ nullable: true, resolve: (o) => o.problem ?? null }),
    template: t.string({ nullable: true, resolve: (o) => o.template ?? null }),
  }),
})

const MapsKeyType = builder.objectRef<NonNullable<Maps['key']>>('PlatformMapsKeyAccount').implement({
  fields: (t) => ({
    // "AIza…abcd", never the key.
    hint: t.exposeString('hint'),
    status: t.exposeString('status'),
    lastTestedAt: t.string({ nullable: true, resolve: (k) => iso(k.lastTestedAt) }),
  }),
})

const MapsType = builder.objectRef<Maps>('PlatformMaps').implement({
  fields: (t) => ({
    enabled: t.exposeBoolean('enabled'),
    key: t.field({ type: MapsKeyType, nullable: true, resolve: (m) => m.key }),
  }),
})

const MapsOutcomeType = builder.objectRef<MapsKeyResult>('PlatformMapsResult').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    reason: t.string({ nullable: true, resolve: (o) => (o.ok ? null : o.reason) }),
    status: t.string({ nullable: true, resolve: (o) => (o.ok ? (o.status ?? null) : null) }),
    // What Google refused: invalid, geocoding_disabled, restricted or other.
    problem: t.string({ nullable: true, resolve: (o) => o.problem ?? null }),
  }),
})

const SwitchesType = builder.objectRef<Switches>('PartnerDfMessaging').implement({
  fields: (t) => ({ sms: t.exposeBoolean('sms'), whatsapp: t.exposeBoolean('whatsapp'), maps: t.exposeBoolean('maps') }),
})

const SmsTemplateInput = builder.inputType('PlatformSmsTemplateInput', {
  fields: (t) => ({ message: t.string({ required: true }), templateId: t.string({ required: true }) }),
})
const WhatsAppTemplateInput = builder.inputType('PlatformWhatsAppTemplateInput', {
  fields: (t) => ({ message: t.string({ required: true }), name: t.string({ required: true }) }),
})

const words = { INVALID_INPUT: 'Something here isn’t valid.', NOT_FOUND: 'That partner isn’t here any more.' } as const

builder.queryFields((t) => ({
  platformSms: t.field({ type: SmsType, extensions: read, resolve: (_, __, ctx) => signedIn(ctx.messaging ?? null).smsAccounts() }),
  platformWhatsApp: t.field({ type: WhatsAppType, extensions: read, resolve: (_, __, ctx) => signedIn(ctx.messaging ?? null).whatsAppAccount() }),
  platformMapsKey: t.field({ type: MapsType, extensions: read, resolve: (_, __, ctx) => signedIn(ctx.messaging ?? null).mapsKey() }),
  partnerDfMessaging: t.field({
    type: SwitchesType,
    nullable: true,
    args: { partnerId: t.arg.id({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'partners.read', target: byPartner } },
    resolve: (_, args, ctx) => signedIn(ctx.messaging ?? null).partnerSwitches(String(args.partnerId)),
  }),
}))

builder.mutationFields((t) => ({
  savePlatformSmsAccount: t.field({
    type: OutcomeType,
    args: {
      provider: t.arg.string({ required: true }),
      authKey: t.arg.string(),
      templates: t.arg({ type: [SmsTemplateInput] }),
      accountSid: t.arg.string(),
      authToken: t.arg.string(),
      messagingServiceSid: t.arg.string(),
      accessKeyId: t.arg.string(),
      secretAccessKey: t.arg.string(),
      region: t.arg.string(),
      senderId: t.arg.string(),
      entityId: t.arg.string(),
      reason: t.arg.string({ required: true }),
    },
    extensions: manage(platformMessagingAudit.smsSave),
    // Only the arguments given reach the service, which refuses any its provider doesn't take.
    resolve: (_, { reason, ...args }, ctx) => signedIn(ctx.messaging ?? null).saveSms(compact(args), reason),
  }),
  testPlatformSmsAccount: t.field({
    type: OutcomeType,
    args: { provider: t.arg.string({ required: true }) },
    extensions: manage(platformMessagingAudit.smsTest),
    resolve: (_, { provider }, ctx) => signedIn(ctx.messaging ?? null).testSms(provider),
  }),
  removePlatformSmsAccount: t.field({
    type: OutcomeType,
    args: { provider: t.arg.string({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: manage(platformMessagingAudit.smsRemove),
    resolve: (_, { provider, reason }, ctx) => signedIn(ctx.messaging ?? null).removeSms(provider, reason),
  }),
  setPlatformSmsRoute: t.field({
    type: OutcomeType,
    args: { route: t.arg.string({ required: true }), provider: t.arg.string(), reason: t.arg.string({ required: true }) },
    extensions: manage(platformMessagingAudit.smsRoute),
    resolve: (_, { route, provider, reason }, ctx) => signedIn(ctx.messaging ?? null).setSmsRoute(route, provider ?? null, reason),
  }),
  savePlatformWhatsAppAccount: t.field({
    type: OutcomeType,
    args: {
      accessToken: t.arg.string({ required: true }),
      businessAccountId: t.arg.string({ required: true }),
      phoneNumberId: t.arg.string({ required: true }),
      language: t.arg.string({ required: true }),
      templates: t.arg({ type: [WhatsAppTemplateInput], required: true }),
      reason: t.arg.string({ required: true }),
    },
    extensions: manage(platformMessagingAudit.whatsappSave),
    resolve: (_, { reason, ...args }, ctx) => signedIn(ctx.messaging ?? null).saveWhatsApp(args, reason),
  }),
  testPlatformWhatsAppAccount: t.field({
    type: OutcomeType,
    extensions: manage(platformMessagingAudit.whatsappTest),
    resolve: (_, __, ctx) => signedIn(ctx.messaging ?? null).testWhatsApp(),
  }),
  setPlatformWhatsAppEnabled: t.field({
    type: OutcomeType,
    args: { enabled: t.arg.boolean({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: manage(platformMessagingAudit.whatsappEnabled),
    resolve: (_, { enabled, reason }, ctx) => signedIn(ctx.messaging ?? null).setWhatsAppEnabled(enabled, reason),
  }),
  removePlatformWhatsAppAccount: t.field({
    type: OutcomeType,
    args: { reason: t.arg.string({ required: true }) },
    extensions: manage(platformMessagingAudit.whatsappRemove),
    resolve: (_, { reason }, ctx) => signedIn(ctx.messaging ?? null).removeWhatsApp(reason),
  }),
  savePlatformMapsKey: t.field({
    type: MapsOutcomeType,
    args: { key: t.arg.string({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: manage(platformMessagingAudit.mapsSave),
    resolve: (_, { reason, ...args }, ctx) => signedIn(ctx.messaging ?? null).saveMapsKey(args, reason),
  }),
  testPlatformMapsKey: t.field({
    type: MapsOutcomeType,
    extensions: manage(platformMessagingAudit.mapsTest),
    resolve: (_, __, ctx) => signedIn(ctx.messaging ?? null).testMapsKey(),
  }),
  setPlatformMapsEnabled: t.field({
    type: MapsOutcomeType,
    args: { enabled: t.arg.boolean({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: manage(platformMessagingAudit.mapsEnabled),
    resolve: (_, { enabled, reason }, ctx) => signedIn(ctx.messaging ?? null).setMapsEnabled(enabled, reason),
  }),
  removePlatformMapsKey: t.field({
    type: MapsOutcomeType,
    args: { reason: t.arg.string({ required: true }) },
    extensions: manage(platformMessagingAudit.mapsRemove),
    resolve: (_, { reason }, ctx) => signedIn(ctx.messaging ?? null).removeMapsKey(reason),
  }),
  // Lets the partner use DripFunnel's account for `channel` (`sms`, `whatsapp` or `maps`), or stops it; always with a reason.
  setPartnerDfMessaging: t.field({
    type: SwitchesType,
    args: { partnerId: t.arg.id({ required: true }), channel: t.arg.string({ required: true }), enabled: t.arg.boolean({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: { access: { api: 'admin', scope: 'platform', permission: 'partners.messaging', target: byPartner, audit: platformMessagingAudit.partnerSmsEnabled } },
    resolve: async (_, { partnerId, channel, enabled, reason }, ctx) => {
      const result = await signedIn(ctx.messaging ?? null).setPartnerSwitch(String(partnerId), channel, enabled, reason)
      if (result.ok) return result.value
      throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
    },
  }),
}))
