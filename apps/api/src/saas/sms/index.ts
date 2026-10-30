import { z } from 'zod'
import type { SecretBox } from '#auth/secretBox'
import type { Config } from '#core/config'
import { isE164, msg91Templates, smsMessages, twilioAccountSid, twilioMessagingServiceSid, type OutgoingSms, type SmsMessage, type SmsProvider } from '#core/sms'
import type { ScopedSql } from '#db/scoped/index'
import { expireUnsent } from '#db/scoped/outbox'
import { selectSealedSmsAccount } from '#db/scoped/partnerSmsCredentials'
import { queueSideEffect } from '#saas/outbox/index'

// What the platform texts (THIRD-PARTY-ACCESS §2.8, decided on #337): one-time codes, and
// shoppers' order updates. Each message is a DLT template in India, so its wording is fixed
// here and registered by the partner exactly as written, variables in this order.

export const smsKind = 'sms'

/** An order update unsent after this is news nobody needs, and its number and link leave the outbox. */
export const orderTextMs = 3 * 24 * 60 * 60 * 1000

export { smsMessages, type SmsMessage, type SmsProvider } from '#core/sms'

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

export const providerFor = (to: string): SmsProvider => (to.startsWith('+91') ? 'msg91' : 'twilio')

/** An SMS account to send through (THIRD-PARTY-ACCESS §8.3): a partner's own or DripFunnel's, decrypted. */
export type PartnerSmsAccount =
  | { provider: 'msg91'; authKey: string; templates: Partial<Record<SmsMessage, string>> }
  | { provider: 'twilio'; accountSid: string; authToken: string; messagingServiceSid: string }

export interface PartnerSmsAccounts {
  forPartner: (tx: ScopedSql, partnerId: string, provider: SmsProvider) => Promise<PartnerSmsAccount | null>
}

/** DripFunnel's own accounts, from the Worker's values (core/config.ts): each is whole or absent. */
export interface SmsAccountDefaults {
  msg91: Extract<PartnerSmsAccount, { provider: 'msg91' }> | null
  twilio: Extract<PartnerSmsAccount, { provider: 'twilio' }> | null
}

const signInTemplates = (id: string | undefined): Partial<Record<SmsMessage, string>> => (id ? { 'code.second_factor': id, 'code.shopper_sign_in': id } : {})

export const smsAccountDefaultsOf = (c: Pick<Config, 'MSG91_AUTH_KEY' | 'MSG91_TEMPLATES' | 'MSG91_TEMPLATE_ID' | 'TWILIO_ACCOUNT_SID' | 'TWILIO_AUTH_TOKEN' | 'TWILIO_MESSAGING_SERVICE_SID'>): SmsAccountDefaults => ({
  msg91: c.MSG91_AUTH_KEY && (c.MSG91_TEMPLATES ?? c.MSG91_TEMPLATE_ID) ? { provider: 'msg91', authKey: c.MSG91_AUTH_KEY, templates: c.MSG91_TEMPLATES ?? signInTemplates(c.MSG91_TEMPLATE_ID) } : null,
  twilio: c.TWILIO_ACCOUNT_SID && c.TWILIO_AUTH_TOKEN && c.TWILIO_MESSAGING_SERVICE_SID ? { provider: 'twilio', accountSid: c.TWILIO_ACCOUNT_SID, authToken: c.TWILIO_AUTH_TOKEN, messagingServiceSid: c.TWILIO_MESSAGING_SERVICE_SID } : null,
})

const twilioSettings = z.object({ accountSid: twilioAccountSid, messagingServiceSid: twilioMessagingServiceSid })
const msg91Settings = z.object({ templates: msg91Templates })

/** What a partner saves for a provider, as stored: the secret sealed apart from the settings (db/scoped/partnerSmsCredentials.ts). */
export const partnerAccountOf = (provider: SmsProvider, secret: string, settings: unknown): PartnerSmsAccount | null => {
  if (provider === 'msg91') {
    const parsed = msg91Settings.safeParse(settings)
    return parsed.success ? { provider, authKey: secret, templates: parsed.data.templates } : null
  }
  const parsed = twilioSettings.safeParse(settings)
  return parsed.success ? { provider, authToken: secret, ...parsed.data } : null
}

/**
 * A partner's complete account for the provider, else DripFunnel's (decided on #1017, 2026-10-30). Per provider, so a number is
 * never sent through a mix of the two. A saved secret that can't be opened is not DripFunnel's to stand in for: the text is
 * dropped and logged rather than quietly paid for by the platform.
 */
export const partnerSmsAccounts = (secrets: SecretBox | null, ours: SmsAccountDefaults): PartnerSmsAccounts => ({
  forPartner: async (tx, partnerId, provider) => {
    const saved = await selectSealedSmsAccount(tx, partnerId, provider)
    if (!saved) return ours[provider]
    const secret = secrets ? await secrets.open(saved.key_enc) : null
    if (!secret) return null
    return partnerAccountOf(provider, secret, saved.settings) ?? ours[provider]
  },
})

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
