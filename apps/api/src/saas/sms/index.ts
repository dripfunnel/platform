import { z } from 'zod'
import type { SecretBox } from '#auth/secretBox'
import type { Config } from '#core/config'
import {
  awsAccessKeyIdSchema,
  awsRegionSchema,
  dltEntityIdSchema,
  dltSenderIdSchema,
  isE164,
  routeProviders,
  smsMessages,
  smsRouteFor,
  smsTemplatesSchema,
  twilioAccountSidSchema,
  twilioMessagingServiceSidSchema,
  type OutgoingSms,
  type SmsMessage,
  type SmsProvider,
  type SmsRoute,
} from '#core/sms'
import type { ScopedSql } from '#db/scoped/index'
import { expireUnsent } from '#db/scoped/outbox'
import { selectSealedSmsAccounts, selectSmsPrefs } from '#db/scoped/partnerCredentials'
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

/** DripFunnel's own account for each route (Worker values, or locally the stand-in's); a route without one is absent. */
export type OurSmsRoutes = Partial<Record<SmsRoute, PartnerSmsAccount>>

type SmsValues = Pick<
  Config,
  | 'MSG91_AUTH_KEY'
  | 'MSG91_TEMPLATES'
  | 'TWILIO_ACCOUNT_SID'
  | 'TWILIO_AUTH_TOKEN'
  | 'TWILIO_MESSAGING_SERVICE_SID'
  | 'SNS_ACCESS_KEY_ID'
  | 'SNS_SECRET_ACCESS_KEY'
  | 'SNS_REGION'
  | 'SNS_SENDER_ID'
  | 'SNS_DLT_ENTITY_ID'
  | 'SNS_DLT_TEMPLATES'
  | 'SMS_ROUTE_INDIA'
  | 'SMS_ROUTE_REST'
>

/** DripFunnel's account for each route from the Worker's values: `SMS_ROUTE_INDIA` (MSG91 unless set) and `SMS_ROUTE_REST` (Twilio unless set). */
export const ourSmsRoutesOf = (c: SmsValues): OurSmsRoutes => {
  const accounts: Partial<Record<SmsProvider, PartnerSmsAccount>> = {
    ...(c.MSG91_AUTH_KEY && c.MSG91_TEMPLATES ? { msg91: { provider: 'msg91', authKey: c.MSG91_AUTH_KEY, templates: c.MSG91_TEMPLATES } } : {}),
    ...(c.TWILIO_ACCOUNT_SID && c.TWILIO_AUTH_TOKEN && c.TWILIO_MESSAGING_SERVICE_SID
      ? { twilio: { provider: 'twilio', accountSid: c.TWILIO_ACCOUNT_SID, authToken: c.TWILIO_AUTH_TOKEN, messagingServiceSid: c.TWILIO_MESSAGING_SERVICE_SID } }
      : {}),
    ...(c.SNS_ACCESS_KEY_ID && c.SNS_SECRET_ACCESS_KEY && c.SNS_REGION
      ? {
          sns: {
            provider: 'sns',
            accessKeyId: c.SNS_ACCESS_KEY_ID,
            secretAccessKey: c.SNS_SECRET_ACCESS_KEY,
            region: c.SNS_REGION,
            india: c.SNS_SENDER_ID && c.SNS_DLT_ENTITY_ID && c.SNS_DLT_TEMPLATES ? { senderId: c.SNS_SENDER_ID, entityId: c.SNS_DLT_ENTITY_ID, templates: c.SNS_DLT_TEMPLATES } : null,
          },
        }
      : {}),
  }
  const india = accounts[c.SMS_ROUTE_INDIA ?? 'msg91']
  const rest = accounts[c.SMS_ROUTE_REST ?? 'twilio']
  return { ...(india && servesRoute(india, 'india') ? { india } : {}), ...(rest && servesRoute(rest, 'rest') ? { rest } : {}) }
}

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

/**
 * Per route, the partner's provider for it (its choice, else the first of the route's providers it has an account for)
 * if that account is complete, else DripFunnel's (#1017); none at all while its SMS is off. Called in system scope.
 */
export const smsAccountsFor = (secrets: SecretBox | null, ours: OurSmsRoutes): PartnerSmsAccounts => ({
  forPartner: async (tx, partnerId, route) => {
    const prefs = await selectSmsPrefs(tx, partnerId)
    if (!prefs.enabled) return 'off'
    const rows = await selectSealedSmsAccounts(tx, partnerId)
    const chosen = prefs.routes[route] ?? routeProviders[route].find((p) => rows.some((r) => r.provider === p))
    const row = rows.find((r) => r.provider === chosen)
    const account = row ? await openSmsAccount(secrets, row) : null
    return account && servesRoute(account, route) ? account : (ours[route] ?? null)
  },
})

/** The `sms` deliverer's accounts: wherever a partner's can be opened or DripFunnel has a route, else null (#1542). */
export const smsDeliveryFor = (secrets: SecretBox | null, ours: OurSmsRoutes): PartnerSmsAccounts | null =>
  secrets || ours.india || ours.rest ? smsAccountsFor(secrets, ours) : null

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
