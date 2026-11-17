import { z } from 'zod'
import type { SecretBox } from '#auth/secretBox'
import {
  awsAccessKeyIdSchema,
  awsRegionSchema,
  dltEntityIdSchema,
  dltSenderIdSchema,
  isE164,
  routeProviders,
  smsMessages,
  smsProviders,
  smsRouteFor,
  smsRoutes,
  smsTemplatesSchema,
  twilioAccountSidSchema,
  twilioMessagingServiceSidSchema,
  type OutgoingSms,
  type SmsAccountCheck,
  type SmsMessage,
  type SmsProvider,
  type SmsRoute,
} from '#core/sms'
import type { ScopedSql } from '#db/scoped/index'
import { expireUnsent } from '#db/scoped/outbox'
import { selectSealedSmsAccounts, selectSmsPrefs } from '#db/scoped/partnerCredentials'
import { selectDfMessaging, selectOurAccounts, selectOurMessaging } from '#db/scoped/platformMessaging'
import { checkMsg91Account } from '#integrations/msg91/index'
import { checkSnsAccount } from '#integrations/sns/index'
import { checkTwilioAccount } from '#integrations/twilio/index'
import { queueSideEffect } from '#saas/outbox/index'

// What the platform texts (THIRD-PARTY-ACCESS §2.8, decided on #337): one-time codes, and
// shoppers' order updates. Each message is a DLT template in India, so its wording is fixed
// here and registered exactly as written, variables in this order.

export const smsKind = 'sms'

/** An order update unsent after this is news nobody needs, and its number and link leave the outbox. */
export const orderTextMs = 3 * 24 * 60 * 60 * 1000

export { smsMessages, smsRouteFor, type SmsMessage, type SmsProvider, type SmsRoute }

const code = z.object({ code: z.string().regex(/^\d{6}$/) }).strict()
const order = z.object({ order: z.string().min(1).max(40) }).strict()
const shipped = order.extend({ courier: z.string().min(1).max(40), link: z.url() }).strict()
const delivered = order.extend({ link: z.url() }).strict()
const invited = z.object({ link: z.url() }).strict()

const varsSchemas = {
  'code.second_factor': code,
  'code.verify_phone': code,
  'code.shopper_sign_in': code,
  'order.confirmed': order,
  'order.shipped': shipped,
  'order.delivered': delivered,
  'rider.invited': invited,
} satisfies Record<SmsMessage, z.ZodType>

/** The outbox payload: no free text, so nothing a caller writes reaches a template unchecked. */
export const smsPayloadSchema = z
  .object({
    message: z.enum(smsMessages),
    to: z.string().refine(isE164, 'an E.164 number'),
    /** The sender's name as the reader knows it: the partner's product, or the store's name. */
    brand: z.string().min(1).max(30),
    vars: z.record(z.string(), z.string()),
    /** A code older than this is useless; the deliverer drops it rather than send it late. */
    expiresAt: z.iso.datetime().nullable(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (!varsSchemas[p.message].safeParse(p.vars).success) ctx.addIssue({ code: 'custom', message: `vars for ${p.message}` })
    if (p.message.startsWith('code.') && p.expiresAt === null) ctx.addIssue({ code: 'custom', message: `${p.message} needs expiresAt` })
  })

export type SmsPayload = z.infer<typeof smsPayloadSchema>

type Filled = (brand: string, v: Record<string, string>) => { text: string; vars: string[] }

// English for the first release (ui/README.md: messages per locale); India's DLT templates are
// registered in English too.
const en: Record<SmsMessage, Filled> = {
  'code.second_factor': (b, v) => ({ text: `${b}: ${v['code']} is your sign-in code. It works for 10 minutes. Never share it.`, vars: [b, v['code'] ?? ''] }),
  'code.verify_phone': (b, v) => ({ text: `${b}: ${v['code']} is your code to confirm this number. It works for 10 minutes.`, vars: [b, v['code'] ?? ''] }),
  'code.shopper_sign_in': (b, v) => ({ text: `${b}: ${v['code']} is your sign-in code. It works for 10 minutes. Never share it.`, vars: [b, v['code'] ?? ''] }),
  'order.confirmed': (b, v) => ({ text: `${b}: thanks for your order ${v['order']}. We'll text you when it ships.`, vars: [b, v['order'] ?? ''] }),
  'order.shipped': (b, v) => ({ text: `${b}: order ${v['order']} is on its way with ${v['courier']}. Track it: ${v['link']}`, vars: [b, v['order'] ?? '', v['courier'] ?? '', v['link'] ?? ''] }),
  'order.delivered': (b, v) => ({ text: `${b}: order ${v['order']} was delivered. Need help? ${v['link']}`, vars: [b, v['order'] ?? '', v['link'] ?? ''] }),
  'rider.invited': (b, v) => ({ text: `${b}: you're invited to deliver our orders. Get the app and sign in with this number: ${v['link']}`, vars: [b, v['link'] ?? ''] }),
}

/** The text, and for India the registered template with its variables; null template where DLT doesn't apply. */
export const composeSms = (payload: SmsPayload, dltTemplateId: string | null): OutgoingSms => {
  const filled = en[payload.message](payload.brand, payload.vars)
  return { to: payload.to, text: filled.text, dlt: dltTemplateId ? { templateId: dltTemplateId, vars: filled.vars } : null }
}

type Templates = Partial<Record<SmsMessage, string>>

/** An SMS account, decrypted: DripFunnel's own or a partner's (THIRD-PARTY-ACCESS §8.3). */
export type PartnerSmsAccount =
  | { provider: 'msg91'; authKey: string; templates: Templates }
  | { provider: 'twilio'; accountSid: string; authToken: string; messagingServiceSid: string }
  | { provider: 'sns'; accessKeyId: string; secretAccessKey: string; region: string; india: { senderId: string; entityId: string; templates: Templates } | null }

/** The account a partner's text on a route goes through; `off` while the partner's SMS is turned off (THIRD-PARTY-ACCESS §4). */
export interface PartnerSmsAccounts {
  forPartner: (tx: ScopedSql, partnerId: string, route: SmsRoute) => Promise<PartnerSmsAccount | 'off' | null>
}

const snsIndiaSchema = z.strictObject({ senderId: dltSenderIdSchema, entityId: dltEntityIdSchema, templates: smsTemplatesSchema })

/** What `partner_credential.settings` holds for each provider: the parts that aren't secret (#1017). */
export const smsSettingsSchemas = {
  msg91: z.strictObject({ templates: smsTemplatesSchema }),
  twilio: z.strictObject({ accountSid: twilioAccountSidSchema, messagingServiceSid: twilioMessagingServiceSidSchema }),
  sns: z.strictObject({ accessKeyId: awsAccessKeyIdSchema, region: awsRegionSchema, india: snsIndiaSchema.nullable() }),
} as const

/** Whether an account can send every message on the route: India needs DLT's seven templates (and SNS its header and entity). */
export const servesRoute = (account: PartnerSmsAccount, route: SmsRoute): boolean => {
  const complete = (templates: Templates) => smsMessages.every((m) => Boolean(templates[m]))
  if (account.provider === 'msg91') return route === 'india' && complete(account.templates)
  if (account.provider === 'twilio') return route === 'rest'
  return route === 'rest' || (account.india !== null && complete(account.india.templates))
}

/** DripFunnel's own account for each route; a route without one is absent. */
export type OurSmsRoutes = Partial<Record<SmsRoute, PartnerSmsAccount>>

/** DripFunnel's accounts a partner may use: none while Admin hasn't enabled DripFunnel's SMS for it (#1543). System scope. */
export type OurSms = (tx: ScopedSql, partnerId: string) => Promise<OurSmsRoutes>

/** A saved account, opened; null where its secret or settings can't be read, so it never half sends (#1017). */
export const openSmsAccount = async (secrets: SecretBox | null, row: { provider: SmsProvider; key_enc: string; settings: unknown }): Promise<PartnerSmsAccount | null> => {
  const secret = secrets ? await secrets.open(row.key_enc) : null
  if (!secret) return null
  if (row.provider === 'msg91') {
    const settings = smsSettingsSchemas.msg91.safeParse(row.settings)
    return settings.success ? { provider: 'msg91', authKey: secret, templates: settings.data.templates } : null
  }
  if (row.provider === 'twilio') {
    const settings = smsSettingsSchemas.twilio.safeParse(row.settings)
    return settings.success ? { provider: 'twilio', authToken: secret, ...settings.data } : null
  }
  const settings = smsSettingsSchemas.sns.safeParse(row.settings)
  return settings.success ? { provider: 'sns', secretAccessKey: secret, ...settings.data } : null
}

/** Whether a saved account's parts serve the route, read without its secret. */
export const savedServes = (row: { provider: SmsProvider; settings: unknown }, route: SmsRoute): boolean => {
  if (row.provider === 'twilio') return route === 'rest'
  if (row.provider === 'msg91') return route === 'india' && smsSettingsSchemas.msg91.safeParse(row.settings).success
  const sns = smsSettingsSchemas.sns.safeParse(row.settings)
  return sns.success && (route === 'rest' || sns.data.india !== null)
}

/** The saved account that serves a route: the chosen provider's, else the first of the route's providers that does. */
export const accountForRoute = <Row extends { provider: SmsProvider; settings: unknown }>(rows: readonly Row[], route: SmsRoute, choice: string | null): Row | undefined =>
  [choice, ...routeProviders[route]].map((p) => rows.find((r) => r.provider === p)).find((r): r is Row => r !== undefined && savedServes(r, route))

/**
 * Whose account sends (#1543): DripFunnel's only where Admin enabled it for the partner (`ours`), and then when the partner
 * chose it or has no account of its own; else the partner's own; else none. The same rule for an SMS route and WhatsApp.
 */
export const senderOf = (choice: string | null, hasOwn: boolean, ours: boolean): 'own' | 'dripfunnel' | null =>
  ours && (choice === 'dripfunnel' || !hasOwn) ? 'dripfunnel' : hasOwn ? 'own' : null

const isSmsRow = <Row extends { provider: string }>(row: Row): row is Row & { provider: SmsProvider } => (smsProviders as readonly string[]).includes(row.provider)

/** DripFunnel's accounts as a Super admin saved them (#1543), opened, per route by its route choice. System scope. */
export const savedOurSmsRoutes =
  (secrets: SecretBox | null) =>
  async (tx: ScopedSql): Promise<OurSmsRoutes> => {
    const rows = (await selectOurAccounts(tx, 'sms')).filter(isSmsRow)
    const { routes } = await selectOurMessaging(tx)
    const ours: OurSmsRoutes = {}
    for (const route of smsRoutes) {
      const row = accountForRoute(rows, route, routes[route])
      const account = row ? await openSmsAccount(secrets, row) : null
      if (account && servesRoute(account, route)) ours[route] = account
    }
    return ours
  }

/** DripFunnel's routes for the partners Admin enabled them for (#1543): `routes` reads them, from the database or the stand-in. */
export const ourSmsFor =
  (routes: (tx: ScopedSql) => Promise<OurSmsRoutes>): OurSms =>
  async (tx, partnerId) =>
    (await selectDfMessaging(tx, partnerId)).sms ? routes(tx) : {}

/**
 * Per route, the account `senderOf` picks: the partner's own (its choice, else the first of the route's providers that
 * serves it) or DripFunnel's; none while its SMS is off. An own account that can't be opened answers null: nothing falls
 * back between accounts (#1542, #1543). Called in system scope.
 */
export const smsAccountsFor = (secrets: SecretBox | null, ours: OurSms): PartnerSmsAccounts => ({
  forPartner: async (tx, partnerId, route) => {
    const prefs = await selectSmsPrefs(tx, partnerId)
    if (!prefs.enabled) return 'off'
    const choice = prefs.routes[route]
    const own = accountForRoute(await selectSealedSmsAccounts(tx, partnerId), route, choice)
    const theirs = choice === 'dripfunnel' || !own ? (await ours(tx, partnerId))[route] : undefined
    const sender = senderOf(choice, own !== undefined, theirs !== undefined)
    if (sender === 'dripfunnel') return theirs ?? null
    const account = sender === 'own' && own ? await openSmsAccount(secrets, own) : null
    return account && servesRoute(account, route) ? account : null
  },
})

/** The `sms` deliverer's accounts, DripFunnel's read from the database: wherever sealed accounts can be opened (#1542, #1543). */
export const smsDeliveryFor = (secrets: SecretBox | null): PartnerSmsAccounts | null => (secrets ? smsAccountsFor(secrets, ourSmsFor(savedOurSmsRoutes(secrets))) : null)

/** One read-only call to the account's provider: nothing is sent (#1017). */
export const checkSmsAccount = (account: PartnerSmsAccount): Promise<SmsAccountCheck> => {
  if (account.provider === 'msg91') return checkMsg91Account({ authKey: account.authKey })
  if (account.provider === 'twilio') return checkTwilioAccount(account)
  return checkSnsAccount({ accessKeyId: account.accessKeyId, secretAccessKey: account.secretAccessKey, region: account.region })
}

/**
 * Queues one text in the transaction that decided it. The idempotency key is the caller's, e.g.
 * the code's own id, so a retried request never texts twice.
 */
export const queueSms = (tx: ScopedSql, effect: { partnerId: string; storeId: string | null; idempotencyKey: string; payload: SmsPayload }): Promise<string | null> => {
  const payload = smsPayloadSchema.parse(effect.payload)
  return queueSideEffect(tx, { kind: smsKind, idempotencyKey: effect.idempotencyKey, payload, partnerId: effect.partnerId, storeId: effect.storeId })
}

/** The cron's sweep for texts nobody sent in time, delivered or not registered yet (THIRD-PARTY-ACCESS §4). */
export const expireUnsentSms = (tx: ScopedSql, now: Date, leaseMs: number): Promise<number> =>
  expireUnsent(tx, { kind: smsKind, expiresAtKey: 'expiresAt', fallbackMs: orderTextMs, keep: ['message'], leaseMs, limit: 500 }, now)
