import { z } from 'zod'
import { isE164, type OutgoingSms } from '#core/sms'
import type { ScopedSql } from '#db/scoped/index'
import { queueSideEffect } from '#saas/outbox/index'

// What the platform texts (THIRD-PARTY-ACCESS §2.8, decided on #337): one-time codes, and
// shoppers' order updates. Each message is a DLT template in India, so its wording is fixed
// here and registered by the partner exactly as written, variables in this order.

export const smsKind = 'sms'

/** An order update unsent after this is news nobody needs, and its number and link leave the outbox. */
export const orderTextMs = 3 * 24 * 60 * 60 * 1000

export const smsMessages = ['code.second_factor', 'code.verify_phone', 'code.shopper_sign_in', 'order.confirmed', 'order.shipped', 'order.delivered'] as const
export type SmsMessage = (typeof smsMessages)[number]

const code = z.object({ code: z.string().regex(/^\d{6}$/) }).strict()
const order = z.object({ order: z.string().min(1).max(40) }).strict()
const shipped = order.extend({ courier: z.string().min(1).max(40), link: z.url() }).strict()
const delivered = order.extend({ link: z.url() }).strict()

const varsSchemas = {
  'code.second_factor': code,
  'code.verify_phone': code,
  'code.shopper_sign_in': code,
  'order.confirmed': order,
  'order.shipped': shipped,
  'order.delivered': delivered,
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
}

/** The text, and for India the registered template with its variables; null template where DLT doesn't apply. */
export const composeSms = (payload: SmsPayload, dltTemplateId: string | null): OutgoingSms => {
  const filled = en[payload.message](payload.brand, payload.vars)
  return { to: payload.to, text: filled.text, dlt: dltTemplateId ? { templateId: dltTemplateId, vars: filled.vars } : null }
}

export type SmsProvider = 'msg91' | 'twilio'

/** MSG91 for Indian numbers (DLT), Twilio for the rest (decided on #284). */
export const providerFor = (to: string): SmsProvider => (to.startsWith('+91') ? 'msg91' : 'twilio')

/** A partner's own SMS account (THIRD-PARTY-ACCESS §8.3), as #275 will read it, decrypted. */
export type PartnerSmsAccount =
  | { provider: 'msg91'; authKey: string; templates: Partial<Record<SmsMessage, string>> }
  | { provider: 'twilio'; accountSid: string; authToken: string; messagingServiceSid: string }

export interface PartnerSmsAccounts {
  forPartner: (tx: ScopedSql, partnerId: string, provider: SmsProvider) => Promise<PartnerSmsAccount | null>
}

/**
 * Queues one text in the transaction that decided it. The idempotency key is the caller's, e.g.
 * the code's own id, so a retried request never texts twice.
 */
export const queueSms = (tx: ScopedSql, effect: { partnerId: string; storeId: string | null; idempotencyKey: string; payload: SmsPayload }): Promise<string | null> => {
  const payload = smsPayloadSchema.parse(effect.payload)
  return queueSideEffect(tx, { kind: smsKind, idempotencyKey: effect.idempotencyKey, payload, partnerId: effect.partnerId, storeId: effect.storeId })
}
